/**
 * Correspondencias entre elementos de distintos diagramas.
 *
 * Dos elementos no se consideran el mismo concepto solo por compartir nombre:
 * deben ser de tipos compatibles (un participante puede ser una clase o un
 * componente; un caso de uso no puede ser un nodo) y cada enlace guarda su
 * base, evidencia y confianza. Solo los enlaces seguros (o confirmados por la
 * persona) forman conceptos; el resto queda como hipótesis por validar.
 */
import { ROLE_TERMS, domainTerms, jaccard, listText, normalizeName, quote, sameTermSet, terms } from './names'
import type { ArchElement, ArchitectureModel, ArchitectureSettings, Concept, Correspondence, ElementKind } from './types'

/** Confianza mínima para que una correspondencia automática se use en las reglas. */
export const AUTO_MATCH_THRESHOLD = 0.75

const COMPATIBLE: Array<[ElementKind, ElementKind]> = [
  ['actor', 'actor'], ['usecase', 'usecase'], ['system', 'system'],
  ['class', 'class'], ['interface', 'interface'], ['enum', 'enum'], ['entity', 'entity'],
  ['class', 'interface'], ['class', 'entity'], ['class', 'component'],
  ['participant', 'participant'], ['participant', 'class'], ['participant', 'interface'], ['participant', 'component'], ['participant', 'entity'],
  ['datastore', 'datastore'], ['queue', 'queue'],
  ['component', 'component'], ['component', 'artifact'], ['artifact', 'artifact'],
  ['package', 'package'], ['package', 'component'],
  ['node', 'node'],
]
const compatible = (a: ElementKind, b: ElementKind) => COMPATIBLE.some(([x, y]) => (x === a && y === b) || (x === b && y === a))

/** Tipos que agrupan (paquete, componente, artefacto, nodo): admiten variantes de rol («Tareas» ↔ «TaskService»). */
const GROUPING = new Set<ElementKind>(['package', 'component', 'artifact', 'node'])

/** Clave estable de un elemento (no depende de su id interno): para guardar decisiones. */
export const stableKey = (element: Pick<ArchElement, 'diagramId' | 'kind' | 'name'>) => `${element.diagramId}/${element.kind}/${normalizeName(element.name)}`

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

function propose(a: ArchElement, b: ArchElement): Omit<Correspondence, 'status'> | null {
  const nameA = normalizeName(a.name)
  const nameB = normalizeName(b.name)
  if (!nameA || !nameB) return null
  if (nameA === nameB) return { a: a.key, b: b.key, basis: 'same-name', confidence: 0.9, evidence: `Mismo nombre (${quote(a.name)}) y tipos compatibles (${a.kind} / ${b.kind}).` }
  const termsA = terms(a.name)
  const termsB = terms(b.name)
  if (sameTermSet(termsA, termsB)) {
    return { a: a.key, b: b.key, basis: 'equivalent-terms', confidence: 0.8, evidence: `${quote(a.name)} y ${quote(b.name)} usan los mismos términos normalizados (${listText([...new Set(termsA)])}).` }
  }
  const domainA = domainTerms(a.name)
  const domainB = domainTerms(b.name)
  if ((GROUPING.has(a.kind) || GROUPING.has(b.kind)) && sameTermSet(domainA, domainB)) {
    return { a: a.key, b: b.key, basis: 'role-variant', confidence: 0.55, evidence: `Comparten el término de dominio ${listText(domainA.map(quote))} y difieren solo en el rol técnico.` }
  }
  const shared = domainA.filter((term) => domainB.includes(term))
  // «TareaController» y «Tarea» solo difieren en un rol técnico: son conceptos distintos, no una hipótesis.
  const rest = [...termsA, ...termsB].filter((term) => !shared.includes(term))
  const shorter = new Set(termsA.length <= termsB.length ? termsA : termsB)
  const included = [...shorter].every((term) => termsA.includes(term) && termsB.includes(term))
  if (shared.length && rest.some((term) => !ROLE_TERMS.has(term)) && (included || jaccard(termsA, termsB) >= 0.5)) {
    return { a: a.key, b: b.key, basis: 'partial', confidence: 0.4, evidence: `Coinciden parcialmente en ${listText([...new Set(shared)].map(quote))}.` }
  }
  return null
}

export function findCorrespondences(model: ArchitectureModel, settings: ArchitectureSettings): Correspondence[] {
  const decisions = new Map(settings.equivalences.map((item) => [pairKey(item.a, item.b), item.status]))
  const byStable = new Map<string, ArchElement[]>()
  for (const element of model.elements) byStable.set(stableKey(element), [...(byStable.get(stableKey(element)) ?? []), element])

  const result = new Map<string, Correspondence>()
  const elements = model.elements
  for (let i = 0; i < elements.length; i += 1) {
    for (let j = i + 1; j < elements.length; j += 1) {
      const a = elements[i]
      const b = elements[j]
      if (a.diagramId === b.diagramId || !compatible(a.kind, b.kind)) continue
      const proposal = propose(a, b)
      const decision = decisions.get(pairKey(stableKey(a), stableKey(b)))
      if (!proposal && decision !== 'confirmed') continue
      const base = proposal ?? { a: a.key, b: b.key, basis: 'user' as const, confidence: 1, evidence: 'Equivalencia confirmada por una persona del equipo.' }
      const status: Correspondence['status'] =
        decision === 'confirmed' ? 'confirmed' : decision === 'rejected' ? 'rejected' : base.confidence >= AUTO_MATCH_THRESHOLD ? 'auto' : 'hypothesis'
      result.set(pairKey(a.key, b.key), { ...base, ...(decision === 'confirmed' ? { confidence: 1 } : {}), status })
    }
  }

  // Ambigüedad: un elemento con varios candidatos automáticos distintos en un mismo diagrama.
  const elementByKey = new Map(elements.map((element) => [element.key, element]))
  const byElementAndDiagram = new Map<string, Correspondence[]>()
  for (const item of result.values()) {
    if (item.status !== 'auto') continue
    for (const [self, other] of [[item.a, item.b], [item.b, item.a]]) {
      const group = `${self}@${elementByKey.get(other)!.diagramId}`
      byElementAndDiagram.set(group, [...(byElementAndDiagram.get(group) ?? []), item])
    }
  }
  for (const [group, items] of byElementAndDiagram) {
    const self = group.split('@')[0]
    const names = new Set(items.map((item) => normalizeName(elementByKey.get(item.a === self ? item.b : item.a)!.name)))
    if (names.size <= 1) continue
    for (const item of items) {
      item.status = 'hypothesis'
      item.ambiguous = true
      item.evidence += ` Ambigua: ${quote(elementByKey.get(self)!.name)} tiene ${names.size} candidatos distintos en el mismo diagrama.`
    }
  }
  return [...result.values()].sort((x, y) => pairKey(x.a, x.b).localeCompare(pairKey(y.a, y.b)))
}

/** Conceptos: componentes conexos de las correspondencias usables (automáticas o confirmadas). */
export function buildConcepts(model: ArchitectureModel, correspondences: Correspondence[]): Concept[] {
  const parent = new Map(model.elements.map((element) => [element.key, element.key]))
  const find = (key: string): string => {
    let root = key
    while (parent.get(root) !== root) root = parent.get(root)!
    parent.set(key, root)
    return root
  }
  const usable = correspondences.filter((item) => item.status === 'auto' || item.status === 'confirmed')
  for (const item of usable) {
    const [x, y] = [find(item.a), find(item.b)]
    if (x !== y) parent.set(x < y ? y : x, x < y ? x : y)
  }
  const groups = new Map<string, ArchElement[]>()
  for (const element of model.elements) groups.set(find(element.key), [...(groups.get(find(element.key)) ?? []), element])

  const concepts: Concept[] = []
  for (const members of groups.values()) {
    const keys = new Set(members.map((member) => member.key))
    const links = usable.filter((item) => keys.has(item.a))
    const perDiagram = new Map<string, Set<string>>()
    for (const member of members) perDiagram.set(member.diagramId, (perDiagram.get(member.diagramId) ?? new Set()).add(normalizeName(member.name)))
    const counts = new Map<string, number>()
    for (const member of members) counts.set(member.name, (counts.get(member.name) ?? 0) + 1)
    const label = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
    concepts.push({
      id: '',
      label,
      members: members.map((member) => member.key).sort(),
      diagramIds: [...perDiagram.keys()].sort(),
      confidence: links.length ? Math.min(...links.map((item) => item.confidence)) : 1,
      ambiguous: [...perDiagram.values()].some((names) => names.size > 1),
    })
  }
  concepts.sort((a, b) => a.label.localeCompare(b.label) || a.members[0].localeCompare(b.members[0]))
  concepts.forEach((concept, index) => (concept.id = `K${index + 1}`))
  return concepts
}

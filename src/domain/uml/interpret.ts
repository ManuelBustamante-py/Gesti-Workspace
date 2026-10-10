import { containerMap } from './geometry'
import { edgeSpec, kindSpec, nodeSpec } from './kinds'
import { interpretStructured } from './interpretStructured'
import { isStructuredKind, type StructuredModel } from './structured'
import type { GraphEdge, GraphModel, GraphNode, SequenceModel, VisualModel } from './visualModel'

/**
 * Interpretación del diagrama en lenguaje natural y revisión de coherencia.
 * Es un análisis por reglas (sin servicios externos): describe lo que el
 * diagrama afirma y señala lo que contradice las reglas de su notación.
 */
export type Finding = { level: 'warning' | 'info' | 'ok'; text: string }
export type Interpretation = { summary: string[]; findings: Finding[] }

const q = (text: string) => `«${text.replace(/\s*\n\s*/g, ' ').trim() || 'sin nombre'}»`
const list = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

const CARDINALITY_TEXT: Record<string, string> = { '1': 'exactamente un(a)', '0..1': 'como máximo un(a)', '1..*': 'uno o más', '0..*': 'cero o más', '*': 'cero o más' }

// --- Utilidades de grafo -------------------------------------------------------------

function graphTools(model: GraphModel) {
  const byId = new Map(model.nodes.map((node) => [node.id, node]))
  const spec = (node: GraphNode) => nodeSpec(model.kind, node.type)
  const name = (id: string) => q(byId.get(id)?.name ?? '?')
  const real = (node: GraphNode) => node.type !== 'note' && !spec(node).container && !spec(node).pseudo
  const edgesOf = (id: string) => model.edges.filter((edge) => edge.type !== 'note-link' && (edge.source === id || edge.target === id))
  const ofType = (...types: string[]) => model.nodes.filter((node) => types.includes(node.type))
  return { byId, spec, name, real, edgesOf, ofType }
}

/** Revisiones comunes a todos los grafos: vacíos, sin nombre, repetidos, aislados. */
function commonGraphChecks(model: GraphModel, findings: Finding[]) {
  const { real, edgesOf, spec } = graphTools(model)
  const elements = model.nodes.filter(real)
  for (const node of elements) {
    if (!node.name.trim()) findings.push({ level: 'warning', text: `Hay un elemento de tipo ${spec(node).label.toLowerCase()} sin nombre.` })
  }
  const seen = new Map<string, number>()
  for (const node of elements) {
    const key = `${node.type}|${node.name.trim().toLowerCase()}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  for (const [key, count] of seen) {
    if (count > 1) findings.push({ level: 'warning', text: `${q(key.split('|')[1])} aparece ${count} veces como ${spec({ type: key.split('|')[0] } as GraphNode).label.toLowerCase()}: ¿es el mismo elemento repetido?` })
  }
  const isolated = elements.filter((node) => edgesOf(node.id).length === 0)
  if (isolated.length && elements.length > 1) {
    findings.push({ level: 'info', text: `Sin relaciones: ${list(isolated.map((node) => q(node.name)))}. Si son parte del diagrama, conéctalos; si no, quizá sobran.` })
  }
}

function containmentSummary(model: GraphModel, summary: string[]) {
  const parents = containerMap(model.kind, model.nodes)
  const { byId, spec } = graphTools(model)
  for (const container of model.nodes.filter((node) => spec(node).container)) {
    const children = model.nodes.filter((node) => parents.get(node.id) === container.id && node.type !== 'note')
    if (children.length) summary.push(`${spec(container).label} ${q(container.name)} agrupa ${list(children.map((child) => q(byId.get(child.id)!.name)))}.`)
    else summary.push(`${spec(container).label} ${q(container.name)} está vacío.`)
  }
}

/** Ciclos dirigidos usando solo ciertos tipos de relación. */
function findCycle(model: GraphModel, types: string[]): string[] | null {
  const next = new Map<string, string[]>()
  for (const edge of model.edges) if (types.includes(edge.type) && edge.source !== edge.target) next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target])
  const state = new Map<string, 1 | 2>()
  const path: string[] = []
  let cycle: string[] | null = null
  const visit = (id: string): boolean => {
    state.set(id, 1)
    path.push(id)
    for (const other of next.get(id) ?? []) {
      if (state.get(other) === 1) {
        cycle = path.slice(path.indexOf(other))
        return true
      }
      if (!state.has(other) && visit(other)) return true
    }
    path.pop()
    state.set(id, 2)
    return false
  }
  for (const node of model.nodes) if (!state.has(node.id) && visit(node.id)) break
  return cycle
}

// --- Casos de uso --------------------------------------------------------------------

function interpretUseCase(model: GraphModel): Interpretation {
  const { byId, name, ofType, edgesOf } = graphTools(model)
  const summary: string[] = []
  const findings: Finding[] = []
  const actors = ofType('actor')
  const useCases = ofType('usecase')
  const boundary = ofType('boundary')
  summary.push(`El diagrama define ${plural(actors.length, 'actor', 'actores')} y ${plural(useCases.length, 'caso de uso', 'casos de uso')}${boundary.length ? ` dentro de ${list(boundary.map((item) => q(item.name)))}` : ''}.`)

  for (const actor of actors) {
    const goals = model.edges
      .filter((edge) => ['association', 'directed'].includes(edge.type) && (edge.source === actor.id || edge.target === actor.id))
      .map((edge) => (edge.source === actor.id ? edge.target : edge.source))
      .filter((id) => byId.get(id)?.type === 'usecase')
    const parents = model.edges.filter((edge) => edge.type === 'generalization' && edge.source === actor.id).map((edge) => name(edge.target))
    if (goals.length) summary.push(`${q(actor.name)} puede ${list(goals.map((id) => name(id)))}.`)
    if (parents.length) summary.push(`${q(actor.name)} es un tipo de ${list(parents)}: hereda todo lo que este puede hacer.`)
    if (!goals.length && !parents.length && !model.edges.some((edge) => edge.type === 'generalization' && edge.target === actor.id)) {
      findings.push({ level: 'warning', text: `El actor ${q(actor.name)} no participa en ningún caso de uso.` })
    }
  }
  for (const edge of model.edges.filter((item) => item.type === 'include')) summary.push(`Siempre que se realiza ${name(edge.source)}, también se realiza ${name(edge.target)} (include).`)
  for (const edge of model.edges.filter((item) => item.type === 'extend')) summary.push(`${name(edge.source)} es un comportamiento opcional que puede ampliar ${name(edge.target)} (extend).`)
  containmentSummary(model, summary)

  const reachable = new Set<string>()
  for (const edge of model.edges) {
    const ends = [byId.get(edge.source), byId.get(edge.target)]
    if (ends.some((node) => node?.type === 'actor')) ends.forEach((node) => node && reachable.add(node.id))
  }
  let grew = true
  while (grew) {
    grew = false
    for (const edge of model.edges.filter((item) => ['include', 'extend', 'generalization'].includes(item.type))) {
      for (const [from, to] of [[edge.source, edge.target], [edge.target, edge.source]]) {
        if (reachable.has(from) && !reachable.has(to)) {
          reachable.add(to)
          grew = true
        }
      }
    }
  }
  for (const useCase of useCases.filter((item) => !reachable.has(item.id))) {
    findings.push({ level: 'warning', text: `Ningún actor llega a ${q(useCase.name)} (ni directamente ni por include/extend): ¿quién lo realiza?` })
  }
  for (const edge of model.edges) {
    const from = byId.get(edge.source)
    const to = byId.get(edge.target)
    if (!from || !to) continue
    if ((edge.type === 'include' || edge.type === 'extend') && (from.type !== 'usecase' || to.type !== 'usecase')) {
      findings.push({ level: 'warning', text: `«${edge.type}» solo debe unir casos de uso, pero une ${q(from.name)} con ${q(to.name)}.` })
    }
    if (edge.type === 'association' && from.type === to.type) {
      findings.push({ level: 'info', text: `La asociación entre ${q(from.name)} y ${q(to.name)} une dos ${from.type === 'actor' ? 'actores' : 'casos de uso'}; normalmente se asocia un actor con un caso de uso.` })
    }
  }
  if (boundary.length) {
    const parents = containerMap(model.kind, model.nodes)
    const outside = useCases.filter((item) => !parents.get(item.id))
    if (outside.length) findings.push({ level: 'info', text: `Casos de uso fuera del límite del sistema: ${list(outside.map((item) => q(item.name)))}.` })
    const actorsInside = actors.filter((item) => parents.get(item.id))
    if (actorsInside.length) findings.push({ level: 'warning', text: `Los actores son externos al sistema, pero ${list(actorsInside.map((item) => q(item.name)))} está dentro del límite.` })
  }
  const cycle = findCycle(model, ['include'])
  if (cycle) findings.push({ level: 'warning', text: `Hay un ciclo de include: ${cycle.map((id) => name(id)).join(' → ')}.` })
  for (const useCase of useCases) {
    if (/^(gestionar|administrar|manejar)\b/i.test(useCase.name.trim()) && edgesOf(useCase.id).length > 0) {
      findings.push({ level: 'info', text: `${q(useCase.name)} es muy amplio: podría dividirse en casos concretos (crear, editar, eliminar…).` })
    }
  }
  commonGraphChecks(model, findings)
  return { summary, findings }
}

// --- Clases y afines (objetos, bloques, perfiles, paquetes, requisitos) -------------------

function relationSentence(model: GraphModel, edge: GraphEdge, name: (id: string) => string) {
  const from = name(edge.source)
  const to = name(edge.target)
  const label = edge.label?.trim()
  const many = (value?: string) => (value?.trim() ? ` (${value.trim()})` : '')
  switch (edge.type) {
    case 'generalization':
      return `${from} es una especialización de ${to}: hereda sus atributos y métodos.`
    case 'realization':
      return `${from} implementa ${to}.`
    case 'composition':
      return `${to}${many(edge.targetLabel)} forma parte de ${from} y no existe sin él (composición).`
    case 'aggregation':
      return `${from} agrupa a ${to}${many(edge.targetLabel)}, que puede existir por separado (agregación).`
    case 'dependency':
      return `${from} depende de ${to}${label ? ` (${label})` : ''}: un cambio en ${to} puede afectarlo.`
    case 'directed':
      return `${from} conoce a ${to}${many(edge.targetLabel)}${label ? ` (${label})` : ''}, pero no al revés.`
    case 'association':
      return label
        ? `Cada ${from}${edge.sourceLabel ? ` [${edge.sourceLabel}]` : ''} ${label} ${edge.targetLabel ? `${edge.targetLabel} ` : ''}${to}.`
        : `${from} y ${to} están asociados${edge.sourceLabel || edge.targetLabel ? ` (${edge.sourceLabel ?? '?'} a ${edge.targetLabel ?? '?'})` : ''}.`
    default: {
      const spec = edgeSpec(model.kind, edge.type)
      return `${from} ${spec.fixedText ? `«${spec.fixedText}» ` : `→ (${spec.label.toLowerCase()}) `}${to}${label ? `: ${label}` : ''}.`
    }
  }
}

function interpretClass(model: GraphModel): Interpretation {
  const { byId, name, ofType, spec } = graphTools(model)
  const summary: string[] = []
  const findings: Finding[] = []
  const classes = model.nodes.filter((node) => spec(node).members)
  const counts = new Map<string, number>()
  for (const node of classes) counts.set(spec(node).label.toLowerCase(), (counts.get(spec(node).label.toLowerCase()) ?? 0) + 1)
  summary.push(`El diagrama tiene ${list([...counts].map(([label, count]) => `${count} ${label}${count === 1 ? '' : label.endsWith('n') ? 'es' : 's'}`)) || 'ningún clasificador'}.`)

  for (const node of classes) {
    const attributes = (node.attributes ?? []).filter((line) => line.trim() && !/^(--|==|\.\.)$/.test(line.trim()))
    const methods = (node.methods ?? []).filter((line) => line.trim())
    if (node.type === 'enum') summary.push(`${q(node.name)} admite los valores ${list(attributes.map((value) => value.trim()))}.`)
    else if (spec(node).members === 'class') summary.push(`${q(node.name)} guarda ${plural(attributes.length, 'atributo', 'atributos')}${attributes.length ? ` (${attributes.map((line) => line.replace(/^[-+#~]\s*/, '').split(':')[0].trim()).join(', ')})` : ''} y ofrece ${plural(methods.length, 'operación', 'operaciones')}.`)
    if (spec(node).members === 'class' && !attributes.length && !methods.length && node.type !== 'interface') {
      findings.push({ level: 'info', text: `${q(node.name)} no tiene atributos ni métodos todavía.` })
    }
    if (node.type === 'enum' && !attributes.length) findings.push({ level: 'warning', text: `La enumeración ${q(node.name)} no tiene valores.` })
    const noVisibility = [...attributes, ...methods].filter((line) => !/^[-+#~]/.test(line.trim()))
    if (spec(node).members === 'class' && node.type !== 'enum' && noVisibility.length) {
      findings.push({ level: 'info', text: `En ${q(node.name)}, ${plural(noVisibility.length, 'miembro no indica', 'miembros no indican')} visibilidad (+, -, #, ~).` })
    }
  }
  for (const edge of model.edges.filter((item) => item.type !== 'note-link')) summary.push(relationSentence(model, edge, name))
  containmentSummary(model, summary)

  for (const iface of ofType('interface')) {
    if (!model.edges.some((edge) => edge.type === 'realization' && edge.target === iface.id)) {
      findings.push({ level: 'warning', text: `Nadie implementa la interfaz ${q(iface.name)}.` })
    }
  }
  for (const abstract of ofType('abstract')) {
    if (!model.edges.some((edge) => edge.type === 'generalization' && edge.target === abstract.id)) {
      findings.push({ level: 'info', text: `La clase abstracta ${q(abstract.name)} no tiene subclases: no podrá instanciarse.` })
    }
  }
  for (const edge of model.edges) {
    const from = byId.get(edge.source)
    const to = byId.get(edge.target)
    if (edge.type === 'realization' && to && to.type !== 'interface' && model.kind === 'class') {
      findings.push({ level: 'warning', text: `${q(from?.name ?? '?')} «implementa» a ${q(to.name)}, que no es una interfaz: ¿debería ser herencia?` })
    }
    if (edge.type === 'generalization' && from && to && from.type === 'interface' && to.type !== 'interface') {
      findings.push({ level: 'warning', text: `La interfaz ${q(from.name)} hereda de ${q(to.name)}, que no es interfaz.` })
    }
  }
  const cycle = findCycle(model, ['generalization'])
  if (cycle) findings.push({ level: 'warning', text: `Herencia circular: ${cycle.map((id) => name(id)).join(' → ')}.` })
  const parentsCount = new Map<string, number>()
  for (const edge of model.edges.filter((item) => item.type === 'generalization')) parentsCount.set(edge.source, (parentsCount.get(edge.source) ?? 0) + 1)
  for (const [id, count] of parentsCount) {
    if (count > 1 && byId.get(id)?.type !== 'interface') findings.push({ level: 'info', text: `${name(id)} hereda de ${count} clases (herencia múltiple): muchos lenguajes no la permiten.` })
  }
  const composedTwice = new Map<string, number>()
  for (const edge of model.edges.filter((item) => item.type === 'composition')) composedTwice.set(edge.target, (composedTwice.get(edge.target) ?? 0) + 1)
  for (const [id, count] of composedTwice) {
    if (count > 1) findings.push({ level: 'warning', text: `${name(id)} es parte por composición de ${count} todos distintos; una parte compuesta pertenece a un solo dueño.` })
  }
  if (model.kind === 'package') {
    const packageCycle = findCycle(model, ['dependency', 'use', 'import', 'access'])
    if (packageCycle) findings.push({ level: 'warning', text: `Dependencia circular entre paquetes: ${packageCycle.map((id) => name(id)).join(' → ')}.` })
  }
  if (model.kind === 'requirement') {
    for (const requirement of ofType('requirement')) {
      if (!model.edges.some((edge) => edge.type === 'satisfy' && edge.target === requirement.id)) findings.push({ level: 'warning', text: `Ningún bloque satisface ${q(requirement.name)}.` })
      if (!model.edges.some((edge) => edge.type === 'verify' && edge.target === requirement.id)) findings.push({ level: 'info', text: `Ninguna prueba verifica ${q(requirement.name)}.` })
    }
  }
  if (model.kind === 'profile') {
    for (const stereotype of ofType('stereotype')) {
      if (!model.edges.some((edge) => edge.source === stereotype.id && ['extension', 'generalization'].includes(edge.type))) {
        findings.push({ level: 'warning', text: `El estereotipo ${q(stereotype.name)} no extiende ninguna metaclase.` })
      }
    }
  }
  commonGraphChecks(model, findings)
  return { summary, findings }
}

// --- Flujos: estados, actividades, diagramas de flujo, BPMN ----------------------------------

function interpretFlow(model: GraphModel): Interpretation {
  const { byId, spec } = graphTools(model)
  const summary: string[] = []
  const findings: Finding[] = []
  const flows = model.edges.filter((edge) => edge.type !== 'note-link')
  const out = (id: string) => flows.filter((edge) => edge.source === id)
  const into = (id: string) => flows.filter((edge) => edge.target === id)
  const initials = model.nodes.filter((node) => spec(node).pseudo === 'initial')
  const finals = model.nodes.filter((node) => spec(node).pseudo === 'final')
  const steps = model.nodes.filter((node) => !spec(node).pseudo && !spec(node).container && node.type !== 'note')
  const word = model.kind === 'state' ? ['estado', 'estados'] : model.kind === 'bpmn' ? ['tarea', 'tareas'] : ['paso', 'pasos']
  summary.push(`El flujo tiene ${plural(steps.length, word[0], word[1])}, ${plural(model.nodes.filter((node) => spec(node).pseudo === 'choice').length, 'decisión', 'decisiones')} y ${plural(finals.length, 'final', 'finales')}.`)

  // Recorrido desde el inicio, en orden de anchura.
  const describe = (id: string) => {
    const node = byId.get(id)!
    const kind = spec(node).pseudo
    if (kind === 'final') return 'termina'
    if (kind === 'choice') return `decide ${node.name.trim() && node.name !== spec(node).defaultName ? q(node.name) : 'el camino'}`
    if (kind === 'fork') return 'se divide en caminos paralelos'
    if (kind === 'join') return 'espera a que terminen los caminos paralelos'
    return q(node.name)
  }
  const visited = new Set<string>()
  const queue = initials.map((node) => node.id)
  const sentences: string[] = []
  while (queue.length && sentences.length < 14) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    const next = out(id)
    if (next.length === 0) continue
    const from = spec(byId.get(id)!).pseudo === 'initial' ? 'Al comenzar' : `Después de ${describe(id)}`
    const targets = next.map((edge) => `${edge.label?.trim() ? `si ${q(edge.label)} → ` : ''}${describe(edge.target)}`)
    sentences.push(`${from}: ${list(targets)}.`)
    next.forEach((edge) => queue.push(edge.target))
  }
  summary.push(...sentences)
  if (queue.length) summary.push('…y continúa.')
  containmentSummary(model, summary)

  if (initials.length === 0) findings.push({ level: 'warning', text: 'No hay un inicio: agrega un punto de inicio para saber dónde comienza el flujo.' })
  if (finals.length === 0 && model.kind !== 'state') findings.push({ level: 'warning', text: 'No hay un final: el flujo nunca termina.' })
  const reachable = new Set<string>()
  const stack = initials.map((node) => node.id)
  while (stack.length) {
    const id = stack.pop()!
    if (reachable.has(id)) continue
    reachable.add(id)
    out(id).forEach((edge) => stack.push(edge.target))
  }
  const unreachable = [...steps, ...finals].filter((node) => initials.length && !reachable.has(node.id))
  if (unreachable.length) findings.push({ level: 'warning', text: `No se puede llegar desde el inicio a: ${list(unreachable.map((node) => describe(node.id)))}.` })
  const deadEnds = steps.filter((node) => out(node.id).length === 0)
  if (deadEnds.length && model.kind !== 'state') findings.push({ level: 'warning', text: `El flujo se detiene sin llegar a un final después de ${list(deadEnds.map((node) => q(node.name)))}.` })
  for (const decision of model.nodes.filter((node) => spec(node).pseudo === 'choice')) {
    const branches = out(decision.id)
    if (branches.length < 2) findings.push({ level: 'warning', text: `La decisión ${describe(decision.id)} tiene ${branches.length === 1 ? 'una sola salida' : 'ninguna salida'}: necesita al menos dos caminos.` })
    else if (branches.some((edge) => !edge.label?.trim())) findings.push({ level: 'info', text: `Algunas salidas de la decisión ${describe(decision.id)} no indican su condición.` })
  }
  const forks = model.nodes.filter((node) => spec(node).pseudo === 'fork').length
  const joins = model.nodes.filter((node) => spec(node).pseudo === 'join').length
  if (forks !== joins) findings.push({ level: 'info', text: `Hay ${plural(forks, 'bifurcación', 'bifurcaciones')} y ${plural(joins, 'unión', 'uniones')}: normalmente cada camino paralelo se vuelve a unir.` })
  for (const node of steps) {
    if (into(node.id).length === 0 && initials.length) findings.push({ level: 'info', text: `${q(node.name)} no tiene ninguna entrada.` })
  }
  if (model.kind === 'state') {
    for (const node of steps) if (out(node.id).length === 0 && !finals.length) findings.push({ level: 'info', text: `${q(node.name)} es un estado sin salida (terminal).` })
  }
  if (!findings.some((finding) => finding.level === 'warning') && initials.length) findings.push({ level: 'ok', text: 'Todos los pasos son alcanzables desde el inicio.' })
  return { summary, findings }
}

// --- Entidad-relación -------------------------------------------------------------------

function interpretER(model: GraphModel): Interpretation {
  const { byId, ofType } = graphTools(model)
  const summary: string[] = []
  const findings: Finding[] = []
  const entities = ofType('entity')
  summary.push(`El modelo de datos tiene ${plural(entities.length, 'entidad', 'entidades')}: ${list(entities.map((entity) => q(entity.name)))}.`)
  for (const entity of entities) {
    const fields = (entity.attributes ?? []).filter((line) => line.trim() && line.trim() !== '--')
    const keys = fields.filter((line) => /<<\s*PK\s*>>|\bPK\b/i.test(line))
    summary.push(`${q(entity.name)} guarda ${list(fields.map((line) => line.replace(/^\*\s*/, '').split(':')[0].trim()))}.`)
    if (!keys.length) findings.push({ level: 'warning', text: `${q(entity.name)} no tiene clave primaria (marca un campo con <<PK>>).` })
    const foreign = fields.filter((line) => /<<\s*FK\s*>>/i.test(line))
    const related = model.edges.filter((edge) => edge.source === entity.id || edge.target === entity.id).length
    if (foreign.length > related) findings.push({ level: 'info', text: `${q(entity.name)} tiene ${plural(foreign.length, 'clave foránea', 'claves foráneas')} pero ${plural(related, 'relación dibujada', 'relaciones dibujadas')}.` })
  }
  for (const edge of model.edges.filter((item) => item.type === 'er')) {
    const from = byId.get(edge.source)
    const to = byId.get(edge.target)
    if (!from || !to) continue
    const left = CARDINALITY_TEXT[edge.sourceLabel?.trim() || '1']
    const right = CARDINALITY_TEXT[edge.targetLabel?.trim() || '0..*']
    summary.push(`Cada ${q(from.name)} se relaciona con ${right} ${q(to.name)}${edge.label?.trim() ? ` (${edge.label.trim()})` : ''}, y cada ${q(to.name)} con ${left} ${q(from.name)}.`)
    if ((edge.sourceLabel?.includes('*') ?? false) && (edge.targetLabel?.includes('*') ?? true)) {
      findings.push({ level: 'info', text: `${q(from.name)} y ${q(to.name)} tienen una relación de muchos a muchos: en una base relacional necesitará una tabla intermedia.` })
    }
  }
  commonGraphChecks(model, findings)
  return { summary, findings }
}

// --- Descriptivos (componentes, despliegue, C4, nubes, DFD, ArchiMate…) -----------------------

function interpretDescriptive(model: GraphModel): Interpretation {
  const { byId, name, spec, real } = graphTools(model)
  const summary: string[] = []
  const findings: Finding[] = []
  const elements = model.nodes.filter(real)
  const groups = new Map<string, string[]>()
  for (const node of elements) groups.set(spec(node).label, [...(groups.get(spec(node).label) ?? []), q(node.name)])
  summary.push(`Elementos: ${[...groups].map(([label, names]) => `${label.toLowerCase()} (${names.join(', ')})`).join('; ') || 'ninguno'}.`)
  containmentSummary(model, summary)
  for (const edge of model.edges.filter((item) => item.type !== 'note-link')) {
    const spec = edgeSpec(model.kind, edge.type)
    const verb = model.kind === 'dfd' ? 'envía' : spec.type === 'serving' ? 'sirve a' : spec.type === 'triggering' ? 'desencadena' : spec.type === 'access' ? 'accede a' : spec.type === 'link' ? 'se conecta con' : 'usa a'
    summary.push(`${name(edge.source)} ${verb} ${name(edge.target)}${edge.label?.trim() ? `: ${edge.label.trim()}` : ''}.`)
  }

  if (model.kind === 'dfd') {
    for (const process of model.nodes.filter((node) => node.type === 'process')) {
      const inputs = model.edges.filter((edge) => edge.target === process.id).length
      const outputs = model.edges.filter((edge) => edge.source === process.id).length
      if (!inputs) findings.push({ level: 'warning', text: `El proceso ${q(process.name)} produce datos sin recibir ninguno («milagro»).` })
      if (!outputs) findings.push({ level: 'warning', text: `El proceso ${q(process.name)} recibe datos pero no produce nada («agujero negro»).` })
    }
    for (const edge of model.edges) {
      const types = [byId.get(edge.source)?.type, byId.get(edge.target)?.type]
      if (types.includes('external') && types.includes('store')) findings.push({ level: 'warning', text: `${name(edge.source)} y ${name(edge.target)} intercambian datos sin pasar por un proceso: en un DFD, los datos solo se mueven a través de procesos.` })
      if (types[0] === 'store' && types[1] === 'store') findings.push({ level: 'warning', text: `Dos almacenes conectados directamente (${name(edge.source)} → ${name(edge.target)}).` })
      if (!edge.label?.trim() && edge.type !== 'note-link') findings.push({ level: 'info', text: `El flujo ${name(edge.source)} → ${name(edge.target)} no dice qué datos transporta.` })
    }
  }
  if (model.kind === 'c4') {
    const unlabeled = model.edges.filter((edge) => edge.type !== 'note-link' && !edge.label?.trim())
    if (unlabeled.length) findings.push({ level: 'info', text: `En C4 cada relación debería decir qué hace y con qué tecnología; faltan ${plural(unlabeled.length, 'descripción', 'descripciones')}.` })
    for (const container of model.nodes.filter((node) => node.type === 'container' || node.type === 'c4database')) {
      if (!/\[.+\]/.test(container.name)) findings.push({ level: 'info', text: `Indica la tecnología del contenedor ${q(container.name)} entre corchetes, p. ej. [React].` })
    }
  }
  if (model.kind === 'component') {
    for (const iface of model.nodes.filter((node) => node.type === 'interface')) {
      if (model.edges.filter((edge) => edge.source === iface.id || edge.target === iface.id).length < 2) findings.push({ level: 'info', text: `La interfaz ${q(iface.name)} debería ser provista por un componente y usada por otro.` })
    }
  }
  if (model.kind === 'composite') {
    const parents = containerMap(model.kind, model.nodes)
    for (const port of model.nodes.filter((node) => (node.type === 'portin' || node.type === 'portout') && !parents.get(node.id))) {
      findings.push({ level: 'warning', text: `El puerto ${q(port.name)} está fuera de un componente: un puerto siempre pertenece al borde de un clasificador.` })
    }
  }
  if (model.kind === 'communication') {
    const unnumbered = model.edges.filter((edge) => edge.type === 'message' && !/^\s*\d/.test(edge.label ?? ''))
    if (unnumbered.length) findings.push({ level: 'info', text: `En un diagrama de comunicación los mensajes se numeran (1:, 1.1:, 2:…); ${plural(unnumbered.length, 'enlace no tiene', 'enlaces no tienen')} número.` })
  }
  commonGraphChecks(model, findings)
  return { summary, findings }
}

// --- Secuencia ------------------------------------------------------------------------------

function interpretSequence(model: SequenceModel): Interpretation {
  const summary: string[] = []
  const findings: Finding[] = []
  const name = (id: string) => q(model.participants.find((participant) => participant.id === id)?.name ?? '?')
  const messages = model.messages.filter((message) => message.raw === undefined)
  summary.push(`Participan ${list(model.participants.map((participant) => q(participant.name)))} en ${plural(messages.length, 'mensaje', 'mensajes')}.`)
  let step = 0
  for (const message of model.messages) {
    if (message.raw !== undefined) {
      const raw = message.raw.trim()
      const fragment = /^(alt|opt|loop|par|break|critical|group)\s*(.*)$/.exec(raw)
      if (fragment) summary.push(`— ${({ alt: 'Si', opt: 'Opcionalmente, si', loop: 'Repetir mientras', par: 'En paralelo', break: 'Interrumpir si', critical: 'Sección crítica', group: 'Grupo' } as Record<string, string>)[fragment[1]]} ${fragment[2] ? q(fragment[2]) : ''}:`)
      else if (/^else\b/.test(raw)) summary.push(`— Si no${raw.slice(4).trim() ? `, ${q(raw.slice(4))}` : ''}:`)
      continue
    }
    step += 1
    if (step > 18) continue
    const text = message.label.trim() ? q(message.label) : 'un mensaje'
    if (message.from === message.to) summary.push(`${step}. ${name(message.from)} realiza ${text} internamente.`)
    else if (message.type === 'reply') summary.push(`${step}. ${name(message.from)} responde ${text} a ${name(message.to)}.`)
    else summary.push(`${step}. ${name(message.from)} ${message.type === 'async' ? 'envía sin esperar respuesta' : 'pide'} ${text} a ${name(message.to)}.`)
  }
  if (step > 18) summary.push(`…y ${step - 18} mensajes más.`)

  for (const participant of model.participants) {
    if (!messages.some((message) => message.from === participant.id || message.to === participant.id)) {
      findings.push({ level: 'warning', text: `${q(participant.name)} no envía ni recibe mensajes.` })
    }
  }
  messages.forEach((message, index) => {
    if (message.type !== 'reply') return
    const asked = messages.slice(0, index).some((previous) => previous.type !== 'reply' && previous.from === message.to && previous.to === message.from)
    if (!asked) findings.push({ level: 'warning', text: `${name(message.from)} responde ${q(message.label)} a ${name(message.to)} sin que se le haya pedido nada antes.` })
  })
  const opened = model.messages.filter((message) => /^(alt|opt|loop|par|break|critical|group)\b/.test(message.raw?.trim() ?? '')).length
  const closed = model.messages.filter((message) => /^end\b/.test(message.raw?.trim() ?? '') && !/^end ?note/.test(message.raw?.trim() ?? '')).length
  if (opened !== closed) findings.push({ level: 'warning', text: `Hay ${plural(opened, 'fragmento abierto', 'fragmentos abiertos')} (alt, loop…) y ${plural(closed, '«end»', '«end»')}: cada fragmento debe cerrarse.` })
  const unnamed = messages.filter((message) => !message.label.trim())
  if (unnamed.length) findings.push({ level: 'info', text: `${plural(unnamed.length, 'mensaje no tiene', 'mensajes no tienen')} texto: describe qué se pide o se envía.` })
  if (messages.length && model.participants[0] && messages[0].from !== model.participants[0].id) {
    findings.push({ level: 'info', text: `La interacción no empieza en el primer participante (${q(model.participants[0].name)}); ordenar de izquierda a derecha según quién inicia facilita la lectura.` })
  }
  return { summary, findings }
}

/** Interpretación del modelo visual según su tipo. */
export function interpretModel(model: VisualModel): Interpretation {
  if (isStructuredKind(model.kind)) return interpretStructured(model as StructuredModel)
  if (model.kind === 'sequence') return interpretSequence(model as SequenceModel)
  const graph = model as GraphModel
  if (graph.nodes.length === 0) return { summary: ['El diagrama está vacío.'], findings: [] }
  const syntax = kindSpec(graph.kind)?.syntax
  if (graph.kind === 'usecase') return interpretUseCase(graph)
  if (graph.kind === 'er') return interpretER(graph)
  if (syntax === 'state') return interpretFlow(graph)
  if (syntax === 'class') return interpretClass(graph)
  return interpretDescriptive(graph)
}

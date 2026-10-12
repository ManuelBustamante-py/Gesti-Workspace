/**
 * Reglas estructurales entre vistas: el mismo par de conceptos relacionado en
 * dos diagramas de clases (o en clases y en el MER) debe relacionarse de forma
 * compatible: herencia, todo-parte, multiplicidades y tipos de miembros.
 */
import { listText, normalizeName, quote, typeKey } from '../names'
import { emptyOutcome, type RuleContext, type RuleSpec } from '../context'
import type { ArchRelation } from '../types'

const STRUCTURAL_KINDS = ['class', 'package', 'er'] as const

const enoughDiagrams = (ctx: RuleContext) =>
  ctx.diagramsOfKind(...STRUCTURAL_KINDS).length >= 2 ? null : 'Se necesitan al menos dos diagramas estructurales (clases, paquetes o MER) para compararlos.'

/** Multiplicidad comparable: «*» = «0..*», «n» = «*», «1..n» = «1..*». */
export function normalizeMultiplicity(value: string | undefined) {
  if (!value) return null
  const text = value.trim().toLowerCase().replace(/\s+/g, '').replace(/\bn\b|\bmany\b|\bm\b/g, '*')
  if (text === '*' || text === '0..*') return '0..*'
  if (text === '1..*') return '1..*'
  if (text === '0..1' || text === '1' || /^\d+(\.\.\d+)?$/.test(text)) return text === '1..1' ? '1' : text
  return text
}
/**
 * Familia de un tipo, para comparar el modelo lógico con el físico. Un enum
 * del diagrama de clases suele guardarse como texto (varchar). null: tipo
 * desconocido (se compara literalmente).
 */
const TYPE_FAMILIES: Array<[RegExp, string]> = [
  [/^(string|str|varchar|nvarchar|char|character|charactervarying|text|citext|clob)$/, 'texto'],
  [/^(int|integer|smallint|bigint|long|short|tinyint|serial|bigserial|smallserial|int2|int4|int8)$/, 'entero'],
  [/^(double|float|real|decimal|numeric|number|money|bigdecimal|doubleprecision|float4|float8)$/, 'decimal'],
  [/^(bool|boolean)$/, 'booleano'],
  [/^(date|datetime|timestamp|timestamptz|timestampwithtimezone|localdate|localdatetime|instant|zoneddatetime|time|timetz)$/, 'fecha'],
  [/^(uuid|guid)$/, 'uuid'],
]
export function typeFamily(type: string, enumNames: Set<string> = new Set()) {
  const base = typeKey(type).replace(/\(.*\)$/, '').replace(/\[\]$/, '')
  if (enumNames.has(base) || /^enum/.test(base)) return 'texto'
  return TYPE_FAMILIES.find(([pattern]) => pattern.test(base))?.[1] ?? null
}

const upper = (value: string) => (value.endsWith('*') ? Infinity : Number(value.split('..').pop()))

type End = { relation: ArchRelation; atA: string | null; atB: string | null }

const relationsRule: RuleSpec = {
  id: 'structure.relations',
  comparison: 'structure',
  title: 'Relaciones compatibles entre diagramas estructurales',
  description: 'Si dos diagramas relacionan los mismos conceptos, no deben invertir la herencia ni el todo-parte, ni declarar multiplicidades distintas para el mismo extremo.',
  requires: [['class', 'package', 'er']],
  precondition: enoughDiagrams,
  run(ctx) {
    const outcome = emptyOutcome()
    const groups = new Map<string, ArchRelation[]>()
    for (const relation of ctx.model.relations) {
      if (!(STRUCTURAL_KINDS as readonly string[]).includes(ctx.kindOf(relation.source))) continue
      const a = ctx.concept(relation.source)
      const b = ctx.concept(relation.target)
      if (a.ambiguous || b.ambiguous || a.id === b.id) continue
      const id = [a.id, b.id].sort().join('|')
      groups.set(id, [...(groups.get(id) ?? []), relation])
    }
    let compared = 0
    for (const [id, relations] of groups) {
      if (new Set(relations.map((relation) => relation.diagramId)).size < 2) continue
      compared += 1
      const [conceptA, conceptB] = id.split('|')
      const labelOf = (conceptId: string) => ctx.concepts.find((concept) => concept.id === conceptId)?.label ?? '?'
      const confidence = Math.min(...relations.map((relation) => Math.min(ctx.concept(relation.source).confidence, ctx.concept(relation.target).confidence)))
      const fromA = (relation: ArchRelation) => ctx.concept(relation.source).id === conceptA
      const evidence = (items: ArchRelation[]) =>
        items.map((relation) => ctx.evidence(relation.diagramId, `${ctx.label(relation.source)} → ${ctx.label(relation.target)} (${relation.type}${relation.sourceMultiplicity || relation.targetMultiplicity ? `, ${relation.sourceMultiplicity ?? '?'} a ${relation.targetMultiplicity ?? '?'}` : ''}).`, [relation.key]))
      const names = `${ctx.label(relations[0].source)} y ${ctx.label(relations[0].target)}`
      let conflict = false

      for (const type of ['generalization', 'composition', 'aggregation'] as const) {
        const items = relations.filter((relation) => relation.type === type)
        if (items.some(fromA) && items.some((relation) => !fromA(relation)) && new Set(items.map((relation) => relation.diagramId)).size > 1) {
          conflict = true
          outcome.findings.push({
            category: 'contradiction', type: type === 'generalization' ? 'inheritance-reversed' : 'whole-part-reversed', severity: type === 'generalization' ? 'high' : 'medium', confidence,
            title: type === 'generalization' ? `Herencia invertida entre ${names}` : `Todo y parte invertidos entre ${names}`,
            description: `Un diagrama dice ${listText(items.filter(fromA).map((relation) => `${ctx.label(relation.source)} → ${ctx.label(relation.target)}`))} y otro ${listText(items.filter((relation) => !fromA(relation)).map((relation) => `${ctx.label(relation.source)} → ${ctx.label(relation.target)}`))}.`,
            elements: items.map((relation) => relation.key),
            evidence: evidence(items),
            explanation: type === 'generalization' ? 'Una clase no puede ser a la vez padre e hija de otra.' : 'Un concepto no puede ser a la vez el todo y la parte del otro.',
            impact: 'Las vistas describen jerarquías incompatibles: la implementación solo puede seguir una.',
            recommendation: 'Decide la dirección correcta y corrige el diagrama que la contradice.',
            subject: [id, type],
          })
        }
      }
      const kinds = new Set(relations.map((relation) => (relation.type === 'generalization' || relation.type === 'realization' ? 'inheritance' : 'association')))
      if (kinds.size > 1) {
        conflict = true
        outcome.findings.push({
          category: 'possible', type: 'relation-kind-conflict', severity: 'medium', confidence: confidence * 0.8,
          title: `${names} se relacionan por herencia en un diagrama y por asociación en otro`,
          description: `Relaciones encontradas: ${listText(relations.map((relation) => `${relation.type} en «${ctx.diagrams.get(relation.diagramId)!.name}»`))}.`,
          elements: relations.map((relation) => relation.key),
          evidence: evidence(relations),
          explanation: '«Es un» y «tiene un» son relaciones de naturaleza distinta; pueden coexistir, pero suele indicar un cambio de diseño no propagado.',
          impact: 'Cambia cómo se reutiliza el comportamiento y cómo se persisten los datos.',
          recommendation: 'Confirma qué relación es la vigente y actualiza el otro diagrama.',
          subject: [id, 'kind'],
        })
      }

      // Multiplicidades por extremo (A y B según los conceptos).
      const ends: End[] = relations
        .filter((relation) => !['generalization', 'realization', 'dependency'].includes(relation.type))
        .map((relation) => {
          const source = normalizeMultiplicity(relation.sourceMultiplicity)
          const target = normalizeMultiplicity(relation.targetMultiplicity)
          return fromA(relation) ? { relation, atA: source, atB: target } : { relation, atA: target, atB: source }
        })
      for (const side of ['atA', 'atB'] as const) {
        const declared = ends.filter((end) => end[side])
        const values = new Set(declared.map((end) => end[side]!))
        if (new Set(declared.map((end) => end.relation.diagramId)).size < 2) continue
        if (values.size === 1) {
          outcome.passed.push({ text: `La multiplicidad de ${names} coincide (${[...values][0]}) en ${new Set(declared.map((end) => end.relation.diagramId)).size} diagramas.`, elements: declared.map((end) => end.relation.key) })
          continue
        }
        conflict = true
        const bounds = new Set([...values].map((value) => (upper(value) > 1 ? 'many' : 'one')))
        const conceptName = labelOf(side === 'atA' ? conceptA : conceptB)
        outcome.findings.push({
          category: 'contradiction', type: 'multiplicity-conflict', severity: bounds.size > 1 ? 'high' : 'medium', confidence,
          title: `Multiplicidades distintas para ${quote(conceptName)} en la relación entre ${names}`,
          description: `El extremo de ${quote(conceptName)} se declara ${listText(declared.map((end) => `${end[side]} en «${ctx.diagrams.get(end.relation.diagramId)!.name}»`))}.`,
          elements: declared.map((end) => end.relation.key),
          evidence: evidence(declared.map((end) => end.relation)),
          explanation: bounds.size > 1 ? 'Un diagrama permite uno y el otro varios: es una diferencia de cardinalidad, no de detalle.' : 'Ambos permiten la misma cantidad máxima pero difieren en la mínima (obligatoriedad).',
          impact: 'Afecta claves foráneas, validaciones y la forma de las colecciones en el código.',
          recommendation: 'Unifica la multiplicidad del extremo en todos los diagramas (el MER suele ser la referencia para la persistencia).',
          subject: [id, side === 'atA' ? conceptA : conceptB, 'multiplicity'],
        })
      }
      if (!conflict && !outcome.passed.some((item) => item.elements.some((key) => relations.some((relation) => relation.key === key)))) {
        outcome.passed.push({ text: `La relación entre ${names} es compatible en ${new Set(relations.map((relation) => relation.diagramId)).size} diagramas.`, elements: relations.map((relation) => relation.key) })
      }
    }
    if (!compared) outcome.noCorrespondence = 'Ningún par de conceptos se relaciona en más de un diagrama estructural.'
    return outcome
  },
}

const membersRule: RuleSpec = {
  id: 'structure.members',
  comparison: 'structure',
  title: 'Tipos y firmas compatibles entre diagramas',
  description: 'Un atributo o una operación del mismo concepto, declarado en dos diagramas con tipo, no debería tener tipos distintos.',
  requires: [['class', 'package', 'er']],
  precondition: enoughDiagrams,
  run(ctx) {
    const outcome = emptyOutcome()
    const enumNames = new Set(ctx.model.elements.filter((element) => element.kind === 'enum').map((element) => typeKey(element.name)))
    for (const concept of ctx.concepts) {
      if (concept.ambiguous) continue
      const members = concept.members.map((key) => ctx.elements.get(key)!).filter((element) => (STRUCTURAL_KINDS as readonly string[]).includes(ctx.diagrams.get(element.diagramId)!.kind))
      if (new Set(members.map((member) => member.diagramId)).size < 2) continue
      const attributes = new Map<string, Array<{ type: string; owner: string }>>()
      for (const member of members) {
        for (const attribute of member.attributes) {
          if (!attribute.type) continue
          const id = normalizeName(attribute.name).replace(/\s+/g, '')
          attributes.set(id, [...(attributes.get(id) ?? []), { type: attribute.type, owner: member.key }])
        }
      }
      for (const [name, items] of attributes) {
        if (new Set(items.map((item) => item.owner)).size < 2) continue
        const types = new Set(items.map((item) => typeKey(item.type)))
        if (types.size === 1) {
          outcome.passed.push({ text: `El atributo «${name}» de ${quote(concept.label)} tiene el mismo tipo en todos los diagramas.`, elements: items.map((item) => item.owner) })
          continue
        }
        // Tipo lógico (clases) y físico (MER) de la misma familia: String ↔ varchar(120), double ↔ numeric(10,2).
        const families = new Set(items.map((item) => typeFamily(item.type, enumNames)))
        if (families.size === 1 && !families.has(null)) {
          outcome.passed.push({ text: `El atributo «${name}» de ${quote(concept.label)} tiene tipos compatibles (${listText([...new Set(items.map((item) => quote(item.type)))])}).`, elements: items.map((item) => item.owner) })
          continue
        }
        outcome.findings.push({
          category: 'possible', type: 'attribute-type-conflict', severity: 'low', confidence: concept.confidence * 0.9,
          title: `El atributo «${name}» de ${quote(concept.label)} tiene tipos incompatibles`,
          description: listText(items.map((item) => `${quote(item.type)} en «${ctx.diagramOf(item.owner).name}»`)),
          elements: items.map((item) => item.owner),
          evidence: items.map((item) => ctx.evidence(ctx.diagramOf(item.owner).id, `${ctx.label(item.owner)}.${name}: ${item.type}`, [item.owner])),
          explanation: 'Puede ser la diferencia natural entre un tipo conceptual y uno físico (String/varchar) o un cambio no propagado.',
          impact: 'Conversión de tipos o pérdida de datos entre capas.',
          recommendation: 'Unifica el tipo o documenta la correspondencia entre el tipo lógico y el físico.',
          heuristic: true,
          subject: [concept.members[0], name],
        })
      }
      const operations = new Map<string, Array<{ returnType: string; owner: string; raw: string }>>()
      for (const member of members) {
        for (const operation of member.operations) {
          if (!operation.returnType) continue
          const id = `${normalizeName(operation.name).replace(/\s+/g, '')}/${operation.params.length}`
          operations.set(id, [...(operations.get(id) ?? []), { returnType: operation.returnType, owner: member.key, raw: operation.raw }])
        }
      }
      for (const [id, items] of operations) {
        if (new Set(items.map((item) => item.owner)).size < 2) continue
        if (new Set(items.map((item) => typeKey(item.returnType))).size === 1) {
          outcome.passed.push({ text: `La operación «${id.split('/')[0]}» de ${quote(concept.label)} tiene la misma firma en todos los diagramas.`, elements: items.map((item) => item.owner) })
          continue
        }
        outcome.findings.push({
          category: 'possible', type: 'signature-conflict', severity: 'medium', confidence: concept.confidence,
          title: `La operación «${id.split('/')[0]}» de ${quote(concept.label)} retorna tipos distintos`,
          description: listText(items.map((item) => `${quote(item.raw)} en «${ctx.diagramOf(item.owner).name}»`)),
          elements: items.map((item) => item.owner),
          evidence: items.map((item) => ctx.evidence(ctx.diagramOf(item.owner).id, item.raw, [item.owner])),
          explanation: 'La misma operación (mismo nombre y número de parámetros) no debería devolver tipos distintos.',
          impact: 'Los consumidores no saben qué esperar de la operación.',
          recommendation: 'Unifica la firma.',
          subject: [concept.members[0], id],
        })
      }
    }
    return outcome
  },
}

export const STRUCTURE_RULES = [relationsRule, membersRule]

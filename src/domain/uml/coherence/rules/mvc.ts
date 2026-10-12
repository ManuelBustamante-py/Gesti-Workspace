/**
 * Reglas MVC (G). Solo se ejecutan si el tablero declara el estilo MVC.
 *
 * La capa de cada elemento se deduce, en orden de fiabilidad, del estereotipo
 * («controller»…), del tipo de participante (boundary/control/entity), del rol
 * en el nombre (…Controller, Vista…) o del paquete que lo contiene. Las
 * dependencias prohibidas vienen de la configuración, así que las variantes
 * legítimas del patrón (vista pasiva, MVC clásico) se respetan.
 */
import { MVC_LAYER_LABELS } from '../settings'
import { listText, quote, terms } from '../names'
import { emptyOutcome, type RuleContext, type RuleSpec } from '../context'
import type { ArchElement, MvcLayer } from '../types'

type Classification = { layer: MvcLayer; basis: string; confidence: number }

const STEREOTYPES: Array<[RegExp, MvcLayer]> = [
  [/^(controller|control|controlador)$/, 'controller'],
  [/^(view|vista|boundary|ui|page|pagina|página|screen|pantalla)$/, 'view'],
  [/^(model|modelo|entity|entidad|domain|dominio)$/, 'model'],
  [/^(repository|repositorio|dao|persistence|persistencia|database)$/, 'data'],
]
const PARTICIPANTS: Record<string, MvcLayer> = { boundary: 'view', control: 'controller', entity: 'model' }
const ROLE: Array<[string[], MvcLayer]> = [
  [['controlador'], 'controller'],
  [['vista', 'pantalla', 'pagina', 'formulario', 'ui'], 'view'],
  [['repositorio', 'dao'], 'data'],
  [['modelo', 'entidad', 'entity'], 'model'],
]

const LAYERED: ArchElement['kind'][] = ['class', 'interface', 'participant', 'component', 'datastore']

export function classify(ctx: RuleContext, element: ArchElement): Classification | null {
  for (const stereotype of element.stereotypes) {
    const found = STEREOTYPES.find(([pattern]) => pattern.test(stereotype))
    if (found) return { layer: found[1], basis: `estereotipo «${stereotype}»`, confidence: 1 }
  }
  if (element.kind === 'participant' && element.subtype && PARTICIPANTS[element.subtype]) {
    return { layer: PARTICIPANTS[element.subtype], basis: `participante de tipo ${element.subtype}`, confidence: 0.9 }
  }
  if (element.kind === 'datastore') return { layer: 'data', basis: 'almacén de datos', confidence: 0.9 }
  const role = ROLE.find(([words]) => terms(element.name).some((term) => words.includes(term)))
  if (role) return { layer: role[1], basis: `rol en el nombre ${quote(element.name)}`, confidence: 0.75 }
  let parent = element.parent
  while (parent) {
    const container = ctx.elements.get(parent)!
    const byPackage = ROLE.find(([words]) => terms(container.name).some((term) => words.includes(term)))
    if (byPackage) return { layer: byPackage[1], basis: `paquete ${quote(container.name)}`, confidence: 0.7 }
    parent = container.parent
  }
  return null
}

/** Capa de un concepto: la clasificación más fiable de sus miembros, y las que discrepan. */
function conceptLayers(ctx: RuleContext) {
  const result = new Map<string, { best: Classification & { element: ArchElement }; conflicts: Array<Classification & { element: ArchElement }> }>()
  for (const concept of ctx.concepts) {
    if (concept.ambiguous) continue
    const found = concept.members
      .map((key) => ctx.elements.get(key)!)
      .filter((element) => LAYERED.includes(element.kind))
      .map((element) => ({ element, classification: classify(ctx, element) }))
      .filter((item): item is { element: ArchElement; classification: Classification } => item.classification !== null)
      .map((item) => ({ ...item.classification, element: item.element }))
      .sort((a, b) => b.confidence - a.confidence)
    if (!found.length) continue
    const best = found[0]
    result.set(concept.id, { best, conflicts: found.filter((item) => item.layer !== best.layer && item.confidence >= 0.75) })
  }
  return result
}

const declaredMvc = (ctx: RuleContext) => (ctx.settings.style === 'mvc' ? null : 'El tablero no declara el estilo MVC (actívalo en la configuración para evaluarlo).')
const layerName = (layer: MvcLayer) => MVC_LAYER_LABELS[layer].toLowerCase()

const dependencyRule: RuleSpec = {
  id: 'mvc.dependencies',
  comparison: 'mvc',
  title: 'Dependencias permitidas entre capas MVC',
  description: 'Las relaciones dirigidas (clases, componentes) y los mensajes (secuencias) entre elementos de capas distintas no deben seguir una dependencia prohibida por la configuración.',
  requires: [['class', 'package', 'sequence', 'component']],
  precondition: declaredMvc,
  run(ctx) {
    const outcome = emptyOutcome()
    const layers = conceptLayers(ctx)
    const forbidden = new Set(ctx.settings.mvc.forbidden.map((rule) => `${rule.from}>${rule.to}`))
    const seen = new Set<string>()
    const check = (fromKey: string, toKey: string, sourceKey: string, what: string) => {
      const from = layers.get(ctx.concept(fromKey).id)
      const to = layers.get(ctx.concept(toKey).id)
      if (!from || !to || from.best.layer === to.best.layer) return
      const id = `${ctx.concept(fromKey).id}>${ctx.concept(toKey).id}>${ctx.kindOf(sourceKey)}`
      if (seen.has(id)) return
      seen.add(id)
      const rule = `${from.best.layer}>${to.best.layer}`
      if (!forbidden.has(rule)) {
        outcome.passed.push({ text: `${ctx.label(fromKey)} (${layerName(from.best.layer)}) → ${ctx.label(toKey)} (${layerName(to.best.layer)}) es una dependencia permitida.`, elements: [sourceKey] })
        return
      }
      const confidence = Math.min(from.best.confidence, to.best.confidence) * Math.min(ctx.concept(fromKey).confidence, ctx.concept(toKey).confidence)
      outcome.findings.push({
        category: 'contradiction', type: 'forbidden-dependency', severity: 'high', confidence,
        title: `Dependencia prohibida: ${layerName(from.best.layer)} → ${layerName(to.best.layer)}`,
        description: `${what} hace que ${ctx.label(fromKey)} (${layerName(from.best.layer)}, por ${from.best.basis}) dependa de ${ctx.label(toKey)} (${layerName(to.best.layer)}, por ${to.best.basis}).`,
        elements: [sourceKey, fromKey, toKey],
        evidence: [ctx.evidence(ctx.diagramOf(sourceKey).id, what, [sourceKey])],
        explanation: `La configuración del tablero prohíbe que ${layerName(from.best.layer)} dependa de ${layerName(to.best.layer)} (variante ${ctx.settings.mvc.variant === 'passive' ? 'vista pasiva' : 'MVC clásico'}).`,
        impact: 'Acopla capas que deberían poder cambiar por separado (p. ej. cambiar la interfaz obligaría a tocar el modelo).',
        recommendation: from.best.layer === 'model' ? 'Usa un observador/evento para que el modelo notifique sin conocer a la vista o al controlador.' : 'Canaliza la interacción a través del controlador.',
        heuristic: Math.min(from.best.confidence, to.best.confidence) < 0.9,
        subject: [fromKey, toKey],
      })
    }
    for (const relation of ctx.model.relations) {
      if (!['class', 'package', 'component'].includes(ctx.kindOf(relation.source))) continue
      if (relation.type === 'generalization' || relation.type === 'realization') continue
      if (relation.directed || relation.type === 'composition' || relation.type === 'aggregation') {
        check(relation.source, relation.target, relation.key, `La relación ${ctx.label(relation.source)} → ${ctx.label(relation.target)} (${relation.type}) en «${ctx.diagramOf(relation.key).name}»`)
      }
    }
    for (const message of ctx.model.messages) {
      if (message.type === 'reply' || message.from === message.to) continue
      check(message.from, message.to, message.key, `El mensaje ${quote(message.label)} de «${ctx.diagramOf(message.key).name}»`)
    }
    if (!layers.size) outcome.noCorrespondence = 'Ningún elemento tiene una capa MVC identificable.'
    return outcome
  },
}

const conflictsRule: RuleSpec = {
  id: 'mvc.layer-conflicts',
  comparison: 'mvc',
  title: 'Misma capa en todas las vistas',
  description: 'Un mismo concepto no debería clasificarse en capas distintas en diagramas diferentes (p. ej. «controller» en clases y boundary en la secuencia).',
  requires: [['class', 'package', 'sequence', 'component']],
  precondition: declaredMvc,
  run(ctx) {
    const outcome = emptyOutcome()
    for (const [conceptId, { best, conflicts }] of conceptLayers(ctx)) {
      const concept = ctx.concepts.find((item) => item.id === conceptId)!
      if (concept.members.length < 2) continue
      if (!conflicts.length) {
        if (concept.diagramIds.length > 1) outcome.passed.push({ text: `${quote(concept.label)} pertenece a la capa ${layerName(best.layer)} en todas sus vistas.`, elements: concept.members })
        continue
      }
      outcome.findings.push({
        category: 'possible', type: 'layer-conflict', severity: 'medium', confidence: concept.confidence * 0.9,
        title: `${quote(concept.label)} se ubica en capas distintas según el diagrama`,
        description: listText([best, ...conflicts].map((item) => `${layerName(item.layer)} en «${ctx.diagramOf(item.element.key).name}» (${item.basis})`)),
        elements: [best.element.key, ...conflicts.map((item) => item.element.key)],
        evidence: [best, ...conflicts].map((item) => ctx.evidence(item.element.diagramId, `${ctx.label(item.element.key)}: ${item.basis}.`, [item.element.key])),
        explanation: 'Las responsabilidades de un elemento deberían ser las mismas en la vista lógica y en la de proceso.',
        impact: 'No queda claro qué reglas de dependencia aplican a este elemento.',
        recommendation: 'Unifica estereotipos y tipos de participante, o confirma que son conceptos distintos (rechaza la equivalencia).',
        heuristic: true,
        subject: concept.members,
      })
    }
    return outcome
  },
}

const CONTROLLER_SMELLS = /render|html|draw|pintar|dibujar|imprimir|sql|query|select|insert|jdbc|commit/i

const controllersRule: RuleSpec = {
  id: 'mvc.controllers',
  comparison: 'mvc',
  title: 'Responsabilidades de los controladores',
  description: 'Un controlador coordina: muchas operaciones, o operaciones de presentación (render, html…) o de persistencia (sql, query…), sugieren responsabilidades de otras capas.',
  requires: [['class', 'package']],
  precondition: declaredMvc,
  run(ctx) {
    const outcome = emptyOutcome()
    const max = ctx.settings.mvc.controllerMaxOperations
    for (const [conceptId, { best }] of conceptLayers(ctx)) {
      if (best.layer !== 'controller') continue
      const operations = ctx.membersOf(conceptId).filter((member) => ['class', 'package'].includes(ctx.diagrams.get(member.diagramId)!.kind)).flatMap((member) => member.operations.map((operation) => ({ operation, owner: member })))
      if (!operations.length) continue
      const names = [...new Set(operations.map((item) => item.operation.name))]
      const smells = operations.filter((item) => CONTROLLER_SMELLS.test(item.operation.name))
      const owner = operations[0].owner
      if (names.length > max) {
        outcome.findings.push({
          category: 'possible', type: 'controller-overloaded', severity: 'low', confidence: best.confidence * 0.8,
          title: `${ctx.label(owner.key)} concentra ${names.length} operaciones`,
          description: `El umbral configurado es ${max}.`,
          elements: [owner.key],
          evidence: [ctx.evidence(owner.diagramId, `Operaciones: ${listText(names.map(quote))}.`, [owner.key])],
          explanation: 'Un controlador con muchas operaciones suele mezclar casos de uso distintos.',
          impact: 'Cambios en funcionalidades no relacionadas tocan la misma clase.',
          recommendation: 'Divide el controlador por caso de uso o recurso, o ajusta el umbral si es intencional.',
          heuristic: true,
          subject: [owner.key, 'size'],
        })
      }
      if (smells.length) {
        outcome.findings.push({
          category: 'possible', type: 'controller-foreign-responsibility', severity: 'medium', confidence: best.confidence * 0.7,
          title: `${ctx.label(owner.key)} tiene operaciones de presentación o persistencia`,
          description: `Operaciones: ${listText(smells.map((item) => quote(item.operation.raw)))}.`,
          elements: [owner.key],
          evidence: [ctx.evidence(owner.diagramId, `Operaciones sospechosas por su nombre: ${listText(smells.map((item) => quote(item.operation.name)))}.`, [owner.key])],
          explanation: 'En MVC el controlador no dibuja la vista ni accede directamente a la base de datos; la detección es por nombre y puede tener falsos positivos.',
          impact: 'Mezclar capas dificulta probar y reemplazar la vista o la persistencia.',
          recommendation: 'Mueve esas responsabilidades a la vista o a un repositorio del modelo.',
          heuristic: true,
          subject: [owner.key, 'smells'],
        })
      }
      if (names.length <= max && !smells.length) outcome.passed.push({ text: `${ctx.label(owner.key)} tiene responsabilidades de coordinación acotadas (${names.length} operaciones).`, elements: [owner.key] })
    }
    return outcome
  },
}

const organizationRule: RuleSpec = {
  id: 'mvc.organization',
  comparison: 'mvc',
  title: 'Organización compatible con MVC',
  description: 'Las capas del patrón deberían estar representadas, y los elementos con capa explícita no deberían estar en un paquete de otra capa.',
  requires: [['class', 'package', 'sequence', 'component']],
  precondition: declaredMvc,
  run(ctx) {
    const outcome = emptyOutcome()
    const layers = conceptLayers(ctx)
    const present = new Set([...layers.values()].map((item) => item.best.layer))
    if (!present.size) return { ...outcome, noCorrespondence: 'Ningún elemento tiene una capa MVC identificable.' }
    const missing = (['view', 'controller', 'model'] as MvcLayer[]).filter((layer) => !present.has(layer))
    if (missing.length) {
      outcome.findings.push({
        category: 'omission', type: 'layer-missing', severity: 'low', confidence: 0.7,
        title: `No se identifican elementos de la capa ${listText(missing.map(layerName))}`,
        description: `Capas identificadas: ${listText([...present].map(layerName))}.`,
        elements: [],
        evidence: ctx.diagramsOfKind('class', 'package', 'sequence', 'component').map((diagram) => ctx.evidence(diagram.id, 'Diagrama revisado para clasificar capas.', [])),
        explanation: 'Puede que la capa exista pero no se haya marcado (estereotipo, nombre o paquete).',
        impact: 'Las reglas de dependencia no se pueden aplicar a esa capa.',
        recommendation: 'Marca los elementos con estereotipos «view», «controller» o «model».',
        heuristic: true,
        subject: missing,
      })
    } else outcome.passed.push({ text: 'Están representadas las capas vista, controlador y modelo.', elements: [] })
    for (const element of ctx.model.elements) {
      if (!element.parent || !LAYERED.includes(element.kind)) continue
      const own = classify(ctx, { ...element, parent: undefined })
      const container = classify(ctx, ctx.elements.get(element.parent)!)
      if (!own || !container || container.basis.startsWith('paquete')) continue
      if (own.layer === container.layer) {
        outcome.passed.push({ text: `${ctx.label(element.key)} está en un paquete de su misma capa.`, elements: [element.key] })
        continue
      }
      outcome.findings.push({
        category: 'possible', type: 'misplaced-in-package', severity: 'low', confidence: Math.min(own.confidence, container.confidence),
        title: `${ctx.label(element.key)} (${layerName(own.layer)}) está en el paquete ${ctx.label(element.parent)} (${layerName(container.layer)})`,
        description: `${ctx.label(element.key)} se clasifica por ${own.basis}; su paquete, por ${container.basis}.`,
        elements: [element.key, element.parent],
        evidence: [ctx.evidence(element.diagramId, `${ctx.label(element.key)} dentro de ${ctx.label(element.parent)}.`, [element.key, element.parent])],
        explanation: 'La organización en paquetes no refleja la capa del elemento.',
        impact: 'Dificulta aplicar y revisar las reglas de dependencia por paquete.',
        recommendation: 'Mueve el elemento al paquete de su capa o corrige su estereotipo.',
        heuristic: true,
        subject: [element.key],
      })
    }
    const unclassified = ctx.model.elements.filter((element) => LAYERED.includes(element.kind) && element.kind !== 'datastore' && !layers.has(ctx.concept(element.key).id))
    if (unclassified.length) {
      outcome.findings.push({
        category: 'unverifiable', type: 'layer-unknown', severity: 'low', confidence: 1,
        title: `${unclassified.length} elemento(s) sin capa MVC identificable`,
        description: listText([...new Set(unclassified.map((element) => quote(element.name)))].slice(0, 12)),
        elements: unclassified.map((element) => element.key),
        evidence: [...new Set(unclassified.map((element) => element.diagramId))].map((id) => ctx.evidence(id, 'Elementos sin estereotipo, rol en el nombre ni paquete de capa.', unclassified.filter((element) => element.diagramId === id).map((element) => element.key))),
        explanation: 'Las reglas de capas no se aplican a estos elementos.',
        impact: 'Puede haber dependencias prohibidas sin detectar.',
        recommendation: 'Agrega estereotipos de capa o agrúpalos en paquetes por capa.',
        subject: ['unclassified'],
      })
    }
    return outcome
  },
}

export const MVC_RULES = [dependencyRule, conflictsRule, controllersRule, organizationRule]

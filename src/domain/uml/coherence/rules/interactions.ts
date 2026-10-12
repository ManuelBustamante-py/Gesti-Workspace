/**
 * Reglas secuencia ↔ clases (B).
 *
 * Una operación invocada que no está en la clase solo es contradicción si el
 * diagrama de clases declara su contrato completo (configuración); si el
 * diagrama es parcial es una omisión, y si la clase no detalla operaciones no
 * es verificable.
 */
import { listText, operationKey, quote, typeKey } from '../names'
import { emptyOutcome, type FindingDraft, type RuleContext, type RuleSpec } from '../context'
import type { ArchElement, ArchMessage, Concept, Operation } from '../types'

const CLASS_DIAGRAMS = ['class', 'package'] as const

/** Clase (en un diagrama de clases) que corresponde a un participante. */
function classFor(ctx: RuleContext, participant: ArchElement) {
  const match = ctx.counterparts(participant.key, (element) => ctx.inDiagramKind(...CLASS_DIAGRAMS)(element) && ['class', 'interface', 'enum'].includes(element.kind))
  return match.length ? { concept: ctx.concept(participant.key), classes: match } : null
}

const participantsOf = (ctx: RuleContext) => ctx.elementsIn(['sequence'], 'participant', 'datastore', 'queue').filter((element) => element.kind === 'participant')

const participantsRule: RuleSpec = {
  id: 'seq-cls.participants',
  comparison: 'seq-cls',
  title: 'Participantes con clase identificable',
  description: 'Cada participante de un escenario (salvo actores y almacenes) debería poder relacionarse con una clase del modelo estructural.',
  requires: [['sequence'], ['class', 'package']],
  run(ctx) {
    const outcome = emptyOutcome()
    const participants = participantsOf(ctx)
    const unmatched = new Map<string, ArchElement[]>()
    for (const participant of participants) {
      const found = classFor(ctx, participant)
      if (found) outcome.passed.push({ text: `El participante ${ctx.where(participant.key)} corresponde a la clase ${ctx.where(found.classes[0].key)}.`, elements: [participant.key, found.classes[0].key] })
      else unmatched.set(participant.diagramId, [...(unmatched.get(participant.diagramId) ?? []), participant])
    }
    if (!outcome.passed.length && participants.length) outcome.noCorrespondence = 'Ningún participante coincide con una clase.'
    for (const [diagramId, items] of unmatched) {
      const pending = items.filter((item) => ctx.correspondences.some((link) => link.status === 'hypothesis' && (link.a === item.key || link.b === item.key)))
      outcome.findings.push({
        category: 'omission', type: 'participant-without-class', severity: 'low', confidence: 0.8,
        title: `Participantes de «${ctx.diagrams.get(diagramId)!.name}» sin clase correspondiente`,
        description: `${listText(items.map((item) => ctx.label(item.key)))} no ${items.length === 1 ? 'coincide' : 'coinciden'} con ninguna clase${pending.length ? `; hay equivalencias por validar para ${listText(pending.map((item) => ctx.label(item.key)))}` : ''}.`,
        elements: items.map((item) => item.key),
        evidence: [ctx.evidence(diagramId, 'Participantes del escenario.', items.map((item) => item.key))],
        explanation: 'Puede ser una capa que el diagrama de clases no modela (interfaz de usuario, servicios externos) o un nombre distinto para la misma clase.',
        impact: 'Los mensajes hacia estos participantes no se pueden contrastar con operaciones declaradas.',
        recommendation: 'Usa el nombre de la clase en el participante o confirma la equivalencia en «Equivalencias».',
        heuristic: true,
        subject: items.map((item) => item.key),
      })
    }
    return outcome
  },
}

const completeContract = (ctx: RuleContext, classes: ArchElement[]) => classes.some((item) => ctx.settings.completeContracts.includes(item.diagramId))

function argumentTypeConflicts(message: ArchMessage, operation: Operation) {
  if (!message.call) return []
  return message.call.args
    .map((arg, index) => ({ arg, param: operation.params[index] }))
    .filter(({ arg, param }) => arg.type && param?.type && typeKey(arg.type) !== typeKey(param.type))
}

const operationsRule: RuleSpec = {
  id: 'seq-cls.operations',
  comparison: 'seq-cls',
  title: 'Operaciones invocadas declaradas en las clases',
  description: 'Cada llamada `operacion(args)` de un escenario debería existir en la clase del receptor (o en sus ancestros) con un número de parámetros compatible.',
  requires: [['sequence'], ['class', 'package']],
  run(ctx) {
    const outcome = emptyOutcome()
    const undetailed = new Map<string, { concept: Concept; classes: ArchElement[]; messages: ArchMessage[] }>()
    let compared = 0
    for (const message of ctx.model.messages) {
      if (!message.call) continue
      const receiver = ctx.elements.get(message.to)!
      if (receiver.kind !== 'participant') continue
      const found = classFor(ctx, receiver)
      if (!found) continue
      compared += 1
      const { concept, classes } = found
      const base = concept.confidence
      const diagramId = message.diagramId
      const callText = `${quote(message.label)} enviado a ${ctx.where(receiver.key)}`
      const classEvidence = (text: string) => ctx.evidence(classes[0].diagramId, text, classes.map((item) => item.key))
      if (classes.some((item) => item.kind === 'enum')) {
        outcome.findings.push({
          category: 'possible', type: 'call-to-enum', severity: 'medium', confidence: base,
          title: `Se invoca una operación sobre la enumeración ${ctx.label(classes[0].key)}`,
          description: `${callText}, pero en el diagrama de clases ${ctx.label(classes[0].key)} es una enumeración.`,
          elements: [message.key, receiver.key, classes[0].key],
          evidence: [ctx.evidence(diagramId, callText, [message.key]), classEvidence(`${ctx.label(classes[0].key)} es «enumeration».`)],
          explanation: 'Una enumeración representa un conjunto de valores; normalmente no recibe mensajes con responsabilidades del escenario.',
          impact: 'La responsabilidad asignada en el escenario no tiene un dueño estructural adecuado.',
          recommendation: 'Revisa si el receptor debería ser otra clase o si la enumeración debería ser una clase.',
          subject: [receiver.key, message.call.name],
        })
        continue
      }
      const declared = ctx.operationsOf(concept.id)
      const named = declared.filter((item) => operationKey(item.operation.name) === operationKey(message.call!.name))
      if (named.length) {
        const arity = message.call.args.length
        const fitting = named.filter((item) => item.operation.params.length === arity)
        if (!fitting.length) {
          outcome.findings.push({
            category: 'possible', type: 'arity-mismatch', severity: 'medium', confidence: base,
            title: `«${message.call.name}» se invoca con ${arity} argumento(s) y se declara con otro número`,
            description: `${callText}; en el diagrama de clases se declara ${listText(named.map((item) => quote(item.operation.raw)))}.`,
            elements: [message.key, receiver.key, ...named.map((item) => item.owner.key)],
            evidence: [ctx.evidence(diagramId, callText, [message.key]), ...named.map((item) => ctx.evidence(item.owner.diagramId, `${ctx.label(item.owner.key)} declara ${quote(item.operation.raw)}.`, [item.owner.key]))],
            explanation: 'Las firmas de la vista de proceso y de la vista lógica no coinciden en el número de parámetros.',
            impact: 'Quien implemente puede seguir una de las dos firmas y romper la otra vista.',
            recommendation: 'Unifica la firma en ambos diagramas (agrega o quita parámetros).',
            subject: [receiver.key, message.call.name],
          })
          continue
        }
        const typed = fitting.map((item) => ({ item, conflicts: argumentTypeConflicts(message, item.operation) }))
        const clean = typed.find((entry) => entry.conflicts.length === 0)
        if (clean) {
          outcome.passed.push({ text: `${quote(message.label)} corresponde a ${quote(clean.item.operation.raw)} de ${ctx.label(clean.item.owner.key)}.`, elements: [message.key, clean.item.owner.key] })
          continue
        }
        const { item, conflicts } = typed[0]
        outcome.findings.push({
          category: 'possible', type: 'argument-type', severity: 'low', confidence: base * 0.9,
          title: `Tipos de argumento incompatibles en «${message.call.name}»`,
          description: `${callText}: ${conflicts.map(({ arg, param }) => `${quote(arg.text)} es ${quote(arg.type!)} y el parámetro ${quote(param!.name)} es ${quote(param!.type!)}`).join('; ')}.`,
          elements: [message.key, item.owner.key],
          evidence: [ctx.evidence(diagramId, callText, [message.key]), ctx.evidence(item.owner.diagramId, `Firma declarada: ${quote(item.operation.raw)}.`, [item.owner.key])],
          explanation: 'El escenario anota tipos que no coinciden con la firma declarada en la clase.',
          impact: 'Puede indicar un cambio de diseño no propagado a una de las vistas.',
          recommendation: 'Corrige el tipo en el escenario o en la firma de la operación.',
          subject: [receiver.key, message.call.name, 'types'],
        })
        continue
      }
      if (completeContract(ctx, classes)) {
        outcome.findings.push({
          category: 'contradiction', type: 'operation-missing', severity: 'high', confidence: base,
          title: `${ctx.label(classes[0].key)} no declara «${message.call.name}», que el escenario invoca`,
          description: `${callText}, pero el contrato de ${ctx.label(classes[0].key)} (declarado completo) no incluye esa operación${declared.length ? `; declara ${listText([...new Set(declared.map((item) => quote(item.operation.name)))])}` : ''}.`,
          elements: [message.key, receiver.key, ...classes.map((item) => item.key)],
          evidence: [ctx.evidence(diagramId, callText, [message.key]), classEvidence(`Operaciones declaradas: ${declared.length ? listText(declared.map((item) => quote(item.operation.raw))) : 'ninguna'}.`)],
          explanation: 'El diagrama de clases se marcó como contrato completo: una operación invocada que no aparece en él contradice el diseño estructural.',
          impact: 'El escenario depende de una responsabilidad que la clase no ofrece.',
          recommendation: `Agrega «${message.call.name}» a ${ctx.label(classes[0].key)} o cambia el escenario para usar una operación existente.`,
          subject: [receiver.key, message.call.name],
        })
      } else if (declared.length) {
        outcome.findings.push({
          category: 'omission', type: 'operation-not-declared', severity: 'medium', confidence: base * 0.8,
          title: `«${message.call.name}» no figura en ${ctx.label(classes[0].key)}`,
          description: `${callText}; la clase declara otras operaciones (${listText([...new Set(declared.map((item) => quote(item.operation.name)))])}) pero no esta.`,
          elements: [message.key, receiver.key, ...classes.map((item) => item.key)],
          evidence: [ctx.evidence(diagramId, callText, [message.key]), classEvidence(`Operaciones declaradas: ${listText(declared.map((item) => quote(item.operation.raw)))}.`)],
          explanation: 'El diagrama de clases no está marcado como contrato completo, así que puede ser una omisión de un diagrama parcial y no una operación inexistente.',
          impact: 'Si la operación no existe, el escenario no se puede implementar con el diseño actual.',
          recommendation: `Agrega la operación a la clase o, si el diagrama de clases es exhaustivo, márcalo como contrato completo para que se evalúe con rigor.`,
          subject: [receiver.key, message.call.name],
        })
      } else {
        const entry = undetailed.get(concept.id) ?? { concept, classes, messages: [] }
        entry.messages.push(message)
        undetailed.set(concept.id, entry)
      }
    }
    for (const { classes, messages } of undetailed.values()) {
      outcome.findings.push({
        category: 'unverifiable', type: 'class-without-operations', severity: 'low', confidence: 1,
        title: `${ctx.label(classes[0].key)} no detalla operaciones`,
        description: `Se le envían ${listText(messages.map((message) => quote(message.label)))}, pero la clase no declara operaciones en ningún diagrama.`,
        elements: [...messages.map((message) => message.key), classes[0].key],
        evidence: [ctx.evidence(classes[0].diagramId, `${ctx.label(classes[0].key)} sin operaciones.`, [classes[0].key])],
        explanation: 'Sin operaciones declaradas no se puede saber si las llamadas existen.',
        impact: 'Las llamadas del escenario quedan sin verificar.',
        recommendation: 'Declara las operaciones públicas de la clase.',
        subject: [classes[0].key],
      })
    }
    if (!compared) outcome.noCorrespondence = 'Ningún mensaje con forma de llamada llega a un participante con clase identificada.'
    return outcome
  },
}

const VOID = /^(void|none|nada|unit)$/i
const EMPTY_REPLY = /^(ok|void|return|retorno|fin|done|listo|ack|-)?$/i

const returnsRule: RuleSpec = {
  id: 'seq-cls.returns',
  comparison: 'seq-cls',
  title: 'Respuestas compatibles con el tipo de retorno',
  description: 'Si una operación se declara `void`, el escenario no debería devolver un valor con contenido como respuesta a esa llamada.',
  requires: [['sequence'], ['class', 'package']],
  run(ctx) {
    const outcome = emptyOutcome()
    for (const diagram of ctx.diagramsOfKind('sequence')) {
      const messages = ctx.messagesOf(diagram)
      messages.forEach((message, index) => {
        if (!message.call) return
        const receiver = ctx.elements.get(message.to)!
        if (receiver.kind !== 'participant') return
        const found = classFor(ctx, receiver)
        if (!found) return
        const named = ctx.operationsOf(found.concept.id).filter((item) => operationKey(item.operation.name) === operationKey(message.call!.name) && item.operation.returnType)
        if (!named.length) return
        const reply = messages.slice(index + 1).find((next) => next.type === 'reply' && next.from === message.to && next.to === message.from)
        const interrupted = reply && messages.slice(index + 1, messages.indexOf(reply)).some((next) => next.type !== 'reply' && next.from === message.from && next.to === message.to)
        if (!reply || interrupted) return
        const allVoid = named.every((item) => VOID.test(item.operation.returnType!.trim()))
        if (allVoid && !EMPTY_REPLY.test(reply.label.trim())) {
          outcome.findings.push({
            category: 'possible', type: 'void-returns-value', severity: 'low', confidence: found.concept.confidence * 0.7,
            title: `«${message.call.name}» se declara void pero el escenario devuelve ${quote(reply.label)}`,
            description: `En «${diagram.name}» ${ctx.label(receiver.key)} responde ${quote(reply.label)} a ${quote(message.label)}; en el diagrama de clases la operación no retorna valor.`,
            elements: [message.key, reply.key, named[0].owner.key],
            evidence: [ctx.evidence(diagram.id, `Respuesta ${quote(reply.label)} a ${quote(message.label)}.`, [message.key, reply.key]), ctx.evidence(named[0].owner.diagramId, `Firma: ${quote(named[0].operation.raw)}.`, [named[0].owner.key])],
            explanation: 'La respuesta podría ser solo una confirmación narrativa; por eso se informa como posible inconsistencia de baja severidad.',
            impact: 'Quien consume la operación puede esperar un dato que no se devuelve.',
            recommendation: 'Declara el tipo de retorno en la clase o indica en el escenario que la respuesta no lleva datos.',
            heuristic: true,
            subject: [receiver.key, message.call.name, 'return'],
          })
        } else if (!allVoid) outcome.passed.push({ text: `La respuesta a ${quote(message.label)} es compatible con el retorno declarado.`, elements: [message.key, reply.key] })
      })
    }
    return outcome
  },
}

const navigationRule: RuleSpec = {
  id: 'seq-cls.navigation',
  comparison: 'seq-cls',
  title: 'Interacciones respaldadas por relaciones estructurales',
  description: 'Si un objeto envía mensajes a otro, el diagrama de clases debería relacionarlos (asociación, dependencia o uso del tipo) y no declarar la navegabilidad en sentido contrario.',
  requires: [['sequence'], ['class', 'package']],
  run(ctx) {
    const outcome = emptyOutcome()
    const pairs = new Map<string, { from: ArchElement; to: ArchElement; fromClass: ArchElement; toClass: ArchElement; fromConcept: Concept; toConcept: Concept; messages: ArchMessage[] }>()
    for (const message of ctx.model.messages) {
      if (message.type === 'reply' || message.from === message.to) continue
      const from = ctx.elements.get(message.from)!
      const to = ctx.elements.get(message.to)!
      if (from.kind !== 'participant' || to.kind !== 'participant') continue
      const fromClass = classFor(ctx, from)
      const toClass = classFor(ctx, to)
      if (!fromClass || !toClass || fromClass.concept.id === toClass.concept.id) continue
      const id = `${fromClass.concept.id}>${toClass.concept.id}`
      const entry = pairs.get(id) ?? { from, to, fromClass: fromClass.classes[0], toClass: toClass.classes[0], fromConcept: fromClass.concept, toConcept: toClass.concept, messages: [] }
      entry.messages.push(message)
      pairs.set(id, entry)
    }
    if (!pairs.size) return { ...outcome, noCorrespondence: 'No hay mensajes entre participantes que correspondan a clases distintas.' }
    for (const pair of pairs.values()) {
      const left = [pair.fromConcept.id, ...ctx.ancestors(pair.fromConcept.id)]
      const right = [pair.toConcept.id, ...ctx.ancestors(pair.toConcept.id)]
      const relations = left.flatMap((a) => right.flatMap((b) => ctx.relationsBetween(a, b)))
      const confidence = Math.min(pair.fromConcept.confidence, pair.toConcept.confidence)
      const messageText = listText(pair.messages.map((message) => quote(message.label)))
      const draft = (finding: Omit<FindingDraft, 'elements' | 'subject'>): FindingDraft => ({
        ...finding,
        elements: [...pair.messages.map((message) => message.key), pair.fromClass.key, pair.toClass.key],
        subject: [pair.fromClass.key, pair.toClass.key],
      })
      if (relations.length) {
        const leftKeys = new Set(left)
        const reversed = relations.every((relation) => relation.directed && relation.type !== 'generalization' && relation.type !== 'realization' && leftKeys.has(ctx.concept(relation.target).id))
        if (reversed && relations.every((relation) => relation.type === 'directed' || relation.type === 'dependency')) {
          outcome.findings.push(draft({
            category: 'possible', type: 'navigability-reversed', severity: 'medium', confidence: confidence * 0.9,
            title: `${ctx.label(pair.fromClass.key)} envía mensajes a ${ctx.label(pair.toClass.key)}, pero la relación va en sentido contrario`,
            description: `En el escenario ${ctx.label(pair.from.key)} envía ${messageText} a ${ctx.label(pair.to.key)}; el diagrama de clases solo declara ${listText(relations.map((relation) => `${ctx.label(relation.source)} → ${ctx.label(relation.target)} (${relation.type})`))}.`,
            evidence: [
              ...[...new Set(pair.messages.map((message) => message.diagramId))].map((id) => ctx.evidence(id, `Mensajes ${messageText}.`, pair.messages.filter((message) => message.diagramId === id).map((message) => message.key))),
              ...relations.map((relation) => ctx.evidence(relation.diagramId, `${ctx.label(relation.source)} → ${ctx.label(relation.target)} (${relation.type}).`, [relation.key])),
            ],
            explanation: 'Para enviar un mensaje, el emisor necesita conocer al receptor; la navegabilidad declarada indica lo contrario.',
            impact: 'La implementación necesitaría una referencia que el diseño estructural no prevé (o invertir la dependencia).',
            recommendation: 'Revisa la dirección de la asociación o de la dependencia, o invierte la interacción (p. ej. con un callback u observador).',
          }))
        } else outcome.passed.push({ text: `La interacción ${ctx.label(pair.fromClass.key)} → ${ctx.label(pair.toClass.key)} está respaldada por una relación estructural.`, elements: [pair.fromClass.key, pair.toClass.key] })
        continue
      }
      const typeName = ctx.membersOf(pair.toConcept.id).map((member) => member.name)
      const usesType = ctx.membersOf(pair.fromConcept.id).some((member) =>
        [...member.attributes.map((attribute) => attribute.type ?? ''), ...member.operations.flatMap((operation) => [operation.returnType ?? '', ...operation.params.map((param) => param.type ?? '')])].some((type) => typeName.some((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(type))),
      )
      if (usesType) {
        outcome.passed.push({ text: `${ctx.label(pair.fromClass.key)} usa el tipo ${ctx.label(pair.toClass.key)} en sus miembros.`, elements: [pair.fromClass.key, pair.toClass.key] })
        continue
      }
      outcome.findings.push(draft({
        category: 'omission', type: 'interaction-without-relation', severity: 'medium', confidence: confidence * 0.85,
        title: `Interacción ${ctx.label(pair.fromClass.key)} → ${ctx.label(pair.toClass.key)} sin relación en el diagrama de clases`,
        description: `En el escenario ${ctx.label(pair.from.key)} envía ${messageText} a ${ctx.label(pair.to.key)}, pero ninguna relación ni tipo de miembro conecta ambas clases.`,
        evidence: [
          ...[...new Set(pair.messages.map((message) => message.diagramId))].map((id) => ctx.evidence(id, `Mensajes ${messageText}.`, pair.messages.filter((message) => message.diagramId === id).map((message) => message.key))),
          ctx.evidence(pair.fromClass.diagramId, `Sin relación entre ${ctx.label(pair.fromClass.key)} y ${ctx.label(pair.toClass.key)}.`, [pair.fromClass.key, pair.toClass.key]),
        ],
        explanation: 'Puede ser una dependencia transitoria (parámetro o variable local) no dibujada, o una relación que falta.',
        impact: 'El acoplamiento real entre las clases no queda documentado.',
        recommendation: `Agrega una dependencia o asociación dirigida de ${ctx.label(pair.fromClass.key)} hacia ${ctx.label(pair.toClass.key)}.`,
      }))
    }
    return outcome
  },
}

export const INTERACTION_RULES = [participantsRule, operationsRule, returnsRule, navigationRule]

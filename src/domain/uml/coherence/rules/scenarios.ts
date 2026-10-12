/**
 * Reglas de escenarios: casos de uso ↔ secuencia (A) y casos de uso ↔ clases (F).
 *
 * Un caso de uso no necesita exactamente un diagrama de secuencia, ni una
 * clase propia: la falta de escenario o de soporte estructural se informa como
 * no verificable u omisión, nunca como contradicción.
 */
import { ACTION_TERMS, ROLE_TERMS, baseName, domainTerms, listText, quote, sameTermSet, splitQualifier, subjectTerms, terms } from '../names'
import { emptyOutcome, type RuleContext, type RuleSpec } from '../context'
import type { ArchDiagram, ArchElement, ArchMessage } from '../types'

export type ScenarioLink = { sequence: ArchDiagram; useCase: ArchElement; score: number; basis: string }

const contains = (haystack: string[], needles: string[]) => needles.length > 0 && needles.every((term) => haystack.includes(term))

const CODE_PREFIX = /^\s*(?:CU|UC)[-\s_]?0*(\d+)\s*[:.\-–—]?\s*/i

/** Código de un caso de uso escrito como prefijo del nombre: «CU-03: Consultar…» → «3». */
export function caseCode(name: string) {
  return CODE_PREFIX.exec(baseName(name))?.[1] ?? null
}

/** Códigos de caso de uso citados en un texto: «Consulta (CU-03, CU-08)» → {3, 8}. */
export function citedCodes(text: string) {
  return new Set([...text.matchAll(/\b(?:CU|UC)[-\s_]?0*(\d+)\b/gi)].map((match) => match[1]))
}

/** Términos del nombre de un caso de uso sin su código ni sus aclaraciones entre paréntesis. */
export function caseTerms(name: string) {
  return terms(splitQualifier(baseName(name).replace(CODE_PREFIX, '')).core)
}

/** Pasos de un escenario que nombran un caso de uso (por el texto del mensaje, el nombre de la llamada o su código). */
export function stepsNaming(messages: ArchMessage[], name: string) {
  const wanted = caseTerms(name)
  const code = caseCode(name)
  return messages.filter((message) => {
    if (message.type === 'reply') return false
    if (code && citedCodes(message.label).has(code)) return true
    const said = terms(message.call?.name ?? message.label)
    return sameTermSet(said, wanted) || contains(terms(message.label), wanted)
  })
}

/**
 * Qué caso de uso realiza cada diagrama de secuencia: por su nombre o título,
 * o porque el actor inicia el escenario con un mensaje que nombra el caso.
 * Si dos casos empatan, el escenario queda sin asignar (ambiguo).
 */
export function scenarioLinks(ctx: RuleContext) {
  const useCases = ctx.elementsIn(['usecase'], 'usecase')
  const links: ScenarioLink[] = []
  const ambiguous: Array<{ sequence: ArchDiagram; candidates: ArchElement[] }> = []
  for (const sequence of ctx.diagramsOfKind('sequence')) {
    const titleText = [sequence.name, sequence.title ?? '']
    const cited = citedCodes(titleText.join(' '))
    const titles = titleText.map((text) => subjectTerms(splitQualifier(text).core)).filter((value) => value.length)
    const messages = ctx.messagesOf(sequence)
    // Un escenario que cita códigos de caso de uso («(CU-03, CU-08)») los realiza todos: no hay ambigüedad.
    const byCode = useCases.filter((useCase) => {
      const code = caseCode(useCase.name)
      return code !== null && cited.has(code)
    })
    if (byCode.length) {
      for (const useCase of byCode) links.push({ sequence, useCase, score: 0.9, basis: `el escenario cita ${quote(`CU-${caseCode(useCase.name)!.padStart(2, '0')}`)}` })
      continue
    }
    const scored = useCases
      .map((useCase) => {
        const wanted = caseTerms(useCase.name)
        if (titles.some((title) => sameTermSet(title, wanted))) return { useCase, score: 0.85, basis: `el nombre del escenario coincide con ${quote(useCase.name)}` }
        if (titles.some((title) => contains(title, wanted) && title.length <= wanted.length + 2)) return { useCase, score: 0.75, basis: `el nombre del escenario incluye ${quote(useCase.name)}` }
        const step = stepsNaming(messages, useCase.name).find((message) => ctx.elements.get(message.from)?.kind === 'actor')
        if (step) return { useCase, score: 0.7, basis: `el actor inicia el paso ${quote(step.label)}` }
        return null
      })
      .filter((item): item is { useCase: ArchElement; score: number; basis: string } => item !== null)
    if (!scored.length) continue
    const best = Math.max(...scored.map((item) => item.score))
    const top = scored.filter((item) => item.score === best)
    const names = new Set(top.map((item) => terms(item.useCase.name).join(' ')))
    if (names.size > 1) ambiguous.push({ sequence, candidates: top.map((item) => item.useCase) })
    // El mismo caso de uso puede estar en varios diagramas de casos de uso: se enlaza con todos.
    else for (const item of top) links.push({ sequence, ...item })
  }
  return { links, ambiguous, useCases }
}

/** Actores que participan en un caso de uso: asociados, sus especializaciones y los de los casos que lo incluyen o extiende. */
function actorsOf(ctx: RuleContext, useCase: ArchElement) {
  const relations = ctx.model.relations.filter((relation) => relation.diagramId === useCase.diagramId)
  const kind = (key: string) => ctx.elements.get(key)?.kind
  const cases = new Set([useCase.key])
  let grew = true
  while (grew) {
    grew = false
    for (const relation of relations) {
      // Quien realiza el caso que incluye a este (o al que este extiende) también lo realiza.
      const via = relation.type === 'include' && cases.has(relation.target) ? relation.source : relation.type === 'extend' && cases.has(relation.source) ? relation.target : null
      if (via && !cases.has(via)) {
        cases.add(via)
        grew = true
      }
    }
  }
  const actors = new Set<string>()
  for (const relation of relations) {
    if (relation.type !== 'association' && relation.type !== 'directed') continue
    if (cases.has(relation.target) && kind(relation.source) === 'actor') actors.add(relation.source)
    if (cases.has(relation.source) && kind(relation.target) === 'actor') actors.add(relation.target)
  }
  grew = true
  while (grew) {
    grew = false
    for (const relation of relations) {
      if (relation.type === 'generalization' && actors.has(relation.target) && !actors.has(relation.source)) {
        actors.add(relation.source)
        grew = true
      }
    }
  }
  return actors
}

const scenarioSupport: RuleSpec = {
  id: 'uc-seq.scenario-support',
  comparison: 'uc-seq',
  title: 'Escenarios que respaldan los casos de uso',
  description: 'Relaciona cada diagrama de secuencia con el caso de uso que realiza (por nombre, título o el paso que inicia el actor). Un caso sin escenario no es un error: queda como no verificable.',
  requires: [['usecase'], ['sequence']],
  run(ctx) {
    const outcome = emptyOutcome()
    const { links, ambiguous, useCases } = scenarioLinks(ctx)
    if (!useCases.length) return { ...outcome, noCorrespondence: 'Los diagramas de casos de uso no tienen casos de uso.' }
    for (const link of links) outcome.passed.push({ text: `${ctx.label(link.useCase.key)} se respalda en el escenario «${link.sequence.name}» (${link.basis}).`, elements: [link.useCase.key] })
    const covered = new Set(links.map((link) => terms(link.useCase.name).join(' ')))
    // Un caso incluido o que extiende puede respaldarse como paso del escenario de otro caso.
    for (const useCase of useCases) {
      const id = terms(useCase.name).join(' ')
      if (covered.has(id)) continue
      const host = links.find((link) => stepsNaming(ctx.messagesOf(link.sequence), useCase.name).length > 0)
      if (!host) continue
      covered.add(id)
      outcome.passed.push({ text: `${ctx.label(useCase.key)} aparece como paso del escenario «${host.sequence.name}».`, elements: [useCase.key] })
    }
    const without = useCases.filter((useCase) => !covered.has(terms(useCase.name).join(' ')))
    if (without.length) {
      outcome.findings.push({
        category: 'unverifiable', type: 'usecase-without-scenario', severity: 'low', confidence: 1,
        title: `${without.length} caso(s) de uso sin escenario de interacción identificable`,
        description: `No se identificó un diagrama de secuencia para ${listText(without.map((item) => ctx.label(item.key)))}.`,
        elements: without.map((item) => item.key),
        evidence: [...new Set(without.map((item) => item.diagramId))].map((id) => ctx.evidence(id, 'Casos de uso declarados sin escenario asociado.', without.filter((item) => item.diagramId === id).map((item) => item.key))),
        explanation: 'Sin escenario no se puede comprobar que los actores, el flujo y las operaciones de estos casos sean compatibles con el resto del modelo. No es una inconsistencia: muchos casos simples no se modelan con secuencias.',
        impact: 'El comportamiento de estos casos queda sin verificación cruzada.',
        recommendation: 'Si alguno es crítico, modela su escenario principal en un diagrama de secuencia con el nombre del caso de uso.',
        subject: without.map((item) => item.key),
      })
    }
    const linked = new Set(links.map((link) => link.sequence.id))
    for (const sequence of ctx.diagramsOfKind('sequence')) {
      const options = ambiguous.find((item) => item.sequence.id === sequence.id)
      if (options) {
        outcome.findings.push({
          category: 'unverifiable', type: 'scenario-ambiguous', severity: 'low', confidence: 0.6,
          title: `No se sabe qué caso de uso realiza «${sequence.name}»`,
          description: `El escenario podría corresponder a ${listText(options.candidates.map((item) => ctx.label(item.key)))}.`,
          elements: options.candidates.map((item) => item.key),
          evidence: [ctx.evidence(sequence.id, 'El nombre y los pasos del escenario coinciden con varios casos de uso.', [])],
          explanation: 'Con una asignación ambigua no se comparan actores ni flujos, para no concluir sobre el caso equivocado.',
          impact: 'Las comprobaciones de actores y de include/extend no se ejecutan para este escenario.',
          recommendation: 'Nombra el diagrama de secuencia como el caso de uso que realiza.',
          heuristic: true,
          subject: [sequence.id],
        })
      } else if (!linked.has(sequence.id)) {
        outcome.findings.push({
          category: 'omission', type: 'scenario-without-usecase', severity: 'low', confidence: 0.7,
          title: `El escenario «${sequence.name}» no corresponde a ningún caso de uso identificable`,
          description: 'Ningún caso de uso coincide con el nombre del diagrama ni con el paso que inicia el actor.',
          elements: [],
          evidence: [ctx.evidence(sequence.id, `Diagrama de secuencia «${sequence.name}»${sequence.title ? ` (título «${sequence.title}»)` : ''}.`, [])],
          explanation: 'Puede ser un escenario técnico legítimo (p. ej. sincronización) o un caso de uso que falta en el diagrama de casos de uso.',
          impact: 'La funcionalidad que describe no tiene trazabilidad hacia los requisitos funcionales.',
          recommendation: 'Si es funcional, agrega el caso de uso o renombra el escenario; si es técnico, ignóralo o registra una excepción.',
          heuristic: true,
          subject: [sequence.id],
        })
      }
    }
    return outcome
  },
}

const actorCompatibility: RuleSpec = {
  id: 'uc-seq.actors',
  comparison: 'uc-seq',
  title: 'Actores del escenario compatibles con el caso de uso',
  description: 'Los actores que intervienen en un escenario deben estar asociados al caso de uso que realiza (directamente, por herencia de actores o por un caso que lo incluye).',
  requires: [['usecase'], ['sequence']],
  run(ctx) {
    const outcome = emptyOutcome()
    const { links } = scenarioLinks(ctx)
    if (!links.length) return { ...outcome, noCorrespondence: 'Ningún escenario se pudo asociar a un caso de uso.' }
    for (const link of links) {
      const allowed = actorsOf(ctx, link.useCase)
      const messages = ctx.messagesOf(link.sequence)
      const actorKeys = [...new Set(messages.flatMap((message) => [message.from, message.to]))].filter((key) => ctx.elements.get(key)?.kind === 'actor')
      const missing: string[] = []
      for (const actor of actorKeys) {
        const inUseCases = ctx.counterparts(actor, (element) => element.diagramId === link.useCase.diagramId && element.kind === 'actor')
        if (!inUseCases.length) {
          missing.push(actor)
          continue
        }
        const match = inUseCases.find((element) => allowed.has(element.key))
        if (match) {
          outcome.passed.push({ text: `${ctx.label(actor)} participa en «${link.sequence.name}» y está asociado a ${ctx.label(link.useCase.key)}.`, elements: [actor, match.key, link.useCase.key] })
          continue
        }
        const confidence = ctx.concept(actor).confidence * link.score
        outcome.findings.push({
          category: 'possible', type: 'actor-mismatch', severity: 'medium', confidence,
          title: `${ctx.label(actor)} participa en un escenario de un caso de uso que no realiza`,
          description: `En «${link.sequence.name}» interviene ${ctx.label(actor)}, pero en el diagrama de casos de uso ese actor no está asociado a ${ctx.label(link.useCase.key)}${allowed.size ? ` (sí lo están ${listText([...allowed].map(ctx.label))})` : ''}.`,
          elements: [actor, inUseCases[0].key, link.useCase.key],
          evidence: [
            ctx.evidence(link.sequence.id, `${ctx.label(actor)} envía o recibe mensajes en el escenario.`, [actor]),
            ctx.evidence(link.useCase.diagramId, `${ctx.label(link.useCase.key)} está asociado a ${allowed.size ? listText([...allowed].map(ctx.label)) : 'ningún actor'}.`, [link.useCase.key, ...allowed]),
          ],
          explanation: `El escenario se asoció a ${ctx.label(link.useCase.key)} porque ${link.basis}. Las vistas de escenarios y de proceso discrepan sobre quién realiza esta funcionalidad.`,
          impact: 'Permisos, interfaces y responsabilidades pueden diseñarse para el actor equivocado.',
          recommendation: `Asocia ${ctx.label(actor)} con ${ctx.label(link.useCase.key)} (o con un actor general del que herede) o corrige el actor del escenario.`,
          heuristic: link.score < 0.85,
          subject: [actor, link.useCase.key],
        })
      }
      if (missing.length) {
        outcome.findings.push({
          category: 'omission', type: 'actor-missing', severity: 'low', confidence: link.score,
          title: `Actores de «${link.sequence.name}» que no aparecen en los casos de uso`,
          description: `${listText(missing.map(ctx.label))} ${missing.length === 1 ? 'interviene' : 'intervienen'} en el escenario, pero no ${missing.length === 1 ? 'figura' : 'figuran'} en el diagrama de casos de uso.`,
          elements: [...missing, link.useCase.key],
          evidence: [ctx.evidence(link.sequence.id, 'Actores del escenario.', missing)],
          explanation: 'Puede tratarse de un sistema externo o de un actor secundario omitido en el diagrama de casos de uso.',
          impact: 'El diagrama de casos de uso no refleja a todos los participantes externos.',
          recommendation: 'Agrega el actor al diagrama de casos de uso o, si es otro nombre del mismo actor, confirma la equivalencia.',
          heuristic: true,
          subject: [...missing, link.useCase.key],
        })
      }
    }
    return outcome
  },
}

const flowRule: RuleSpec = {
  id: 'uc-seq.include-extend',
  comparison: 'uc-seq',
  title: 'Flujos compatibles con «include» y «extend»',
  description: 'Un caso incluido es obligatorio: su paso no debería quedar solo dentro de un fragmento opcional. Un caso que extiende es opcional: no debería aparecer como paso incondicional.',
  requires: [['usecase'], ['sequence']],
  run(ctx) {
    const outcome = emptyOutcome()
    const { links } = scenarioLinks(ctx)
    for (const link of links) {
      const relations = ctx.model.relations.filter((relation) => relation.diagramId === link.useCase.diagramId)
      const messages = ctx.messagesOf(link.sequence)
      for (const relation of relations.filter((item) => item.type === 'include' && item.source === link.useCase.key)) {
        const included = ctx.elements.get(relation.target)!
        const steps = stepsNaming(messages, included.name)
        const alsoRealized = links.some((other) => other.sequence.id === link.sequence.id && other.useCase.key === included.key)
        if (!steps.length && alsoRealized) {
          outcome.passed.push({ text: `El caso incluido ${ctx.label(included.key)} también se realiza en «${link.sequence.name}».`, elements: [relation.key] })
          continue
        }
        if (!steps.length) {
          outcome.findings.push({
            category: 'omission', type: 'include-not-shown', severity: 'low', confidence: link.score,
            title: `«${link.sequence.name}» no muestra el caso incluido ${ctx.label(included.key)}`,
            description: `${ctx.label(link.useCase.key)} incluye ${ctx.label(included.key)}, pero ningún paso del escenario lo nombra.`,
            elements: [link.useCase.key, included.key, relation.key],
            evidence: [ctx.evidence(link.useCase.diagramId, `${ctx.label(link.useCase.key)} «include» ${ctx.label(included.key)}.`, [relation.key])],
            explanation: 'El escenario puede estar abreviado; no se considera contradicción.',
            impact: 'No se puede comprobar en qué momento del flujo ocurre el comportamiento incluido.',
            recommendation: `Agrega el paso (o un fragmento «ref») de ${ctx.label(included.key)} al escenario.`,
            heuristic: true,
            subject: [link.sequence.id, relation.key],
          })
          continue
        }
        const conditional = steps.every((step) => step.fragments.some((fragment) => /^(opt|alt|break)\b/.test(fragment)))
        if (conditional) {
          outcome.findings.push({
            category: 'possible', type: 'include-conditional', severity: 'medium', confidence: 0.8 * link.score,
            title: `El caso incluido ${ctx.label(included.key)} aparece como opcional en «${link.sequence.name}»`,
            description: `${ctx.label(link.useCase.key)} «include» ${ctx.label(included.key)} (siempre ocurre), pero en el escenario su paso solo ocurre dentro de ${listText([...new Set(steps.flatMap((step) => step.fragments))].map(quote))}.`,
            elements: [link.useCase.key, included.key, ...steps.map((step) => step.key)],
            evidence: [
              ctx.evidence(link.useCase.diagramId, `${ctx.label(link.useCase.key)} «include» ${ctx.label(included.key)}.`, [relation.key]),
              ctx.evidence(link.sequence.id, `Paso condicionado: ${listText(steps.map((step) => quote(step.label)))}.`, steps.map((step) => step.key)),
            ],
            explanation: '«include» indica comportamiento obligatorio; un fragmento opt/alt/break lo vuelve condicional.',
            impact: 'Una validación o paso obligatorio podría omitirse en la implementación.',
            recommendation: 'Si el paso es condicional, la relación debería ser «extend»; si es obligatorio, sácalo del fragmento.',
            subject: [link.sequence.id, relation.key],
          })
        } else outcome.passed.push({ text: `El caso incluido ${ctx.label(included.key)} aparece como paso obligatorio de «${link.sequence.name}».`, elements: [relation.key] })
      }
      for (const relation of relations.filter((item) => item.type === 'extend' && item.target === link.useCase.key)) {
        const extension = ctx.elements.get(relation.source)!
        const steps = stepsNaming(messages, extension.name)
        if (!steps.length) continue
        if (steps.some((step) => step.fragments.length === 0)) {
          outcome.findings.push({
            category: 'possible', type: 'extend-unconditional', severity: 'low', confidence: 0.7 * link.score,
            title: `La extensión ${ctx.label(extension.key)} aparece como paso incondicional`,
            description: `${ctx.label(extension.key)} «extend» ${ctx.label(link.useCase.key)} (es opcional), pero en «${link.sequence.name}» su paso no está dentro de ningún fragmento condicional.`,
            elements: [extension.key, link.useCase.key, ...steps.map((step) => step.key)],
            evidence: [
              ctx.evidence(link.useCase.diagramId, `${ctx.label(extension.key)} «extend» ${ctx.label(link.useCase.key)}.`, [relation.key]),
              ctx.evidence(link.sequence.id, `Paso sin condición: ${listText(steps.map((step) => quote(step.label)))}.`, steps.map((step) => step.key)),
            ],
            explanation: '«extend» describe comportamiento que ocurre solo bajo una condición.',
            impact: 'El escenario puede presentar como obligatorio un comportamiento opcional.',
            recommendation: 'Envuelve el paso en un fragmento opt/alt con su condición, o cambia la relación a «include».',
            heuristic: true,
            subject: [link.sequence.id, relation.key],
          })
        } else outcome.passed.push({ text: `La extensión ${ctx.label(extension.key)} aparece condicionada en «${link.sequence.name}».`, elements: [relation.key] })
      }
    }
    return outcome
  },
}

const structuralSupport: RuleSpec = {
  id: 'uc-cls.support',
  comparison: 'uc-cls',
  title: 'Soporte estructural de los casos de uso',
  description: 'Busca, para cada caso de uso, una operación cuyo nombre lo exprese o una clase del concepto de dominio que manipula. No exige una correspondencia uno a uno.',
  requires: [['usecase'], ['class', 'package']],
  run(ctx) {
    const outcome = emptyOutcome()
    const classes = ctx.elementsIn(['class', 'package'], 'class', 'interface', 'enum')
    if (!classes.length) return { ...outcome, noCorrespondence: 'Los diagramas de clases no tienen clases.' }
    const unsupported: ArchElement[] = []
    const seen = new Set<string>()
    for (const useCase of ctx.elementsIn(['usecase'], 'usecase')) {
      const wanted = caseTerms(useCase.name)
      const id = wanted.join(' ')
      if (seen.has(id)) continue
      seen.add(id)
      const nouns = domainTerms(splitQualifier(baseName(useCase.name).replace(CODE_PREFIX, '')).core).filter((term) => !ACTION_TERMS.has(term) && !ROLE_TERMS.has(term))
      const operation = classes.flatMap((item) => item.operations.map((op) => ({ op, owner: item }))).find(({ op }) => sameTermSet(terms(op.name), wanted) || contains(terms(op.name), wanted))
      if (operation) {
        outcome.passed.push({ text: `${ctx.label(useCase.key)} tiene la operación «${operation.op.name}» en ${ctx.where(operation.owner.key)}.`, elements: [useCase.key, operation.owner.key] })
        continue
      }
      const owner = nouns.length ? classes.find((item) => domainTerms(item.name).some((term) => nouns.includes(term))) : undefined
      if (owner) outcome.passed.push({ text: `${ctx.label(useCase.key)} manipula el concepto ${ctx.where(owner.key)}.`, elements: [useCase.key, owner.key] })
      else unsupported.push(useCase)
    }
    if (unsupported.length) {
      outcome.findings.push({
        category: 'unverifiable', type: 'usecase-without-structure', severity: 'low', confidence: 0.6,
        title: `${unsupported.length} caso(s) de uso sin soporte estructural identificable`,
        description: `No se encontró una operación ni una clase del dominio que respalde ${listText(unsupported.map((item) => ctx.label(item.key)))}.`,
        elements: unsupported.map((item) => item.key),
        evidence: [...new Set(unsupported.map((item) => item.diagramId))].map((id) => ctx.evidence(id, 'Casos de uso sin correspondencia estructural por nombre.', unsupported.filter((item) => item.diagramId === id).map((item) => item.key))),
        explanation: 'La búsqueda es por términos: una funcionalidad puede estar repartida en clases con otros nombres o en responsabilidades transversales.',
        impact: 'Si de verdad no hay soporte, el diseño estructural no cubre esa funcionalidad.',
        recommendation: 'Revisa qué clases realizan estos casos; si usan otros nombres, confirma la equivalencia o documenta la operación.',
        heuristic: true,
        subject: unsupported.map((item) => item.key),
      })
    }
    return outcome
  },
}

export const SCENARIO_RULES = [scenarioSupport, actorCompatibility, flowRule, structuralSupport]

/**
 * Interpretación arquitectónica global. Se redacta solo a partir del modelo
 * extraído, las correspondencias y los hallazgos (cada frase cita los
 * hallazgos o conceptos en que se apoya): no es una valoración libre.
 */
import type { RuleContext } from './context'
import { VIEW_LABELS } from './coverage'
import { listText, quote } from './names'
import { scenarioLinks } from './rules/scenarios'
import { classify } from './rules/mvc'
import type { CoherenceFinding, CoherenceIndex, CoherenceStatus, Coverage, GlobalInterpretation } from './types'

const KIND_NAMES: Record<string, string> = { usecase: 'casos de uso', sequence: 'secuencia', class: 'clases', package: 'paquetes', component: 'componentes', deployment: 'despliegue', er: 'entidad-relación' }
const MAX = 8

const uniqueLabels = (ctx: RuleContext, keys: string[]) => [...new Set(keys.map((key) => ctx.concept(key).label))]
const sample = (items: string[]) => listText(items.slice(0, MAX).map(quote)) + (items.length > MAX ? ` y ${items.length - MAX} más` : '')

export function buildInterpretation(ctx: RuleContext, findings: CoherenceFinding[], coverage: Coverage, index: CoherenceIndex, status: CoherenceStatus): GlobalInterpretation {
  const { model } = ctx
  const active = findings.filter((finding) => !finding.exception)
  const result: GlobalInterpretation = { architecture: [], crossCutting: [], scenarios: [], contradictions: [], unmatched: [], unverifiable: [], conclusion: [] }
  const analyzed = model.diagrams.filter((diagram) => !diagram.extraction.failed)
  if (!analyzed.length) {
    result.conclusion.push({ text: 'No hay diagramas analizables (casos de uso, secuencia, clases, paquetes, componentes, despliegue o entidad-relación) con contenido legible.' })
    return result
  }

  // --- Qué arquitectura describen -------------------------------------------------------
  const keysOf = (...kinds: string[]) => model.elements.filter((element) => kinds.includes(element.kind)).map((element) => element.key)
  const kinds = [...new Set(analyzed.map((diagram) => KIND_NAMES[diagram.kind]))]
  result.architecture.push({ text: `Se analizaron ${analyzed.length} diagrama(s) de ${listText(kinds)}.` })
  const actors = uniqueLabels(ctx, keysOf('actor'))
  const useCases = uniqueLabels(ctx, keysOf('usecase'))
  if (actors.length || useCases.length) result.architecture.push({ text: `Funcionalmente, ${actors.length} actor(es) (${sample(actors)}) interactúan con ${useCases.length} caso(s) de uso${useCases.length ? ` (${sample(useCases)})` : ''}.` })
  const classes = uniqueLabels(ctx, ctx.elementsIn(['class', 'package'], 'class', 'interface', 'enum').map((element) => element.key))
  if (classes.length) result.architecture.push({ text: `La vista lógica define ${classes.length} clasificador(es): ${sample(classes)}.` })
  const components = uniqueLabels(ctx, ctx.elementsIn(['component'], 'component', 'datastore', 'queue').map((element) => element.key))
  if (components.length) {
    const dependencies = model.relations
      .filter((relation) => ctx.kindOf(relation.source) === 'component' && relation.directed)
      .map((relation) => `${ctx.label(relation.source)} → ${ctx.label(relation.target)}`)
    result.architecture.push({ text: `Se organiza en ${components.length} componente(s) (${sample(components)})${dependencies.length ? `, con dependencias ${listText([...new Set(dependencies)].slice(0, MAX))}` : ', sin dependencias declaradas'}.` })
  }
  const nodes = ctx.elementsIn(['deployment'], 'node')
  if (nodes.length) {
    const devices = nodes.filter((node) => node.subtype === 'device').map((node) => node.name)
    const servers = nodes.filter((node) => node.subtype !== 'device').map((node) => node.name)
    const placed = ctx.elementsIn(['deployment'], 'artifact', 'component', 'datastore', 'queue')
      .map((element) => ({ element, host: ctx.hostNode(element.key) }))
      .filter((item) => item.host)
      .map((item) => `${ctx.label(item.element.key)} en ${ctx.label(item.host!)}`)
    const style = devices.length && servers.length ? 'una distribución cliente-servidor' : `${nodes.length} nodo(s) de ejecución`
    result.architecture.push({ text: `Físicamente se describe ${style} (${sample([...devices, ...servers])})${placed.length ? `: ${listText(placed.slice(0, MAX))}` : ''}.` })
  }
  const stores = uniqueLabels(ctx, keysOf('datastore'))
  if (stores.length) result.architecture.push({ text: `La persistencia se representa con ${sample(stores)}.` })
  const layered = model.elements.map((element) => classify(ctx, element)).filter((item) => item && item.confidence >= 0.75)
  if (ctx.settings.style === 'mvc') {
    const layers = [...new Set(layered.map((item) => item!.layer))]
    result.architecture.push({ text: `El tablero declara el estilo MVC (${ctx.settings.mvc.variant === 'passive' ? 'vista pasiva' : 'clásico'}); se identifican elementos de ${layers.length ? listText(layers) : 'ninguna capa'}.` })
  } else if (layered.length >= 2) {
    result.architecture.push({ text: 'Estereotipos o nombres sugieren una organización por capas (vista/controlador/modelo), pero el estilo no está declarado: sus reglas no se evaluaron.' })
  }

  // --- Elementos transversales -----------------------------------------------------------
  const shared = ctx.concepts.filter((concept) => concept.diagramIds.length > 1 && !concept.ambiguous).sort((a, b) => b.diagramIds.length - a.diagramIds.length || a.label.localeCompare(b.label))
  for (const concept of shared.slice(0, 10)) {
    result.crossCutting.push({
      text: `${quote(concept.label)} aparece en ${concept.diagramIds.length} diagramas (${listText(concept.diagramIds.map((id) => `«${ctx.diagrams.get(id)!.name}»`))}); correspondencia ${concept.confidence >= 0.9 ? 'confirmada o por nombre idéntico' : 'probable'} (${Math.round(concept.confidence * 100)} %).`,
      concepts: [concept.id],
    })
  }
  if (!shared.length) result.crossCutting.push({ text: 'Ningún elemento se pudo identificar con seguridad en más de un diagrama: las vistas no comparten nombres reconocibles.' })
  const hypotheses = ctx.correspondences.filter((item) => item.status === 'hypothesis')
  if (hypotheses.length) result.crossCutting.push({ text: `Hay ${hypotheses.length} correspondencia(s) probable(s) entre nombres distintos pendientes de validar; no se usaron para concluir.` })

  // --- Escenarios respaldados ------------------------------------------------------------
  const { links } = scenarioLinks(ctx)
  for (const link of links) {
    const related = active.filter((finding) => finding.category !== 'coherent' && finding.diagrams.includes(link.sequence.id) && finding.category !== 'unverifiable')
    result.scenarios.push({
      text: `${quote(link.useCase.name)} se realiza en «${link.sequence.name}»${related.length ? `, con ${related.length} hallazgo(s) a revisar` : ', sin contradicciones ni omisiones detectadas en sus comparaciones'}.`,
      findings: related.map((finding) => finding.id),
    })
  }
  if (!links.length) result.scenarios.push({ text: 'No se pudo asociar ningún escenario de secuencia a un caso de uso.' })

  // --- Contradicciones que afectan a varias vistas ----------------------------------------
  const problems = active.filter((finding) => finding.category === 'contradiction' || finding.category === 'possible')
  const byConcept = new Map<string, CoherenceFinding[]>()
  for (const finding of problems) {
    for (const element of finding.elements) {
      const concept = ctx.concepts.find((item) => item.members.includes(`${element.diagramId}:${element.elementId}`))
      if (concept) byConcept.set(concept.id, [...new Set([...(byConcept.get(concept.id) ?? []), finding])])
    }
  }
  for (const [conceptId, items] of [...byConcept].sort((a, b) => b[1].length - a[1].length)) {
    if (new Set(items.map((item) => item.comparison)).size < 2) continue
    const concept = ctx.concepts.find((item) => item.id === conceptId)!
    result.contradictions.push({ text: `${quote(concept.label)} está involucrado en problemas de ${new Set(items.map((item) => item.comparison)).size} comparaciones distintas: es un punto donde las vistas divergen.`, findings: items.map((item) => item.id), concepts: [conceptId] })
  }
  for (const finding of problems.filter((item) => item.category === 'contradiction').slice(0, 6)) {
    result.contradictions.push({ text: `${finding.id}: ${finding.title} (afecta a ${finding.diagrams.length} diagrama(s)).`, findings: [finding.id] })
  }
  if (!problems.length) result.contradictions.push({ text: 'No se detectaron contradicciones ni posibles inconsistencias en las comparaciones ejecutadas.' })

  // --- Sin correspondencia -----------------------------------------------------------------
  const lonely = (kinds: Parameters<typeof ctx.elementsIn>[0], elementKinds: Parameters<typeof ctx.elementsIn>[1][], others: Parameters<typeof ctx.elementsIn>[0]) => {
    if (!ctx.diagramsOfKind(...others).length) return []
    return [...new Set(ctx.elementsIn(kinds, ...elementKinds).filter((element) => ctx.concept(element.key).diagramIds.length === 1).map((element) => element.name))]
  }
  const lonelyComponents = lonely(['component'], ['component', 'datastore', 'queue'], ['deployment', 'sequence', 'class', 'package'])
  if (lonelyComponents.length) result.unmatched.push({ text: `Componentes sin correspondencia en otras vistas: ${sample(lonelyComponents)}.` })
  const lonelyClasses = lonely(['class', 'package'], ['class', 'interface'], ['sequence', 'component'])
  if (lonelyClasses.length) result.unmatched.push({ text: `Clases que no aparecen en escenarios ni componentes: ${sample(lonelyClasses)}. Puede ser normal en clases de soporte.` })
  const lonelyParticipants = lonely(['sequence'], ['participant'], ['class', 'package', 'component'])
  if (lonelyParticipants.length) result.unmatched.push({ text: `Participantes de secuencia sin clase ni componente: ${sample(lonelyParticipants)}.` })
  const omissions = active.filter((finding) => finding.category === 'omission')
  if (omissions.length) result.unmatched.push({ text: `${omissions.length} posible(s) omisión(es) merecen revisión (no son contradicciones).`, findings: omissions.map((finding) => finding.id) })

  // --- No verificable -----------------------------------------------------------------------
  for (const comparison of coverage.comparisons.filter((item) => item.status !== 'executed')) {
    result.unverifiable.push({ text: `${comparison.title}: ${comparison.reason ?? 'no se ejecutó'}` })
  }
  for (const view of coverage.views.filter((item) => item.missing)) result.unverifiable.push({ text: `Vista ${VIEW_LABELS[view.view].toLowerCase()}: ${view.missing}` })
  const unverifiable = active.filter((finding) => finding.category === 'unverifiable')
  if (unverifiable.length) result.unverifiable.push({ text: `${unverifiable.length} aspecto(s) no verificable(s) dentro de las comparaciones ejecutadas.`, findings: unverifiable.map((finding) => finding.id) })

  // --- Conclusión ----------------------------------------------------------------------------
  const executed = coverage.comparisons.filter((item) => item.status === 'executed').length
  const total = coverage.comparisons.filter((item) => item.id !== 'mvc' || ctx.settings.style === 'mvc').length
  const exceptions = findings.filter((finding) => finding.exception).length
  const coverageText = `Se ejecutaron ${executed} de ${total} comparaciones aplicables entre vistas`
  const indexText = index.value === null ? 'no hubo comprobaciones concluyentes' : `${index.consistent} de ${index.conclusive} comprobaciones concluyentes resultaron coherentes`
  const verdict = {
    'not-evaluable': 'La evidencia disponible no permite evaluar la coherencia entre vistas.',
    contradictions: `Hay ${index.contradictions} contradicción(es) confirmada(s) que deberían resolverse antes de dar el diseño por consistente.`,
    'possible-issues': `No hay contradicciones confirmadas, pero sí ${index.possible} posible(s) inconsistencia(s) por revisar.`,
    'consistent-so-far': 'No se encontraron contradicciones en las partes evaluadas.',
  }[status]
  result.conclusion.push({ text: `${verdict} ${coverageText}; ${indexText}.` })
  if (exceptions) result.conclusion.push({ text: `${exceptions} hallazgo(s) se aceptaron como excepciones justificadas y no cuentan en el índice.` })
  result.conclusion.push({ text: 'Esto no equivale a una arquitectura completamente coherente: solo se evaluaron las relaciones entre las vistas presentes y con correspondencias identificables.' })
  return result
}

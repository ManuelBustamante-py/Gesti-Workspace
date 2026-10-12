/**
 * Cobertura de la evaluación: qué vistas están representadas, qué se puede
 * evaluar en cada una, qué comparaciones se ejecutaron u omitieron (y por qué)
 * y qué artefactos ampliarían el análisis. La cobertura no es coherencia: un
 * modelo puede ser coherente en lo evaluado y tener poca cobertura.
 */
import type { RuleContext, RuleOutcome, RuleSpec } from './context'
import { COMPARISONS } from './rules'
import type { ArchDiagram, ArchitectureView, ComparisonCoverage, Coverage, ViewCoverage } from './types'

export type RuleRun = { rule: RuleSpec; status: 'executed' | 'skipped' | 'disabled'; reason?: string; outcome?: RuleOutcome }

export const VIEW_LABELS: Record<ArchitectureView, string> = {
  scenarios: 'Escenarios (casos de uso)',
  logical: 'Lógica (clases)',
  process: 'Procesos (secuencias)',
  development: 'Desarrollo (componentes, paquetes)',
  physical: 'Física (despliegue)',
  data: 'Datos (entidad-relación)',
}

const VIEW_MISSING: Record<ArchitectureView, string> = {
  scenarios: 'Sin casos de uso no se puede verificar qué funcionalidades respaldan los escenarios ni qué actores las realizan.',
  logical: 'Sin diagrama de clases no se pueden contrastar operaciones, firmas ni relaciones estructurales.',
  process: 'Sin diagramas de secuencia no se puede verificar el comportamiento ni las interacciones entre elementos.',
  development: 'Sin diagrama de componentes no se pueden verificar módulos, dependencias ni la asignación de clases.',
  physical: 'Sin diagrama de despliegue no se puede verificar dónde se ejecutan los componentes ni sus canales físicos.',
  data: 'Sin modelo entidad-relación no se pueden contrastar multiplicidades con la persistencia (vista opcional).',
}

function aspects(ctx: RuleContext, diagram: ArchDiagram): string[] {
  const elements = ctx.model.elements.filter((element) => element.diagramId === diagram.id)
  const relations = ctx.model.relations.filter((relation) => relation.diagramId === diagram.id)
  const count = (...kinds: string[]) => elements.filter((element) => kinds.includes(element.kind)).length
  const result: string[] = []
  switch (diagram.kind) {
    case 'usecase':
      result.push(`«${diagram.name}»: ${count('actor')} actor(es), ${count('usecase')} caso(s) de uso, ${relations.filter((relation) => relation.type === 'include' || relation.type === 'extend').length} include/extend.`)
      break
    case 'sequence': {
      const messages = ctx.model.messages.filter((message) => message.diagramId === diagram.id)
      const calls = messages.filter((message) => message.call).length
      result.push(`«${diagram.name}»: ${elements.length} participante(s), ${messages.length} mensaje(s); ${calls} con forma de llamada a operación.`)
      if (messages.length && !calls) result.push(`«${diagram.name}»: los mensajes son texto libre, así que no se contrastan con operaciones de clases (usa «operacion(args)»).`)
      break
    }
    case 'class':
    case 'package': {
      const classes = elements.filter((element) => ['class', 'interface', 'enum'].includes(element.kind))
      const withOperations = classes.filter((element) => element.operations.length).length
      const multiplicity = relations.filter((relation) => relation.sourceMultiplicity || relation.targetMultiplicity).length
      result.push(`«${diagram.name}»: ${classes.length} clasificador(es), ${withOperations} con operaciones, ${multiplicity} relación(es) con multiplicidad.`)
      result.push(ctx.settings.completeContracts.includes(diagram.id) ? `«${diagram.name}» declara contratos completos: una operación ausente es contradicción.` : `«${diagram.name}» se trata como parcial: una operación ausente es omisión.`)
      break
    }
    case 'component':
      result.push(`«${diagram.name}»: ${count('component', 'datastore', 'queue')} componente(s), ${count('interface')} interfaz(ces), ${relations.length} relación(es).`)
      break
    case 'deployment': {
      const deployable = elements.filter((element) => ['artifact', 'component', 'datastore', 'queue'].includes(element.kind))
      const placed = deployable.filter((element) => ctx.hostNode(element.key)).length
      result.push(`«${diagram.name}»: ${count('node')} nodo(s), ${placed} de ${deployable.length} artefacto(s)/componente(s) ubicados, ${relations.length} conexión(es).`)
      break
    }
    case 'er':
      result.push(`«${diagram.name}»: ${count('entity')} entidad(es), ${relations.length} relación(es).`)
      break
  }
  if (diagram.extraction.failed) return [`«${diagram.name}»: no se pudo leer (${diagram.extraction.issues.join(' ')}).`]
  if (diagram.extraction.confidence < 1) result.push(`«${diagram.name}»: lectura con confianza ${Math.round(diagram.extraction.confidence * 100)} %. ${diagram.extraction.issues.join(' ')}`)
  else if (!elements.length) result.push(`«${diagram.name}» está vacío.`)
  return result
}

export function buildCoverage(ctx: RuleContext, runs: RuleRun[]): Coverage {
  const views: ViewCoverage[] = (Object.keys(VIEW_LABELS) as ArchitectureView[]).map((view) => {
    const diagrams = ctx.model.diagrams.filter((diagram) => diagram.view === view)
    return {
      view,
      label: VIEW_LABELS[view],
      diagrams: diagrams.map((diagram) => ({ id: diagram.id, name: diagram.name, kind: diagram.kind, confidence: diagram.extraction.confidence })),
      aspects: diagrams.flatMap((diagram) => aspects(ctx, diagram)),
      ...(diagrams.length ? {} : { missing: VIEW_MISSING[view] }),
    }
  })

  const comparisons: ComparisonCoverage[] = COMPARISONS.map((spec) => {
    const rules = runs.filter((run) => run.rule.comparison === spec.id)
    const executed = rules.filter((run) => run.status === 'executed')
    const productive = executed.filter((run) => run.outcome!.findings.length || run.outcome!.passed.length)
    const status: ComparisonCoverage['status'] = !executed.length ? 'skipped' : productive.length ? 'executed' : 'no-correspondence'
    const reason = !executed.length
      ? rules.find((run) => run.status === 'skipped')?.reason ?? 'Todas sus reglas están desactivadas.'
      : !productive.length
        ? executed.map((run) => run.outcome!.noCorrespondence).find(Boolean) ?? 'No se encontraron elementos que comparar.'
        : undefined
    return {
      id: spec.id,
      title: spec.title,
      status,
      ...(reason ? { reason } : {}),
      ...(status !== 'executed' ? { enable: spec.enable } : {}),
      rules: rules.map((run) => ({
        id: run.rule.id,
        title: run.rule.title,
        status: run.status,
        ...(run.status !== 'executed'
          ? { reason: run.reason }
          : run.outcome!.noCorrespondence || run.outcome!.notes?.length
            ? { reason: [run.outcome!.noCorrespondence, ...(run.outcome!.notes ?? [])].filter(Boolean).join(' ') }
            : {}),
        checks: (run.outcome?.passed.length ?? 0) + (run.outcome?.findings.length ?? 0),
      })),
    }
  })

  const suggestions: string[] = []
  for (const comparison of comparisons) if (comparison.status !== 'executed' && comparison.id !== 'mvc' && comparison.enable) suggestions.push(`${comparison.title}: ${comparison.enable}`)
  if (ctx.settings.style !== 'mvc') suggestions.push('Si el proyecto sigue MVC, declara el estilo en la configuración para evaluar las dependencias entre capas.')
  const pending = ctx.correspondences.filter((item) => item.status === 'hypothesis').length
  if (pending) suggestions.push(`Valida ${pending} equivalencia(s) propuesta(s) entre nombres distintos: las confirmadas se usan en las comparaciones.`)
  for (const diagram of ctx.model.diagrams) if (diagram.extraction.confidence < 0.8) suggestions.push(`Revisa «${diagram.name}»: su lectura es incierta y baja la confianza de los hallazgos que lo involucran.`)
  for (const ignored of ctx.model.ignored) suggestions.push(`«${ignored.name}» (${ignored.kind}) no se analiza todavía: ${ignored.reason}`)
  if (!ctx.model.diagrams.some((diagram) => diagram.kind === 'er')) suggestions.push('Un modelo entidad-relación permitiría contrastar las multiplicidades de las clases con la persistencia.')
  return { views, comparisons, suggestions: [...new Set(suggestions)] }
}

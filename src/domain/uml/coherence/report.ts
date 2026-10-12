/**
 * Informe de coherencia en Markdown, generado a partir del resultado de la
 * evaluación (no vuelve a analizar nada). Pensado para descargar y compartir.
 */
import { VIEW_LABELS } from './coverage'
import type { ArchitectureReport, CoherenceFinding, FindingCategory, InterpretationItem, Severity } from './types'

export const CATEGORY_LABELS: Record<FindingCategory, string> = {
  contradiction: 'Contradicción confirmada',
  possible: 'Posible inconsistencia',
  omission: 'Advertencia u omisión potencial',
  coherent: 'Coherencia comprobada',
  unverifiable: 'No verificable con la información disponible',
}
export const SEVERITY_LABELS: Record<Severity, string> = { high: 'Alta', medium: 'Media', low: 'Baja' }
export const VALIDATION_LABELS = { deterministic: 'Comprobado por reglas', heuristic: 'Depende de heurísticas: validar', exception: 'Excepción aceptada' } as const

const percent = (value: number) => `${Math.round(value * 100)} %`
const items = (list: InterpretationItem[]) => list.map((item) => `- ${item.text}${item.findings?.length ? ` _(${item.findings.slice(0, 8).join(', ')})_` : ''}`).join('\n')

function findingSection(finding: CoherenceFinding) {
  const lines = [
    `### ${finding.id} · ${finding.title}`,
    '',
    `- **Categoría:** ${CATEGORY_LABELS[finding.category]}${finding.exception ? ' (excepción aceptada)' : ''}`,
    `- **Regla:** ${finding.ruleTitle} (\`${finding.ruleId}\`) · tipo \`${finding.type}\``,
    `- **Severidad:** ${SEVERITY_LABELS[finding.severity]} · **Confianza:** ${percent(finding.confidence)} · **Validación:** ${VALIDATION_LABELS[finding.validation]}`,
    '',
    finding.description,
    '',
    '**Evidencia:**',
    ...finding.evidence.map((item) => `- _${item.diagramName}_: ${item.text}${item.elements.length ? ` [${item.elements.map((element) => element.name).join(', ')}]` : ''}`),
    '',
    `**Por qué:** ${finding.explanation}`,
  ]
  if (finding.category !== 'coherent') lines.push('', `**Impacto:** ${finding.impact}`, '', `**Recomendación:** ${finding.recommendation}`)
  if (finding.exception) lines.push('', `**Justificación de la excepción:** ${finding.exception.justification}${finding.exception.author ? ` (${finding.exception.author})` : ''}`)
  return lines.join('\n')
}

export function reportToMarkdown(report: ArchitectureReport, boardName: string) {
  const { index, interpretation, coverage } = report
  const counts = (Object.keys(CATEGORY_LABELS) as FindingCategory[])
    .map((category) => `| ${CATEGORY_LABELS[category]} | ${report.findings.filter((finding) => finding.category === category && !finding.exception).length} |`)
  const sections = [
    `# Coherencia arquitectónica · ${boardName}`,
    '',
    `**Estado:** ${report.statusLabel}`,
    '',
    index.value === null
      ? '**Índice de coherencia verificada:** sin comprobaciones concluyentes.'
      : `**Índice de coherencia verificada:** ${index.consistent} de ${index.conclusive} comprobaciones concluyentes (${percent(index.value)}). Fórmula: coherentes / (coherentes + contradicciones + posibles inconsistencias). No incluye omisiones, aspectos no verificables ni excepciones, y no mide la cobertura.`,
    '',
    '| Categoría | Hallazgos |',
    '| --- | --- |',
    ...counts,
    '',
    '## Interpretación global',
    '',
    '### Arquitectura descrita', '', items(interpretation.architecture), '',
    '### Elementos transversales', '', items(interpretation.crossCutting), '',
    '### Escenarios respaldados', '', items(interpretation.scenarios), '',
    '### Contradicciones entre vistas', '', items(interpretation.contradictions), '',
    '### Sin correspondencia u omisiones', '', items(interpretation.unmatched) || '- Ninguno.', '',
    '### No verificable', '', items(interpretation.unverifiable) || '- Nada relevante.', '',
    '### Conclusión', '', items(interpretation.conclusion), '',
    '## Cobertura',
    '',
    '| Vista | Diagramas | Observaciones |',
    '| --- | --- | --- |',
    ...coverage.views.map((view) => `| ${VIEW_LABELS[view.view]} | ${view.diagrams.map((diagram) => diagram.name).join(', ') || '—'} | ${(view.missing ?? view.aspects.join(' ')).replace(/\|/g, '/')} |`),
    '',
    '| Comparación | Estado | Motivo |',
    '| --- | --- | --- |',
    ...coverage.comparisons.map((comparison) => `| ${comparison.title} | ${{ executed: 'Ejecutada', skipped: 'Omitida', 'no-correspondence': 'Sin correspondencias' }[comparison.status]} | ${(comparison.reason ?? '').replace(/\|/g, '/')} |`),
    '',
    ...(coverage.suggestions.length ? ['**Para ampliar el análisis:**', '', ...coverage.suggestions.map((item) => `- ${item}`), ''] : []),
    '## Hallazgos',
    '',
    ...report.findings.map(findingSection).flatMap((section) => [section, '']),
  ]
  return sections.join('\n')
}

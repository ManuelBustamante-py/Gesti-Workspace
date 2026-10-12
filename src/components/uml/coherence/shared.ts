import type { ArchitectureReport, CoherenceStatus, ElementRef, FindingCategory } from '../../../domain/uml/coherence'

export const CATEGORY_ICONS: Record<FindingCategory, string> = { contradiction: '✕', possible: '⚠', omission: '◌', coherent: '✓', unverifiable: '?' }
export const CATEGORY_SHORT: Record<FindingCategory, string> = {
  contradiction: 'Contradicciones',
  possible: 'Posibles inconsistencias',
  omission: 'Omisiones',
  unverifiable: 'No verificable',
  coherent: 'Coherente',
}
export const CATEGORY_ORDER: FindingCategory[] = ['contradiction', 'possible', 'omission', 'unverifiable', 'coherent']
export const STATUS_TONE: Record<CoherenceStatus, string> = {
  contradictions: 'arch-tone-contradiction',
  'possible-issues': 'arch-tone-possible',
  'consistent-so-far': 'arch-tone-coherent',
  'not-evaluable': 'arch-tone-unverifiable',
}

export const percent = (value: number) => `${Math.round(value * 100)} %`

/** Enlace al diagrama con el elemento seleccionado (el editor visual lo resalta al abrir). */
export function focusLink(report: ArchitectureReport, listPath: string, ref: ElementRef) {
  const diagram = report.model.diagrams.find((item) => item.id === ref.diagramId)
  const kind = ref.kind === 'message' ? 'message' : ref.kind.startsWith('relation:') ? 'edge' : diagram?.kind === 'sequence' ? 'participant' : 'node'
  const params = new URLSearchParams({ desde: 'coherencia' })
  if (ref.elementId) params.set('foco', `${kind}:${ref.elementId}`)
  return `${listPath}/${ref.diagramId}?${params}`
}

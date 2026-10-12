/** Evaluación de coherencia arquitectónica entre diagramas: API pública del módulo. */
export { evaluateArchitecture } from './evaluate'
export { reportToMarkdown, CATEGORY_LABELS, SEVERITY_LABELS, VALIDATION_LABELS } from './report'
export { defaultSettings, sanitizeSettings, MVC_LAYERS, MVC_LAYER_LABELS, CLASSIC_FORBIDDEN, PASSIVE_FORBIDDEN } from './settings'
export { stableKey } from './matching'
export { normalizeName } from './names'
export { RULES, COMPARISONS } from './rules'
export { VIEW_LABELS } from './coverage'
export type * from './types'

/**
 * Configuración de la evaluación por tablero: estilo declarado, reglas de
 * capas, contratos completos, componentes lógicos, equivalencias validadas y
 * excepciones justificadas. Se guarda como JSON; aquí se sanea lo leído.
 */
import type { ArchitectureException, ArchitectureSettings, MvcLayer } from './types'

export const MVC_LAYERS: MvcLayer[] = ['view', 'controller', 'model', 'data']
export const MVC_LAYER_LABELS: Record<MvcLayer, string> = { view: 'Vista', controller: 'Controlador', model: 'Modelo', data: 'Datos / persistencia' }

/** MVC clásico: el modelo no conoce a la vista ni al controlador, y la vista no accede a la persistencia. */
export const CLASSIC_FORBIDDEN: ArchitectureSettings['mvc']['forbidden'] = [
  { from: 'model', to: 'view' },
  { from: 'model', to: 'controller' },
  { from: 'view', to: 'data' },
  { from: 'data', to: 'view' },
  { from: 'data', to: 'controller' },
]
/** Vista pasiva: además, la vista solo habla con el controlador. */
export const PASSIVE_FORBIDDEN: ArchitectureSettings['mvc']['forbidden'] = [...CLASSIC_FORBIDDEN, { from: 'view', to: 'model' }]

export function defaultSettings(): ArchitectureSettings {
  return {
    version: 1,
    style: 'none',
    mvc: { variant: 'classic', forbidden: CLASSIC_FORBIDDEN.map((rule) => ({ ...rule })), controllerMaxOperations: 12 },
    completeContracts: [],
    logicalComponents: [],
    disabledRules: [],
    equivalences: [],
    exceptions: [],
  }
}

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
const isLayer = (value: unknown): value is MvcLayer => MVC_LAYERS.includes(value as MvcLayer)

/** Configuración válida a partir de lo guardado (datos parciales, dañados o de otra versión). */
export function sanitizeSettings(raw: unknown): ArchitectureSettings {
  const base = defaultSettings()
  if (!raw || typeof raw !== 'object') return base
  const value = raw as Record<string, unknown>
  const mvc = (value.mvc && typeof value.mvc === 'object' ? value.mvc : {}) as Record<string, unknown>
  const forbidden = Array.isArray(mvc.forbidden)
    ? mvc.forbidden
        .filter((rule): rule is { from: MvcLayer; to: MvcLayer } => Boolean(rule) && isLayer((rule as { from?: unknown }).from) && isLayer((rule as { to?: unknown }).to))
        .map((rule) => ({ from: rule.from, to: rule.to }))
    : base.mvc.forbidden
  const max = Number(mvc.controllerMaxOperations)
  return {
    version: 1,
    style: value.style === 'mvc' ? 'mvc' : 'none',
    mvc: {
      variant: mvc.variant === 'passive' ? 'passive' : 'classic',
      forbidden,
      controllerMaxOperations: Number.isFinite(max) && max >= 1 ? Math.round(max) : base.mvc.controllerMaxOperations,
    },
    completeContracts: strings(value.completeContracts),
    logicalComponents: strings(value.logicalComponents),
    disabledRules: strings(value.disabledRules),
    equivalences: Array.isArray(value.equivalences)
      ? value.equivalences
          .filter((item): item is { a: string; b: string; status: 'confirmed' | 'rejected' } =>
            Boolean(item) && typeof item.a === 'string' && typeof item.b === 'string' && (item.status === 'confirmed' || item.status === 'rejected'))
          .map((item) => ({ a: item.a, b: item.b, status: item.status }))
      : [],
    exceptions: Array.isArray(value.exceptions)
      ? value.exceptions
          .filter((item): item is ArchitectureException =>
            Boolean(item) && typeof item.fingerprint === 'string' && typeof item.ruleId === 'string' && typeof item.justification === 'string' && item.justification.trim().length > 0)
          .map((item) => ({
            fingerprint: item.fingerprint,
            ruleId: item.ruleId,
            title: typeof item.title === 'string' ? item.title : '',
            justification: item.justification.trim(),
            ...(typeof item.author === 'string' ? { author: item.author } : {}),
            ...(typeof item.createdAt === 'string' ? { createdAt: item.createdAt } : {}),
          }))
      : [],
  }
}

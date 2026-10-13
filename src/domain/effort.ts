// Esfuerzo (puntos de historia) de las tareas y su uso como peso en el flujo.
// Lógica pura: no depende de Supabase ni de React.

import { descriptionField } from './description'

/** Escala tipo Fibonacci de planning poker: cuanto más grande, más incertidumbre. */
export const EFFORT_SCALE = [1, 2, 3, 5, 8, 13, 21] as const
export const MIN_EFFORT = 0.5
export const MAX_EFFORT = 100

/** Tallas de camiseta habituales en plantillas de historias («3 (M)», «Talla L»). */
const SIZE_POINTS: Record<string, number> = { XS: 1, S: 2, M: 3, L: 5, XL: 8, XXL: 13 }

export function isValidEffort(value: number) {
  return Number.isFinite(value) && value >= MIN_EFFORT && value <= MAX_EFFORT && Math.round(value * 10) === value * 10
}

/**
 * Interpreta un esfuerzo escrito a mano: «5», «5 pts», «Peso 3», «3 (M)», «2,5»
 * o una talla («M», «XL»). Devuelve null si no hay un valor válido.
 */
export function parseEffort(value: unknown): number | null {
  if (typeof value === 'number') return isValidEffort(value) ? value : null
  const text = String(value ?? '').trim()
  if (!text) return null
  const numeric = /(\d+(?:[.,]\d+)?)/.exec(text)
  if (numeric) {
    const parsed = Math.round(Number(numeric[1].replace(',', '.')) * 10) / 10
    return isValidEffort(parsed) ? parsed : null
  }
  const size = /\b(XXL|XL|XS|S|M|L)\b/i.exec(text)
  return size ? SIZE_POINTS[size[1].toUpperCase()] : null
}

export type EffortSource = 'field' | 'description'

type EffortTask = { effort?: number | string | null; description: string | null }

/**
 * Esfuerzo de una tarea: el campo propio manda; si no, la sección
 * «Estimación» de la descripción (historias importadas desde plantillas).
 */
export function taskEffort(task: EffortTask): { value: number; source: EffortSource } | null {
  if (task.effort !== null && task.effort !== undefined) {
    const value = Number(task.effort)
    if (isValidEffort(value)) return { value, source: 'field' }
  }
  const estimate = task.description ? descriptionField(task.description, 'Estimación') : null
  const parsed = estimate ? parseEffort(estimate) : null
  return parsed === null ? null : { value: parsed, source: 'description' }
}

export type EffortWeights = {
  /** Peso de cada tarea existente (estimada o con el promedio). */
  weights: Map<string, number>
  /** Peso de las tareas sin estimar y de las ya eliminadas. */
  fallback: number
  estimated: number
  total: number
  /** Puntos de las tareas estimadas. */
  estimatedPoints: number
}

const round1 = (value: number) => Math.round(value * 10) / 10

/**
 * Pesos para medir el flujo en puntos. Una tarea sin estimar pesa el promedio
 * de las estimadas (o 1 si no hay ninguna): así no desaparece del cálculo ni
 * distorsiona el ritmo.
 */
export function effortWeights(tasks: Array<EffortTask & { id: string }>): EffortWeights {
  const known = new Map<string, number>()
  tasks.forEach((task) => {
    const effort = taskEffort(task)
    if (effort) known.set(task.id, effort.value)
  })
  const estimatedPoints = [...known.values()].reduce((sum, value) => sum + value, 0)
  const fallback = known.size > 0 ? round1(estimatedPoints / known.size) : 1
  const weights = new Map<string, number>()
  tasks.forEach((task) => weights.set(task.id, known.get(task.id) ?? fallback))
  return { weights, fallback, estimated: known.size, total: tasks.length, estimatedPoints: round1(estimatedPoints) }
}

/** Formato corto de un esfuerzo: «5 pts», «1 pt», «2,5 pts». */
export function formatEffort(value: number) {
  return `${value.toLocaleString('es-CL', { maximumFractionDigits: 1 })} ${value === 1 ? 'pt' : 'pts'}`
}

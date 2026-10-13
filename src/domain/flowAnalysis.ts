// Análisis completo del flujo en una unidad (puntos o tareas): proyección,
// burndown e interpretación de cada vista. Lo usan la página y los informes.

import { buildBurndown, burndownStart, type Burndown } from './burndown'
import { computeForecast, type FlowForecast, type FlowPoint, type FlowStatus } from './cfd'
import type { WorkingDays } from './dates'
import { interpretFlow, type FlowInterpretation, type PendingTask } from './flowInsights'

/** Historial máximo graficado: 26 semanas. */
export const MAX_HISTORY_DAYS = 182

export type FlowUnitLabel = { short: string; long: string }

export type PendingTaskBase = { id: string; number: number | null; title: string; status: FlowStatus; endDate: string | null }

export type FlowAnalysis = {
  unit: FlowUnitLabel
  /** Serie completa (para la velocidad) y la graficada (últimas 26 semanas). */
  allPoints: FlowPoint[]
  points: FlowPoint[]
  forecast: FlowForecast
  burndown: Burndown | null
  interpretations: Record<'burndown' | 'cfd', FlowInterpretation>
}

export function analyzeFlow(input: {
  unit: FlowUnitLabel
  allPoints: FlowPoint[]
  /** La misma serie en la otra unidad, para contrastar. */
  other?: { label: string; allPoints: FlowPoint[] } | null
  deadline: string | null
  projectStart: string | null | undefined
  workingDays: WorkingDays
  committed: boolean
  pending: PendingTaskBase[]
  weightOf: (taskId: string) => number
  effort?: { estimated: number; total: number; fallback: number }
}): FlowAnalysis | null {
  const forecast = computeForecast(input.allPoints, input.deadline)
  if (!forecast) return null
  const points = input.allPoints.slice(-MAX_HISTORY_DAYS)
  const start = burndownStart(points, input.projectStart)
  const burndown = start ? buildBurndown(points, { start, deadline: input.deadline, workingDays: input.workingDays }) : null
  const pending: PendingTask[] = input.pending.map((task) => ({
    number: task.number,
    title: task.title,
    status: task.status,
    endDate: task.endDate,
    weight: input.weightOf(task.id),
  }))
  const otherForecast = input.other ? computeForecast(input.other.allPoints, input.deadline) : null
  const interpretationInput = {
    unit: input.unit,
    points: input.allPoints,
    forecast,
    burndown,
    committed: input.committed,
    pending,
    effort: input.effort,
    alternate: input.other ? { label: input.other.label, points: input.other.allPoints, forecast: otherForecast } : undefined,
  }
  return {
    unit: input.unit,
    allPoints: input.allPoints,
    points,
    forecast,
    burndown,
    interpretations: { burndown: interpretFlow(interpretationInput, 'burndown'), cfd: interpretFlow(interpretationInput, 'cfd') },
  }
}

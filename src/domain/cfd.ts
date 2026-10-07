// Diagrama de Flujo Acumulado (CFD) y proyección de entrega.
// Lógica pura: recibe el historial de estados y devuelve series y diagnóstico.

import { addDays, diffDays, localDateToKey } from './dates'

export type FlowStatus = 'todo' | 'in_progress' | 'done'

export const flowLabels: Record<FlowStatus, string> = {
  done: 'Listo',
  in_progress: 'En progreso',
  todo: 'Por hacer',
}

export type StatusEvent = {
  task_id: string
  status: FlowStatus | 'removed'
  occurred_at: string
}

export type FlowPoint = {
  day: string
  todo: number
  in_progress: number
  done: number
  total: number
}

/** Días de historial usados para medir la velocidad (throughput). */
export const THROUGHPUT_WINDOW_DAYS = 28
/** Días hacia atrás con los que se compara el trabajo en curso (WIP). */
export const WIP_TREND_DAYS = 14

/**
 * Serie diaria: cuántas tareas había en cada estado al final de cada día, desde
 * el primer evento hasta `endDay`. Los días se toman en la zona horaria local.
 */
export function buildDailyFlow(events: StatusEvent[], endDay: string): FlowPoint[] {
  if (events.length === 0) return []
  const sorted = [...events].sort((left, right) => left.occurred_at.localeCompare(right.occurred_at))
  const dayOf = (event: StatusEvent) => localDateToKey(new Date(event.occurred_at))
  const firstDay = dayOf(sorted[0])
  if (firstDay > endDay) return []

  const current = new Map<string, FlowStatus>()
  const points: FlowPoint[] = []
  let index = 0
  for (let day = firstDay; day <= endDay; day = addDays(day, 1)) {
    while (index < sorted.length && dayOf(sorted[index]) <= day) {
      const event = sorted[index]
      if (event.status === 'removed') current.delete(event.task_id)
      else current.set(event.task_id, event.status)
      index += 1
    }
    const point: FlowPoint = { day, todo: 0, in_progress: 0, done: 0, total: current.size }
    current.forEach((status) => {
      point[status] += 1
    })
    points.push(point)
  }
  return points
}

export type FlowRisk =
  | 'complete'      // no queda trabajo pendiente
  | 'on_track'      // la proyección termina antes o en la fecha límite
  | 'at_risk'       // la proyección termina después de la fecha límite
  | 'overdue'       // la fecha límite ya pasó y queda trabajo
  | 'no_velocity'   // no se completó nada en la ventana: no hay proyección
  | 'no_deadline'   // hay proyección pero el Gantt no tiene fechas

export type FlowForecast = {
  today: string
  current: FlowPoint
  remaining: number
  /** Tareas completadas por semana (neto) en la ventana medida. */
  throughputPerWeek: number
  windowDays: number
  projectedFinish: string | null
  deadline: string | null
  /** Positivo: días de retraso proyectado; negativo: días de margen. */
  daysLate: number | null
  /** Tareas por semana necesarias para cumplir la fecha límite. */
  requiredPerWeek: number | null
  /** Tiempo de ciclo aproximado (ley de Little): WIP / throughput, en días. */
  cycleTimeDays: number | null
  wipNow: number
  wipBefore: number
  bottleneck: boolean
  lowConfidence: boolean
  risk: FlowRisk
}

export function computeForecast(points: FlowPoint[], deadline: string | null): FlowForecast | null {
  if (points.length === 0) return null
  const lastIndex = points.length - 1
  const current = points[lastIndex]
  const today = current.day

  const windowStart = points[Math.max(0, lastIndex - THROUGHPUT_WINDOW_DAYS)]
  const windowDays = lastIndex - Math.max(0, lastIndex - THROUGHPUT_WINDOW_DAYS)
  const completedInWindow = Math.max(0, current.done - windowStart.done)
  const perDay = windowDays > 0 ? completedInWindow / windowDays : 0
  const remaining = current.total - current.done

  let projectedFinish: string | null = null
  if (remaining === 0) projectedFinish = today
  else if (perDay > 0) projectedFinish = addDays(today, Math.ceil(remaining / perDay))

  const daysLate = projectedFinish && deadline ? diffDays(deadline, projectedFinish) : null
  const daysToDeadline = deadline ? diffDays(today, deadline) : null
  const requiredPerWeek = deadline && daysToDeadline !== null && daysToDeadline > 0 && remaining > 0
    ? remaining / (daysToDeadline / 7)
    : null

  const wipBefore = points[Math.max(0, lastIndex - WIP_TREND_DAYS)].in_progress
  const wipNow = current.in_progress
  // Cuello de botella: el trabajo en curso crece claramente mientras no sale trabajo terminado al mismo ritmo.
  const bottleneck = wipNow >= 2 && wipNow >= Math.ceil(wipBefore * 1.5) && wipNow > wipBefore &&
    (perDay * WIP_TREND_DAYS) < (wipNow - wipBefore)

  let risk: FlowRisk
  if (remaining === 0) risk = 'complete'
  else if (deadline && daysToDeadline !== null && daysToDeadline < 0) risk = 'overdue'
  else if (perDay === 0) risk = 'no_velocity'
  else if (!deadline) risk = 'no_deadline'
  else risk = daysLate !== null && daysLate > 0 ? 'at_risk' : 'on_track'

  return {
    today,
    current,
    remaining,
    throughputPerWeek: perDay * 7,
    windowDays,
    projectedFinish,
    deadline,
    daysLate,
    requiredPerWeek,
    cycleTimeDays: perDay > 0 && wipNow > 0 ? wipNow / perDay : null,
    wipNow,
    wipBefore,
    bottleneck,
    lowConfidence: windowDays < 14,
    risk,
  }
}

/** Fecha límite del Gantt: el fin planificado más tardío entre las tareas con fechas. */
export function ganttDeadline(tasks: Array<{ end_date: string | null }>) {
  return tasks.reduce<string | null>((latest, task) => (task.end_date && (!latest || task.end_date > latest) ? task.end_date : latest), null)
}

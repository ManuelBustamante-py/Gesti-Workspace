// Burndown: trabajo restante día a día frente a la línea ideal hasta el plazo.
// Lógica pura: parte de la serie diaria del flujo acumulado (en tareas o puntos).

import type { FlowPoint } from './cfd'
import { addDays, ALL_DAYS, countWorkingDays, diffDays, type WorkingDays } from './dates'

export type BurndownPoint = {
  day: string
  /** Trabajo pendiente al final del día (alcance − completado). */
  remaining: number
  /** Alcance total al final del día. */
  scope: number
  /** Trabajo terminado ese día (neto de reaperturas). */
  completed: number
  /** Alcance añadido (positivo) o quitado (negativo) ese día. */
  scopeChange: number
  /** Restante ideal al final del día; null sin plazo. */
  ideal: number | null
}

export type Burndown = {
  start: string
  /** Restante al cierre del día de inicio: punto de partida de la línea ideal. */
  baseline: number
  deadline: string | null
  points: BurndownPoint[]
  /** Restante ideal en cualquier día (también futuro); null sin plazo. */
  idealAt: (day: string) => number | null
  /** Alcance neto añadido desde el inicio. */
  scopeAdded: number
  /** Trabajo terminado desde el inicio (neto). */
  completedSinceStart: number
  /** Positivo: trabajo por encima de lo ideal hoy (atraso); negativo: adelanto. */
  deviation: number | null
  /** Días hábiles restantes hasta el plazo, hoy excluido. */
  workingDaysLeft: number | null
  /** Trabajo que la línea ideal quema por día hábil; null sin plazo. */
  idealPerWorkingDay: number | null
}

const round1 = (value: number) => Math.round(value * 10) / 10

/**
 * Elige el inicio del burndown: el inicio del proyecto si ya hay historial ese
 * día; si no, el primer día con historial.
 */
export function burndownStart(points: FlowPoint[], projectStart: string | null | undefined) {
  if (points.length === 0) return null
  const first = points[0].day
  const last = points[points.length - 1].day
  if (projectStart && projectStart > first && projectStart <= last) return projectStart
  return first
}

/**
 * Construye el burndown desde `start` hasta el último día de la serie.
 *
 * La línea ideal baja de forma lineal desde el restante del día de inicio
 * hasta 0 en el plazo, solo en días hábiles (en los no hábiles queda plana),
 * como en Jira o Azure DevOps. No se ajusta a los cambios de alcance: así el
 * crecimiento del alcance se ve como desviación.
 */
export function buildBurndown(
  points: FlowPoint[],
  options: { start: string; deadline: string | null; workingDays?: WorkingDays },
): Burndown {
  const workingDays = options.workingDays?.length ? options.workingDays : ALL_DAYS
  const { start, deadline } = options
  const sinceStart = points.filter((point) => point.day >= start)
  const before = points.filter((point) => point.day < start).at(-1)
  const first = sinceStart[0]
  const baseline = first ? round1(first.total - first.done) : 0

  // Días hábiles posteriores al inicio hasta el plazo: los que «queman» trabajo.
  const burnDays = deadline && deadline > start ? countWorkingDays(addDays(start, 1), deadline, workingDays) : 0
  const idealAt = (day: string): number | null => {
    if (!deadline) return null
    if (day <= start) return baseline
    if (day >= deadline || burnDays === 0) return 0
    const elapsed = countWorkingDays(addDays(start, 1), day, workingDays)
    return round1(Math.max(0, baseline * (1 - elapsed / burnDays)))
  }

  let previousScope = before?.total ?? first?.total ?? 0
  const result: BurndownPoint[] = sinceStart.map((point, index) => {
    // El primer día solo cuenta el cambio de alcance si hay historial previo.
    const scopeChange = index === 0 && !before ? 0 : round1(point.total - previousScope)
    previousScope = point.total
    return {
      day: point.day,
      remaining: round1(point.total - point.done),
      scope: point.total,
      completed: index === 0 && !before ? 0 : point.completed,
      scopeChange,
      ideal: idealAt(point.day),
    }
  })

  const last = result.at(-1)
  const today = last?.day ?? start
  return {
    start,
    baseline,
    deadline,
    points: result,
    idealAt,
    scopeAdded: round1(result.reduce((sum, point) => sum + point.scopeChange, 0)),
    completedSinceStart: round1(result.reduce((sum, point) => sum + point.completed, 0)),
    deviation: last && last.ideal !== null ? round1(last.remaining - last.ideal) : null,
    workingDaysLeft: deadline ? (deadline > today ? countWorkingDays(addDays(today, 1), deadline, workingDays) : 0) : null,
    idealPerWorkingDay: deadline && burnDays > 0 ? baseline / burnDays : null,
  }
}

/**
 * Restante proyectado en un día futuro al ritmo medido: baja en línea recta
 * desde el restante de hoy hasta 0 en el fin proyectado.
 */
export function projectedRemainingAt(day: string, today: string, remainingToday: number, projectedFinish: string | null) {
  if (!projectedFinish || day < today) return null
  if (day >= projectedFinish) return 0
  const span = Math.max(1, diffDays(today, projectedFinish))
  return round1(remainingToday * (1 - diffDays(today, day) / span))
}

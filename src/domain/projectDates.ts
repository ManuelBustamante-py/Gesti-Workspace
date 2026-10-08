import { addDays, isWorkingDay, workingDayOrdinal, type WorkingDays } from './dates'

export type DatedTask = {
  id: string
  start_date: string | null
  end_date: string | null
}

export type TaskDates = { id: string; start_date: string | null; end_date: string | null }

/** Primer día laborable igual o posterior a la fecha. */
function nextWorkingDay(date: string, workingDays: WorkingDays) {
  let day = date
  for (let step = 0; step < 7 && !isWorkingDay(day, workingDays); step += 1) day = addDays(day, 1)
  return day
}

/** Último día laborable igual o anterior a la fecha. */
function previousWorkingDay(date: string, workingDays: WorkingDays) {
  let day = date
  for (let step = 0; step < 7 && !isWorkingDay(day, workingDays); step += 1) day = addDays(day, -1)
  return day
}

/**
 * Mueve una fecha `days` días hábiles. Un inicio que cae en día no laborable
 * cuenta desde el siguiente hábil; un fin, desde el anterior (igual que el
 * cálculo de la ruta crítica). Con 0 días la fecha no cambia.
 */
export function shiftWorkingDays(date: string, days: number, workingDays: WorkingDays, edge: 'start' | 'end') {
  if (days === 0) return date
  const anchor = edge === 'start' ? nextWorkingDay(date, workingDays) : previousWorkingDay(date, workingDays)
  const target = workingDayOrdinal(anchor, workingDays) + days
  // Estimación por semanas y ajuste fino día a día.
  let day = addDays(anchor, Math.trunc((days * 7) / workingDays.length))
  for (;;) {
    const ordinal = workingDayOrdinal(day, workingDays)
    if (ordinal === target && isWorkingDay(day, workingDays)) return day
    // Con el mismo ordinal pero no laborable, el día hábil buscado es posterior.
    day = addDays(day, ordinal <= target ? 1 : -1)
  }
}

/** Días hábiles para pasar de un inicio a otro (negativo si se adelanta). */
export function workingDaysBetween(from: string, to: string, workingDays: WorkingDays) {
  return workingDayOrdinal(nextWorkingDay(to, workingDays), workingDays) - workingDayOrdinal(nextWorkingDay(from, workingDays), workingDays)
}

/** Inicio más temprano y fin más tardío de las tareas: el rango del proyecto si el tablero no fija uno. */
export function tasksDateRange(tasks: DatedTask[]) {
  let start: string | null = null
  let end: string | null = null
  for (const task of tasks) {
    if (task.start_date && (!start || task.start_date < start)) start = task.start_date
    if (task.end_date && (!end || task.end_date > end)) end = task.end_date
  }
  return { start, end }
}

export type ReschedulePlan = {
  /** Días hábiles que se mueven las tareas pendientes (0 si no se mueven). */
  shiftDays: number
  /** Tareas pendientes con fechas nuevas. */
  moved: Array<{ before: TaskDates; after: TaskDates }>
  /** Tareas pendientes que (ya movidas) terminan después del fin comprometido. */
  endAfterProject: string[]
  /** Tareas pendientes que (ya movidas) empiezan antes del inicio del proyecto. */
  startBeforeProject: string[]
}

/**
 * Qué pasa con las tareas al cambiar las fechas del proyecto.
 *
 * - Cambiar el inicio desplaza las tareas pendientes los mismos días hábiles,
 *   así conservan duración, orden y dependencias (si `shiftTasks`).
 * - Cambiar el fin no mueve tareas: es la meta. Solo se informan las que
 *   quedan después.
 * - Las tareas completadas nunca se mueven: sus fechas son historial.
 *
 * `previousStart` es el inicio vigente (el del tablero o, si no tiene, el de
 * las tareas): el desplazamiento se mide desde ahí.
 */
export function planProjectDates(input: {
  pendingTasks: DatedTask[]
  previousStart: string | null
  start: string | null
  end: string | null
  shiftTasks: boolean
  workingDays: WorkingDays
}): ReschedulePlan {
  const { pendingTasks, previousStart, start, end, shiftTasks, workingDays } = input
  const shiftDays = shiftTasks && previousStart && start ? workingDaysBetween(previousStart, start, workingDays) : 0

  const moved: ReschedulePlan['moved'] = []
  const endAfterProject: string[] = []
  const startBeforeProject: string[] = []
  for (const task of pendingTasks) {
    const after: TaskDates = {
      id: task.id,
      start_date: task.start_date && shiftWorkingDays(task.start_date, shiftDays, workingDays, 'start'),
      end_date: task.end_date && shiftWorkingDays(task.end_date, shiftDays, workingDays, 'end'),
    }
    // Una tarea de un día que empieza y termina en no laborable no puede quedar invertida.
    if (after.start_date && after.end_date && after.start_date > after.end_date) after.end_date = after.start_date
    if (after.start_date !== task.start_date || after.end_date !== task.end_date) {
      moved.push({ before: { id: task.id, start_date: task.start_date, end_date: task.end_date }, after })
    }
    if (end && after.end_date && after.end_date > end) endAfterProject.push(task.id)
    if (start && after.start_date && after.start_date < start) startBeforeProject.push(task.id)
  }
  return { shiftDays, moved, endAfterProject, startBeforeProject }
}

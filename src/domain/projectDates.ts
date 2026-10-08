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

/**
 * Comprime las fechas pendientes para que todo termine en `end`.
 *
 * Se trabaja en días hábiles. Lo que ocurre hasta hoy (o hasta el inicio más
 * temprano pendiente, si es posterior) no se toca; desde ahí, cada fecha se
 * acerca proporcionalmente. Inicios y fines se redondean igual, así una tarea
 * que empezaba al terminar su predecesora sigue haciéndolo: se conservan el
 * orden y las dependencias. Cada tarea dura al menos un día.
 *
 * Devuelve null si no hay días hábiles entre hoy y el fin para reprogramar.
 */
export function fitToEnd(dates: TaskDates[], end: string, today: string, workingDays: WorkingDays): TaskDates[] | null {
  const startOrdinal = (day: string) => workingDayOrdinal(nextWorkingDay(day, workingDays), workingDays)
  // Fin exclusivo: el día hábil siguiente al último día de trabajo.
  const endOrdinal = (day: string) => workingDayOrdinal(previousWorkingDay(day, workingDays), workingDays) + 1

  const limit = endOrdinal(end)
  const latest = Math.max(
    -Infinity,
    ...dates.map((task) => (task.end_date ? endOrdinal(task.end_date) : task.start_date ? startOrdinal(task.start_date) + 1 : -Infinity)),
  )
  if (latest <= limit) return dates

  const earliest = Math.min(
    Infinity,
    ...dates.map((task) => (task.start_date ? startOrdinal(task.start_date) : task.end_date ? endOrdinal(task.end_date) - 1 : Infinity)),
  )
  const pivot = Math.max(startOrdinal(today), earliest)
  if (limit - pivot < 1) return null

  const scale = (limit - pivot) / (latest - pivot)
  const map = (ordinal: number) => (ordinal <= pivot ? ordinal : pivot + Math.round((ordinal - pivot) * scale))
  const reference = nextWorkingDay(today, workingDays)
  const dateAt = (ordinal: number) =>
    shiftWorkingDays(reference, ordinal - workingDayOrdinal(reference, workingDays), workingDays, 'start')

  return dates.map((task) => {
    const start = task.start_date ? startOrdinal(task.start_date) : null
    const finish = task.end_date ? endOrdinal(task.end_date) : null
    let nextStart = start === null ? null : map(start)
    let nextFinish = finish === null ? null : map(finish)
    if (nextStart !== null && nextFinish !== null && nextFinish <= nextStart) {
      nextFinish = Math.min(nextStart + 1, limit)
      nextStart = Math.min(nextStart, nextFinish - 1)
    }
    return {
      id: task.id,
      // Si el ordinal no cambia se conserva la fecha original tal cual.
      start_date: start === null || nextStart === start ? task.start_date : dateAt(nextStart!),
      end_date: finish === null || nextFinish === finish ? task.end_date : dateAt(nextFinish! - 1),
    }
  })
}

export type ReschedulePlan = {
  /** Días hábiles que se mueven las tareas pendientes (0 si no se mueven). */
  shiftDays: number
  /** Tareas pendientes con fechas nuevas. */
  moved: Array<{ before: TaskDates; after: TaskDates }>
  /** Tareas pendientes que (antes de ajustar al fin) terminan después del fin comprometido. */
  overflowing: string[]
  /** Se comprimieron las pendientes para que terminen en el fin. */
  fitted: boolean
  /** Se pidió ajustar al fin, pero no quedan días hábiles entre hoy y el fin. */
  fitImpossible: boolean
  /** Tareas pendientes que (ya reprogramadas) terminan después del fin comprometido. */
  endAfterProject: string[]
  /** Tareas pendientes que (ya reprogramadas) empiezan antes del inicio del proyecto. */
  startBeforeProject: string[]
}

/**
 * Qué pasa con las tareas al cambiar las fechas del proyecto.
 *
 * - Cambiar el inicio desplaza las tareas pendientes los mismos días hábiles,
 *   así conservan duración, orden y dependencias (si `shiftTasks`).
 * - Si alguna termina después del fin comprometido y se pide `fitToEnd`, las
 *   pendientes se comprimen proporcionalmente entre hoy y el fin (ver fitToEnd).
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
  fitToEnd?: boolean
  today?: string
  workingDays: WorkingDays
}): ReschedulePlan {
  const { pendingTasks, previousStart, start, end, shiftTasks, workingDays } = input
  const shiftDays = shiftTasks && previousStart && start ? workingDaysBetween(previousStart, start, workingDays) : 0

  let after: TaskDates[] = pendingTasks.map((task) => {
    const shifted: TaskDates = {
      id: task.id,
      start_date: task.start_date && shiftWorkingDays(task.start_date, shiftDays, workingDays, 'start'),
      end_date: task.end_date && shiftWorkingDays(task.end_date, shiftDays, workingDays, 'end'),
    }
    // Una tarea de un día que empieza y termina en no laborable no puede quedar invertida.
    if (shifted.start_date && shifted.end_date && shifted.start_date > shifted.end_date) shifted.end_date = shifted.start_date
    return shifted
  })

  const overflowing = end ? after.filter((task) => task.end_date && task.end_date > end).map((task) => task.id) : []
  let fitted = false
  let fitImpossible = false
  if (input.fitToEnd && end && overflowing.length > 0) {
    const result = fitToEnd(after, end, input.today ?? end, workingDays)
    if (result) {
      after = result
      fitted = true
    } else {
      fitImpossible = true
    }
  }

  const moved: ReschedulePlan['moved'] = []
  const endAfterProject: string[] = []
  const startBeforeProject: string[] = []
  pendingTasks.forEach((task, index) => {
    const next = after[index]
    if (next.start_date !== task.start_date || next.end_date !== task.end_date) {
      moved.push({ before: { id: task.id, start_date: task.start_date, end_date: task.end_date }, after: next })
    }
    if (end && next.end_date && next.end_date > end) endAfterProject.push(task.id)
    if (start && next.start_date && next.start_date < start) startBeforeProject.push(task.id)
  })
  return { shiftDays, moved, overflowing, fitted, fitImpossible, endAfterProject, startBeforeProject }
}

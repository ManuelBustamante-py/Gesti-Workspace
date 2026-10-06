import { addDays, workingDayOrdinal, type WorkingDays } from './dates'

export type SchedulableTask = {
  id: string
  start_date: string | null
  end_date: string | null
  predecessor_ids?: string[] | null
}

export type TaskScheduleInfo = {
  /** Días laborables entre inicio y fin (incluidos), mínimo 1. */
  duration: number
  /** Holgura total en días laborables respecto del fin del proyecto. */
  totalFloat: number
  critical: boolean
  /** La tarea empieza antes de que termine alguna predecesora (fin a inicio). */
  startsBeforePredecessor: boolean
}

export type ProjectSchedule = {
  tasks: Map<string, TaskScheduleInfo>
  /** Tareas con fechas que forman parte de un ciclo; no se calcula ruta crítica para ellas. */
  cyclicTaskIds: Set<string>
}

/**
 * Método de la ruta crítica sobre días laborables.
 *
 * - Las fechas guardadas de inicio actúan como "empieza no antes de".
 * - Las dependencias son fin a inicio sin desfase.
 * - Las tareas sin fechas no participan; sus dependencias se ignoran.
 * - Crítica = holgura total 0.
 */
export function computeSchedule(
  tasks: SchedulableTask[],
  workingDays: WorkingDays,
): ProjectSchedule {
  const scheduled = tasks.filter(
    (task): task is SchedulableTask & { start_date: string; end_date: string } =>
      Boolean(task.start_date && task.end_date),
  )
  const byId = new Map(scheduled.map((task) => [task.id, task]))
  const predecessorsOf = new Map(
    scheduled.map((task) => [
      task.id,
      [...new Set(task.predecessor_ids ?? [])].filter(
        (id) => id !== task.id && byId.has(id),
      ),
    ]),
  )
  const successorsOf = new Map(scheduled.map((task) => [task.id, [] as string[]]))
  predecessorsOf.forEach((predecessors, taskId) => {
    predecessors.forEach((predecessorId) => successorsOf.get(predecessorId)?.push(taskId))
  })

  // Ordinales de día laborable: inicio = primer día laborable >= start_date,
  // fin = último día laborable <= end_date.
  const startOrdinal = new Map<string, number>()
  const duration = new Map<string, number>()
  scheduled.forEach((task) => {
    const start = workingDayOrdinal(task.start_date, workingDays)
    const finishExclusive = workingDayOrdinal(addDays(task.end_date, 1), workingDays)
    startOrdinal.set(task.id, start)
    duration.set(task.id, Math.max(1, finishExclusive - start))
  })

  // Orden topológico (Kahn). Lo que no se puede ordenar está en un ciclo.
  const pending = new Map(scheduled.map((task) => [task.id, predecessorsOf.get(task.id)!.length]))
  const queue = scheduled.filter((task) => pending.get(task.id) === 0).map((task) => task.id)
  const order: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(id)
    for (const successorId of successorsOf.get(id)!) {
      const remaining = pending.get(successorId)! - 1
      pending.set(successorId, remaining)
      if (remaining === 0) queue.push(successorId)
    }
  }
  const ordered = new Set(order)
  const cyclicTaskIds = new Set(scheduled.filter((task) => !ordered.has(task.id)).map((task) => task.id))

  // Pasada hacia delante.
  const earlyStart = new Map<string, number>()
  const earlyFinish = new Map<string, number>()
  const startsBeforePredecessor = new Map<string, boolean>()
  for (const id of order) {
    const predecessorFinish = Math.max(
      -Infinity,
      ...predecessorsOf.get(id)!.map((predecessorId) => earlyFinish.get(predecessorId)! + 1),
    )
    const ownStart = startOrdinal.get(id)!
    // El aviso compara con las fechas guardadas de la predecesora, no con las
    // empujadas por el cálculo: así no se propaga a toda la cadena.
    startsBeforePredecessor.set(
      id,
      predecessorsOf.get(id)!.some(
        (predecessorId) => ownStart <= startOrdinal.get(predecessorId)! + duration.get(predecessorId)! - 1,
      ),
    )
    const start = Math.max(ownStart, predecessorFinish)
    earlyStart.set(id, start)
    earlyFinish.set(id, start + duration.get(id)! - 1)
  }

  const projectFinish = Math.max(-Infinity, ...earlyFinish.values())

  // Pasada hacia atrás.
  const lateStart = new Map<string, number>()
  for (const id of [...order].reverse()) {
    const successors = successorsOf.get(id)!.filter((successorId) => lateStart.has(successorId))
    const lateFinish = successors.length
      ? Math.min(...successors.map((successorId) => lateStart.get(successorId)! - 1))
      : projectFinish
    lateStart.set(id, lateFinish - duration.get(id)! + 1)
  }

  const result = new Map<string, TaskScheduleInfo>()
  scheduled.forEach((task) => {
    const cyclic = cyclicTaskIds.has(task.id)
    const totalFloat = cyclic ? NaN : lateStart.get(task.id)! - earlyStart.get(task.id)!
    result.set(task.id, {
      duration: duration.get(task.id)!,
      totalFloat,
      critical: !cyclic && totalFloat <= 0,
      startsBeforePredecessor: startsBeforePredecessor.get(task.id) ?? false,
    })
  })

  return { tasks: result, cyclicTaskIds }
}

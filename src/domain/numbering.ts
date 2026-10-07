type NumberedColumn = { id: string }
type NumberedTask = { id: string; number?: number | null }

/**
 * Número de actividad de cada tarea.
 *
 * Desde la migración 20261007090000 cada tarea guarda su número, así que mover
 * o arrastrar tarjetas no renumera el tablero. Las tareas sin número guardado
 * (base de datos sin migrar) reciben uno a continuación del mayor existente,
 * en orden de columna y posición, como antes.
 */
export function activityNumbers(
  columns: NumberedColumn[],
  tasksByColumn: Record<string, NumberedTask[]>,
) {
  const ordered = columns.flatMap((column) => tasksByColumn[column.id] ?? [])
  const numbers = new Map<string, number>()
  let highest = 0

  for (const task of ordered) {
    if (task.number && task.number > 0) {
      numbers.set(task.id, task.number)
      highest = Math.max(highest, task.number)
    }
  }
  for (const task of ordered) {
    if (!numbers.has(task.id)) {
      highest += 1
      numbers.set(task.id, highest)
    }
  }
  return numbers
}

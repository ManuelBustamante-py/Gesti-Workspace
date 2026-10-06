type NumberedColumn = { id: string }
type NumberedTask = { id: string }

/**
 * Número de actividad único para toda la aplicación: orden de columnas y,
 * dentro de cada columna, orden de tareas. Es el mismo orden que usan la
 * exportación y la importación, por lo que un archivo exportado conserva los
 * números que se ven en el tablero.
 */
export function activityNumbers(
  columns: NumberedColumn[],
  tasksByColumn: Record<string, NumberedTask[]>,
) {
  const numbers = new Map<string, number>()
  for (const column of columns) {
    for (const task of tasksByColumn[column.id] ?? []) {
      numbers.set(task.id, numbers.size + 1)
    }
  }
  return numbers
}

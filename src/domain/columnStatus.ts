export type ColumnStatus = 'todo' | 'in_progress' | 'done'

export const COLUMN_STATUSES: ColumnStatus[] = ['todo', 'in_progress', 'done']

export const columnStatusLabels: Record<ColumnStatus, string> = {
  todo: 'Pendiente',
  in_progress: 'En progreso',
  done: 'Completado',
}

/** Avance estimado de una tarea según el estado de su columna. */
export const columnStatusProgress: Record<ColumnStatus, number> = {
  todo: 0,
  in_progress: 50,
  done: 100,
}

/** Solo para columnas antiguas sin estado guardado; misma regla que la migración. */
export function inferColumnStatus(name: string): ColumnStatus {
  const normalized = name.toLowerCase()
  if (/(complet|termin|hech|final|done|cerrad)/.test(normalized)) return 'done'
  if (/(progreso|proceso|curso|doing|revisi|review|haciendo|wip|desarrollo|trabajando)/.test(normalized)) return 'in_progress'
  return 'todo'
}

export function resolveColumnStatus(column: { name: string; status?: string | null }): ColumnStatus {
  return COLUMN_STATUSES.includes(column.status as ColumnStatus)
    ? (column.status as ColumnStatus)
    : inferColumnStatus(column.name)
}

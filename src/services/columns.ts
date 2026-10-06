import { supabase } from '../lib/supabase'
import type { ColumnStatus } from '../domain/columnStatus'
import type { Task } from './tasks'
import { NO_PERMISSION_MESSAGE } from './tasks'

export interface BoardColumn {
  id: string
  board_id: string
  name: string
  position: number
  /** Puede faltar si la migración 20261006120000 aún no se aplicó. */
  status?: ColumnStatus | null
  created_at: string
  updated_at: string
}

export const DEFAULT_COLUMNS: Array<{ name: string; status: ColumnStatus }> = [
  { name: 'Por hacer', status: 'todo' },
  { name: 'En progreso', status: 'in_progress' },
  { name: 'Completado', status: 'done' },
]

export async function getBoardColumns(boardId: string) {
  const { data, error } = await supabase
    .from('board_columns')
    .select('*')
    .eq('board_id', boardId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  return data as BoardColumn[]
}

/** Columnas y tareas de un tablero en una sola consulta. */
export async function getBoardSnapshot(boardId: string) {
  const { data, error } = await supabase
    .from('board_columns')
    .select('*, tasks(*)')
    .eq('board_id', boardId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .order('position', { referencedTable: 'tasks', ascending: true })
    .order('created_at', { referencedTable: 'tasks', ascending: true })

  if (error) {
    throw error
  }

  const rows = data as Array<BoardColumn & { tasks: Task[] | null }>
  return {
    columns: rows.map((row) => {
      const column: BoardColumn & { tasks?: Task[] | null } = { ...row }
      delete column.tasks
      return column as BoardColumn
    }),
    tasksByColumn: Object.fromEntries(rows.map((row) => [row.id, row.tasks ?? []])) as Record<string, Task[]>,
  }
}

function withoutStatusWhenUnsupported<T extends { status?: ColumnStatus }>(row: T, supported: boolean) {
  if (supported) return row
  const copy = { ...row }
  delete copy.status
  return copy
}

let statusColumnSupported = true

async function insertColumns(rows: Array<{ board_id: string; name: string; position: number; status?: ColumnStatus }>) {
  const attempt = () =>
    supabase
      .from('board_columns')
      .insert(rows.map((row) => withoutStatusWhenUnsupported(row, statusColumnSupported)))
      .select()

  let { data, error } = await attempt()
  // Compatibilidad: base de datos sin la columna "status" todavía.
  if (error && statusColumnSupported && /status/.test(error.message)) {
    statusColumnSupported = false
    ;({ data, error } = await attempt())
  }

  if (error) {
    throw error
  }

  return (data as BoardColumn[]).sort((left, right) => left.position - right.position)
}

export async function createDefaultColumns(boardId: string) {
  return insertColumns(
    DEFAULT_COLUMNS.map((column, index) => ({ board_id: boardId, name: column.name, status: column.status, position: index })),
  )
}

export async function createBoardColumn(
  boardId: string,
  name: string,
  status: ColumnStatus = 'todo',
) {
  const trimmedName = name.trim()

  if (!trimmedName) {
    throw new Error('La columna debe tener un nombre.')
  }

  const { data: lastColumns, error: columnsError } = await supabase
    .from('board_columns')
    .select('position')
    .eq('board_id', boardId)
    .order('position', { ascending: false })
    .limit(1)

  if (columnsError) {
    throw columnsError
  }

  const position = lastColumns && lastColumns.length > 0 ? Number(lastColumns[0].position ?? 0) + 1 : 0
  const [column] = await insertColumns([{ board_id: boardId, name: trimmedName, position, status }])
  return column
}

export async function updateBoardColumn(
  id: string,
  name: string,
  status?: ColumnStatus,
) {
  const trimmedName = name.trim()

  if (!trimmedName) {
    throw new Error('La columna debe tener un nombre.')
  }

  const { data, error } = await supabase
    .from('board_columns')
    .update({
      name: trimmedName,
      ...(status && statusColumnSupported ? { status } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()

  if (error) {
    throw error
  }
  if (!data || data.length === 0) {
    throw new Error(NO_PERMISSION_MESSAGE)
  }

  return data[0] as BoardColumn
}

export async function deleteBoardColumn(id: string) {
  const { data, error } = await supabase
    .from('board_columns')
    .delete()
    .eq('id', id)
    .select('id')

  if (error) {
    throw error
  }
  if (!data || data.length === 0) {
    throw new Error(NO_PERMISSION_MESSAGE)
  }
}

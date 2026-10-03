import { supabase } from '../lib/supabase'

export interface BoardColumn {
  id: string
  board_id: string
  name: string
  position: number
  created_at: string
  updated_at: string
}

const defaultColumnNames = ['Por hacer', 'En progreso', 'Completado']

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

export async function ensureBoardColumns(boardId: string) {
  const columns = await getBoardColumns(boardId)

  if (columns.length > 0) {
    return columns
  }

  const { data, error } = await supabase
    .from('board_columns')
    .insert(
      defaultColumnNames.map((name, index) => ({
        board_id: boardId,
        name,
        position: index,
      })),
    )
    .select()
    .order('position', { ascending: true })

  if (error) {
    throw error
  }

  return data as BoardColumn[]
}

export async function createBoardColumn(
  boardId: string,
  name: string,
) {
  const trimmedName = name.trim()

  if (!trimmedName) {
    throw new Error('La columna debe tener un nombre.')
  }

  const { data: existingColumns, error: columnsError } =
    await supabase
      .from('board_columns')
      .select('position')
      .eq('board_id', boardId)
      .order('position', { ascending: true })

  if (columnsError) {
    throw columnsError
  }

  const position =
    existingColumns && existingColumns.length > 0
      ? Number(existingColumns[existingColumns.length - 1]?.position ?? 0) + 1
      : 0

  const { data, error } = await supabase
    .from('board_columns')
    .insert({
      board_id: boardId,
      name: trimmedName,
      position,
    })
    .select()
    .single()

  if (error) {
    throw error
  }

  return data as BoardColumn
}

export async function updateBoardColumn(
  id: string,
  name: string,
) {
  const trimmedName = name.trim()

  if (!trimmedName) {
    throw new Error('La columna debe tener un nombre.')
  }

  const { data, error } = await supabase
    .from('board_columns')
    .update({
      name: trimmedName,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw error
  }

  return data as BoardColumn
}

export async function deleteBoardColumn(id: string) {
  const { error } = await supabase
    .from('board_columns')
    .delete()
    .eq('id', id)

  if (error) {
    throw error
  }
}

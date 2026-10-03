import { supabase } from '../lib/supabase'

export interface Board {
  id: string
  name: string
  description: string | null
  color: string
  owner_id: string
  created_at: string
  updated_at: string
}

export async function getBoards() {
  const { data, error } = await supabase
    .from('boards')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  return data as Board[]
}

export async function createBoard(
  name: string,
  description: string,
  color: string,
  ownerId: string,
) {
  const { data, error } = await supabase
    .from('boards')
    .insert({
      name,
      description: description || null,
      color,
      owner_id: ownerId,
    })
    .select()
    .single()

  if (error) {
    throw error
  }

  return data as Board
}

export async function updateBoard(
  id: string,
  name: string,
  description: string,
  color: string,
) {
  const { data, error } = await supabase
    .from('boards')
    .update({
      name,
      description: description || null,
      color,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw error
  }

  return data as Board
}

export async function deleteBoard(id: string) {
  const { error } = await supabase
    .from('boards')
    .delete()
    .eq('id', id)

  if (error) {
    throw error
  }
}
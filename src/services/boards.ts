import { supabase } from '../lib/supabase'

export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5, 6, 7]
export const DEFAULT_WORK_START_TIME = '08:00'
export const DEFAULT_WORK_END_TIME = '17:00'

export interface BoardSchedule {
  working_days: number[]
  work_start_time: string
  work_end_time: string
}

export interface Board {
  id: string
  name: string
  description: string | null
  color: string
  owner_id: string
  created_at: string
  updated_at: string
  working_days: number[] | null
  work_start_time: string | null
  work_end_time: string | null
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

export async function updateBoardSchedule(
  id: string,
  schedule: BoardSchedule,
) {
  const workingDays = [...new Set(schedule.working_days)].filter(
    (day) => Number.isInteger(day) && day >= 1 && day <= 7,
  )

  if (workingDays.length === 0) {
    throw new Error('Selecciona al menos un día laborable.')
  }

  if (schedule.work_start_time >= schedule.work_end_time) {
    throw new Error('La hora de inicio debe ser anterior a la hora de término.')
  }

  const { data, error } = await supabase
    .from('boards')
    .update({
      working_days: workingDays,
      work_start_time: schedule.work_start_time,
      work_end_time: schedule.work_end_time,
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
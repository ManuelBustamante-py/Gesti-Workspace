import { supabase } from '../lib/supabase'
import { createDefaultColumns } from './columns'
import { NO_PERMISSION_MESSAGE } from './tasks'

import type { BoardSchedule } from '../domain/workSchedule'

export {
  boardSchedule,
  boardWorkingDays,
  DEFAULT_WORK_END_TIME,
  DEFAULT_WORK_START_TIME,
  DEFAULT_WORKING_DAYS,
  type BoardSchedule,
} from '../domain/workSchedule'

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

function firstRowOrThrow(data: unknown[] | null) {
  if (!data || data.length === 0) {
    throw new Error(NO_PERMISSION_MESSAGE)
  }
  return data[0] as Board
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

export async function getBoard(id: string) {
  const { data, error } = await supabase
    .from('boards')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data as Board | null
}

export async function createBoard(
  name: string,
  description: string,
  color: string,
  ownerId: string,
  options: { withDefaultColumns?: boolean } = {},
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

  const board = data as Board
  if (options.withDefaultColumns ?? true) {
    await createDefaultColumns(board.id)
  }
  return board
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

  if (error) {
    throw error
  }

  return firstRowOrThrow(data)
}

export async function updateBoardSchedule(
  id: string,
  schedule: BoardSchedule,
) {
  const workingDays = [...new Set(schedule.working_days)]
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    .sort((left, right) => left - right)

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

  if (error) {
    throw error
  }

  return firstRowOrThrow(data)
}

export async function deleteBoard(id: string) {
  const { data, error } = await supabase
    .from('boards')
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

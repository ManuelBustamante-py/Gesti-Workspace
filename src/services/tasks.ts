import { supabase } from '../lib/supabase'

export type TaskPriority = 'low' | 'medium' | 'high'

export interface Task {
  id: string
  column_id: string
  title: string
  description: string | null
  priority: TaskPriority
  start_date: string | null
  end_date: string | null
  predecessor_ids: string[]
  position: number
  created_at: string
  updated_at: string
}

export async function getColumnTasks(columnId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('column_id', columnId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  return data as Task[]
}

export async function createTask(
  columnId: string,
  title: string,
  description?: string,
  priority: TaskPriority = 'medium',
  startDate?: string | null,
  endDate?: string | null,
  predecessorIds: string[] = [],
) {
  const trimmedTitle = title.trim()

  if (!trimmedTitle) {
    throw new Error('La tarea debe tener un título.')
  }
  if (startDate && endDate && startDate > endDate) {
    throw new Error('La fecha de inicio no puede ser posterior a la fecha de fin.')
  }

  const { data: existingTasks, error: tasksError } = await supabase
    .from('tasks')
    .select('position')
    .eq('column_id', columnId)
    .order('position', { ascending: true })

  if (tasksError) {
    throw tasksError
  }

  const position =
    existingTasks && existingTasks.length > 0
      ? Number(existingTasks[existingTasks.length - 1]?.position ?? 0) + 1
      : 0

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      column_id: columnId,
      title: trimmedTitle,
      description: description?.trim() || null,
      priority,
      start_date: startDate || null,
      end_date: endDate || null,
      predecessor_ids: predecessorIds,
      position,
    })
    .select()
    .single()

  if (error) {
    throw error
  }

  return data as Task
}

export async function updateTask(
  id: string,
  title: string,
  description?: string,
  priority: TaskPriority = 'medium',
  startDate?: string | null,
  endDate?: string | null,
  predecessorIds: string[] = [],
) {
  const trimmedTitle = title.trim()

  if (!trimmedTitle) {
    throw new Error('La tarea debe tener un título.')
  }
  if (startDate && endDate && startDate > endDate) {
    throw new Error('La fecha de inicio no puede ser posterior a la fecha de fin.')
  }

  const { data, error } = await supabase
    .from('tasks')
    .update({
      title: trimmedTitle,
      description: description?.trim() || null,
      priority,
      start_date: startDate || null,
      end_date: endDate || null,
      predecessor_ids: predecessorIds,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw error
  }

  return data as Task
}

export async function moveTask(
  taskId: string,
  targetColumnId: string,
  position: number,
) {
  const { data, error } = await supabase
    .from('tasks')
    .update({
      column_id: targetColumnId,
      position,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .select()
    .single()

  if (error) {
    throw error
  }

  return data as Task
}

export async function deleteTask(id: string) {
  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', id)

  if (error) {
    throw error
  }
}

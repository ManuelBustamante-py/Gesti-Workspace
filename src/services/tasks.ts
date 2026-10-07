import { supabase } from '../lib/supabase'
import { isValidDateKey } from '../domain/dates'

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
  /** Número de actividad fijo (migración 20261007090000); null en bases sin migrar. */
  number?: number | null
  /** Fecha real de finalización confirmada (solo en columnas «Completado»). */
  completed_at?: string | null
  /** «En esta columna desde»: fecha real en que entró a su columna actual. */
  column_entered_at?: string | null
  position: number
  created_at: string
  updated_at: string
}

export type TaskInput = {
  title: string
  description?: string | null
  priority?: TaskPriority
  startDate?: string | null
  endDate?: string | null
  predecessorIds?: string[]
  /** Solo al crear: número de actividad explícito (importación). */
  number?: number
}

export const NO_PERMISSION_MESSAGE =
  'No tienes permiso para modificar este elemento o ya no existe.'

function validateTaskInput({ title, startDate, endDate }: TaskInput) {
  const trimmedTitle = title.trim()
  if (!trimmedTitle) {
    throw new Error('La tarea debe tener un título.')
  }
  for (const value of [startDate, endDate]) {
    if (value && !isValidDateKey(value)) {
      throw new Error(`La fecha ${value} no es válida.`)
    }
  }
  if (startDate && endDate && startDate > endDate) {
    throw new Error('La fecha de inicio no puede ser posterior a la fecha de fin.')
  }
  return trimmedTitle
}

function taskRow(input: TaskInput) {
  return {
    title: validateTaskInput(input),
    description: input.description?.trim() || null,
    priority: input.priority ?? 'medium',
    start_date: input.startDate || null,
    end_date: input.endDate || null,
    predecessor_ids: input.predecessorIds ?? [],
  }
}

async function nextTaskPosition(columnId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select('position')
    .eq('column_id', columnId)
    .order('position', { ascending: false })
    .limit(1)

  if (error) {
    throw error
  }

  return data && data.length > 0 ? Number(data[0].position ?? 0) + 1 : 0
}

export async function createTask(columnId: string, input: TaskInput) {
  const row = taskRow(input)
  const position = await nextTaskPosition(columnId)

  const { data, error } = await supabase
    .from('tasks')
    .insert({ ...row, column_id: columnId, position })
    .select()
    .single()

  if (error) {
    throw error
  }

  return data as Task
}

/** Inserta varias tareas de una columna en una sola llamada, conservando el orden. */
export async function createTasks(columnId: string, inputs: TaskInput[]) {
  if (inputs.length === 0) return []
  const rows = inputs.map(taskRow)
  const firstPosition = await nextTaskPosition(columnId)

  const insert = (withNumbers: boolean) =>
    supabase
      .from('tasks')
      .insert(
        rows.map((row, index) => ({
          ...row,
          column_id: columnId,
          position: firstPosition + index,
          ...(withNumbers && inputs[index].number ? { number: inputs[index].number } : {}),
        })),
      )
      .select()

  const withNumbers = inputs.some((input) => input.number)
  let { data, error } = await insert(withNumbers)
  // Compatibilidad: base de datos sin la columna «number» todavía.
  if (error && withNumbers && /number/.test(error.message)) {
    ;({ data, error } = await insert(false))
  }

  if (error) {
    throw error
  }

  return (data as Task[]).sort((left, right) => left.position - right.position)
}

export async function updateTask(id: string, input: TaskInput) {
  const row = taskRow(input)

  const { data, error } = await supabase
    .from('tasks')
    .update({ ...row, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()

  if (error) {
    throw error
  }
  if (!data || data.length === 0) {
    throw new Error(NO_PERMISSION_MESSAGE)
  }

  return data[0] as Task
}

export async function updateTaskPredecessors(id: string, predecessorIds: string[]) {
  const { data, error } = await supabase
    .from('tasks')
    .update({ predecessor_ids: predecessorIds, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()

  if (error) {
    throw error
  }
  if (!data || data.length === 0) {
    throw new Error(NO_PERMISSION_MESSAGE)
  }

  return data[0] as Task
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

  if (error) {
    throw error
  }
  if (!data || data.length === 0) {
    throw new Error(NO_PERMISSION_MESSAGE)
  }

  return data[0] as Task
}

/**
 * Deja las tareas de una columna en el orden indicado (arrastrar y soltar). Las
 * tareas que venían de otra columna pasan a esta.
 */
export async function reorderColumnTasks(columnId: string, orderedTaskIds: string[]) {
  const { error } = await supabase.rpc('reorder_column_tasks', {
    target_column_id: columnId,
    ordered_task_ids: orderedTaskIds,
  })

  if (!error) return

  // Sin la migración 20261007090000: se actualiza tarea por tarea.
  if (error.code === 'PGRST202') {
    for (const [index, taskId] of orderedTaskIds.entries()) {
      await moveTask(taskId, columnId, index)
    }
    return
  }

  throw error
}

/**
 * Fechas reales de seguimiento del flujo:
 * - `completed_at`: «Completada el» (solo en columnas «Completado»).
 * - `column_entered_at`: «En esta columna desde» (el resto de columnas).
 * El servidor las borra cuando la tarea cambia de columna.
 */
export type TaskStatusDateField = 'completed_at' | 'column_entered_at'

const STATUS_DATE_MIGRATIONS: Record<TaskStatusDateField, string> = {
  completed_at: '20261007150000_task_completion_dates.sql',
  column_entered_at: '20261007180000_task_column_entered_at.sql',
}

export async function setTaskStatusDate(id: string, field: TaskStatusDateField, value: string | null) {
  if (value && !isValidDateKey(value)) {
    throw new Error(`La fecha ${value} no es válida.`)
  }

  const { data, error } = await supabase
    .from('tasks')
    .update({ [field]: value, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()

  if (error) {
    if (error.message.includes(field)) {
      throw new Error(`Para registrar esta fecha aplica la migración ${STATUS_DATE_MIGRATIONS[field]} en Supabase.`)
    }
    throw error
  }
  if (!data || data.length === 0) {
    throw new Error(NO_PERMISSION_MESSAGE)
  }

  return data[0] as Task
}

/** Confirma la finalización de una tarea con la fecha en que se terminó, o la quita (null). */
export function setTaskCompletion(id: string, completedOn: string | null) {
  return setTaskStatusDate(id, 'completed_at', completedOn)
}

export async function deleteTask(id: string) {
  const { data, error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', id)
    .select('id')

  if (error) {
    throw error
  }
  // RLS no devuelve error cuando filtra la fila: sin filas borradas no hubo borrado.
  if (!data || data.length === 0) {
    throw new Error(NO_PERMISSION_MESSAGE)
  }
}

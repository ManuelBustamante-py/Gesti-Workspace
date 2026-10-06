import { supabase } from '../lib/supabase'

/** Responsables por tarea: taskId → userIds (en orden de asignación). */
export type TaskAssignments = Record<string, string[]>

// PGRST202: la función RPC no existe (migración 20261006180000 sin aplicar).
const MISSING_FUNCTION = 'PGRST202'

export async function getBoardTaskAssignees(boardId: string) {
  const { data, error } = await supabase.rpc('get_board_task_assignees', {
    target_board_id: boardId,
  })

  if (error) {
    if (error.code === MISSING_FUNCTION) {
      return { assignments: {} as TaskAssignments, supported: false }
    }
    throw error
  }

  const assignments: TaskAssignments = {}
  for (const row of (data ?? []) as Array<{ task_id: string; user_id: string }>) {
    ;(assignments[row.task_id] ??= []).push(row.user_id)
  }
  return { assignments, supported: true }
}

/** Reemplaza los responsables de una tarea. Solo el propietario del tablero puede hacerlo. */
export async function setTaskAssignees(taskId: string, userIds: string[]) {
  const { error } = await supabase.rpc('set_task_assignees', {
    target_task_id: taskId,
    assignee_ids: [...new Set(userIds)],
  })

  if (error) {
    throw error
  }
}

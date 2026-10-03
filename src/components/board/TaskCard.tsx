import type { ChangeEvent } from 'react'

import type { Task, TaskPriority } from '../../services/tasks'

export interface EditingTaskState {
  id: string
  columnId: string
  title: string
  description: string
  priority: TaskPriority
  dueDate: string
}

interface TaskCardProps {
  task: Task
  columns: { id: string; name: string }[]
  editingTask: EditingTaskState | null
  savingTask: boolean
  movingTask: boolean
  onStartEdit: (task: Task) => void
  onEditChange: (changes: Partial<EditingTaskState>) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onMove: (task: Task, columnId: string) => void
  onDelete: (task: Task) => void
}

const priorityLabels: Record<TaskPriority, string> = {
  low: 'baja',
  medium: 'media',
  high: 'alta',
}

function TaskCard({
  task,
  columns,
  editingTask,
  savingTask,
  movingTask,
  onStartEdit,
  onEditChange,
  onSaveEdit,
  onCancelEdit,
  onMove,
  onDelete,
}: TaskCardProps) {
  const isEditing = editingTask?.id === task.id

  if (isEditing && editingTask) {
    return (
      <div className="task-card space-y-2">
        <input
          type="text"
          value={editingTask.title}
          onChange={(event) => onEditChange({ title: event.target.value })}
          className="control-input w-full rounded-lg px-2 py-2 text-sm outline-none"
        />
        <textarea
          value={editingTask.description}
          onChange={(event) => onEditChange({ description: event.target.value })}
          rows={3}
          className="control-input w-full resize-none rounded-lg px-2 py-2 text-sm outline-none"
        />
        <div className="flex gap-2">
          <select
            value={editingTask.priority}
            onChange={(event) =>
              onEditChange({ priority: event.target.value as TaskPriority })
            }
            className="control-input rounded-lg px-2 py-2 text-sm"
          >
            <option value="low">Baja</option>
            <option value="medium">Media</option>
            <option value="high">Alta</option>
          </select>
          <input
            type="date"
            value={editingTask.dueDate}
            onChange={(event) => onEditChange({ dueDate: event.target.value })}
            className="control-input min-w-0 flex-1 rounded-lg px-2 py-2 text-sm"
          />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onSaveEdit} disabled={savingTask} className="btn-mint-primary px-3 py-2 text-xs">
            {savingTask ? 'Guardando...' : 'Guardar'}
          </button>
          <button type="button" onClick={onCancelEdit} className="btn-ghost px-3 py-2 text-xs">
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="task-card">
      <p className="text-sm font-medium text-[var(--text-main)]">{task.title}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className={`priority-${task.priority} rounded-full px-2 py-1`}>
          Prioridad {priorityLabels[task.priority]}
        </span>
        {task.due_date && (
          <span className="rounded-full border border-white/5 bg-black/20 px-2 py-1 text-[var(--text-muted)]">
            Vence: {task.due_date}
          </span>
        )}
      </div>
      {task.description && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">{task.description}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <select
          value={task.column_id}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            onMove(task, event.target.value)
          }
          disabled={movingTask}
          className="control-input max-w-32 rounded-lg px-2 py-1 text-xs"
        >
          <option value={task.column_id}>Mover a...</option>
          {columns
            .filter((column) => column.id !== task.column_id)
            .map((column) => (
              <option key={column.id} value={column.id}>
                {column.name}
              </option>
            ))}
        </select>
        <button type="button" onClick={() => onStartEdit(task)} className="btn-ghost px-2 py-1 text-xs">
          Editar
        </button>
        <button type="button" onClick={() => onDelete(task)} className="btn-danger px-2 py-1 text-xs">
          Eliminar
        </button>
      </div>
    </div>
  )
}

export default TaskCard

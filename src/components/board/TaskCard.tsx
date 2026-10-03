import type { ChangeEvent } from 'react'

import type { Task, TaskPriority } from '../../services/tasks'

export interface EditingTaskState {
  id: string
  columnId: string
  title: string
  description: string
  priority: TaskPriority
  startDate: string
  endDate: string
  predecessorIds: string[]
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
  availableTasks: Task[]
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
  availableTasks,
}: TaskCardProps) {
  const isEditing = editingTask?.id === task.id
  const numberedTasks = [...availableTasks].sort((left, right) => {
    const createdDifference = left.created_at.localeCompare(right.created_at)
    return createdDifference || left.id.localeCompare(right.id)
  })
  const activityNumber = numberedTasks.findIndex((candidate) => candidate.id === task.id) + 1
  const predecessorTasks = (task.predecessor_ids ?? [])
    .map((predecessorId) => numberedTasks.find((candidate) => candidate.id === predecessorId))
    .filter((candidate): candidate is Task => Boolean(candidate))

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
            value={editingTask.startDate}
            onChange={(event) => onEditChange({ startDate: event.target.value })}
            className="control-input min-w-0 flex-1 rounded-lg px-2 py-2 text-sm"
            aria-label="Fecha de inicio"
          />
          <input
            type="date"
            value={editingTask.endDate}
            onChange={(event) => onEditChange({ endDate: event.target.value })}
            className="control-input min-w-0 flex-1 rounded-lg px-2 py-2 text-sm"
            aria-label="Fecha de fin"
          />
        </div>
        <label className="block text-xs text-[var(--text-muted)]">
          Predecesoras (fin a inicio)
          <select
            multiple
            value={editingTask.predecessorIds}
            onChange={(event) =>
              onEditChange({
                predecessorIds: Array.from(
                  event.target.selectedOptions,
                  (option) => option.value,
                ),
              })
            }
            className="control-input mt-1 min-h-20 w-full rounded-lg px-2 py-2 text-sm"
          >
            {availableTasks
              .filter((candidate) => candidate.id !== task.id)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  #{numberedTasks.findIndex((item) => item.id === candidate.id) + 1} · {candidate.title}
                </option>
              ))}
          </select>
        </label>
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
      <p className="text-sm font-medium text-[var(--text-main)]">
        <span className="mr-2 text-xs text-[var(--text-muted)]">#{activityNumber}</span>
        {task.title}
      </p>
      {predecessorTasks.length > 0 && (
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Predecesora{predecessorTasks.length === 1 ? '' : 's'}:{' '}
          {predecessorTasks
            .map((predecessor) => `#${numberedTasks.findIndex((item) => item.id === predecessor.id) + 1}`)
            .join(', ')}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className={`priority-${task.priority} rounded-full px-2 py-1`}>
          Prioridad {priorityLabels[task.priority]}
        </span>
        {(task.start_date || task.end_date) && (
          <span className="rounded-full border border-white/5 bg-black/20 px-2 py-1 text-[var(--text-muted)]">
            {task.start_date ?? 'Sin inicio'} → {task.end_date ?? 'Sin fin'}
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

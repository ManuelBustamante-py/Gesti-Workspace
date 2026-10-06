import { memo } from 'react'

import { formatDateKey } from '../../domain/dates'
import { descriptionField, descriptionSummary } from '../../domain/description'
import type { TaskScheduleInfo } from '../../domain/schedule'
import type { Task } from '../../services/tasks'
import { priorityLabels } from '../../domain/priority'

export type TaskRelation = 'selected' | 'related' | 'dimmed' | null

interface TaskCardProps {
  task: Task
  number: number | undefined
  predecessorNumbers: number[]
  columns: { id: string; name: string }[]
  scheduleInfo?: TaskScheduleInfo
  canEdit: boolean
  moving: boolean
  relation: TaskRelation
  onOpen: (task: Task, mode: 'view' | 'edit') => void
  onMove: (task: Task, columnId: string) => void
  onDelete: (task: Task) => void
  onToggleRelation: (taskId: string) => void
}

const shortDate = (value: string) => formatDateKey(value, { day: 'numeric', month: 'short' })

function TaskCard({
  task,
  number,
  predecessorNumbers,
  columns,
  scheduleInfo,
  canEdit,
  moving,
  relation,
  onOpen,
  onMove,
  onDelete,
  onToggleRelation,
}: TaskCardProps) {
  const summary = task.description ? descriptionSummary(task.description) : ''
  const sprint = task.description ? descriptionField(task.description, 'Sprint') : null
  const estimate = task.description ? descriptionField(task.description, 'Estimación') : null

  return (
    <article
      className={`task-card task-card-${task.priority} transition ${relation === 'dimmed' ? 'opacity-40' : ''} ${
        relation === 'selected' ? 'ring-2 ring-[var(--accent-mint)]' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => onToggleRelation(task.id)}
          className={`task-number ${relation === 'selected' ? 'task-number-selected' : relation === 'related' ? 'task-number-related' : ''}`}
          aria-pressed={relation === 'selected'}
          aria-label={`Resaltar predecesoras y sucesoras de la tarea ${number ?? ''}`}
          title="Resaltar predecesoras y sucesoras"
        >
          {number ?? '·'}
        </button>
        <button
          type="button"
          onClick={() => onOpen(task, 'view')}
          className="task-title min-w-0 flex-1 text-left"
        >
          {task.title}
        </button>
      </div>

      {summary && <p className="task-summary">{summary}</p>}

      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        <span className={`priority-${task.priority} rounded-full px-2 py-0.5`}>
          {priorityLabels[task.priority]}
        </span>
        {sprint && <span className="meta-chip">{sprint}</span>}
        {estimate && <span className="meta-chip">Peso {estimate.replace(/\s*\(.*\)/, '')}</span>}
        {scheduleInfo?.critical && <span className="critical-chip" title="Ruta crítica">◆ Crítica</span>}
      </div>

      {(task.start_date || task.end_date) && (
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
          {task.start_date ? shortDate(task.start_date) : 'Sin inicio'} → {task.end_date ? shortDate(task.end_date) : 'Sin fin'}
          {scheduleInfo && ` · ${scheduleInfo.duration} d háb.`}
        </p>
      )}
      {predecessorNumbers.length > 0 && (
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          Depende de {predecessorNumbers.map((value) => `#${value}`).join(', ')}
          {scheduleInfo?.startsBeforePredecessor && (
            <span className="ml-1 text-[var(--priority-medium)]" title="Empieza antes de que termine una predecesora">
              ⚠ solapada
            </span>
          )}
        </p>
      )}

      <div className="task-actions">
        <button type="button" onClick={() => onOpen(task, 'view')} className="btn-ghost px-2 py-1 text-xs">
          Ver detalle
        </button>
        {canEdit && (
          <>
            <select
              value={task.column_id}
              onChange={(event) => onMove(task, event.target.value)}
              disabled={moving}
              className="control-input min-w-0 max-w-32 rounded-lg px-2 py-1 text-xs"
              aria-label={`Mover la tarea ${number ?? ''} a otra columna`}
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
            <button type="button" onClick={() => onOpen(task, 'edit')} className="btn-ghost px-2 py-1 text-xs">
              Editar
            </button>
            <button type="button" onClick={() => onDelete(task)} className="btn-danger px-2 py-1 text-xs" aria-label={`Eliminar la tarea ${number ?? ''}`}>
              Eliminar
            </button>
          </>
        )}
      </div>
    </article>
  )
}

export default memo(TaskCard)

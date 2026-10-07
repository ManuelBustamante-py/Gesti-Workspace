import { memo, type ReactNode } from 'react'

import { formatDateKey } from '../../domain/dates'
import type { BoardPerson } from '../../domain/people'
import { descriptionField, descriptionSummary } from '../../domain/description'
import type { ColumnStatus } from '../../domain/columnStatus'
import type { TaskRelation } from '../../domain/dependencies'
import type { TaskScheduleInfo } from '../../domain/schedule'
import type { Task } from '../../services/tasks'
import { priorityLabels } from '../../domain/priority'
import AssigneeAvatars from './AssigneeAvatars'
import StatusDateControl, { type StatusDateSave } from './StatusDateControl'

export type { TaskRelation } from '../../domain/dependencies'

interface TaskCardProps {
  task: Task
  number: number | undefined
  predecessorNumbers: number[]
  columns: { id: string; name: string }[]
  scheduleInfo?: TaskScheduleInfo
  assignees: BoardPerson[]
  comments?: { total: number; alerts: number }
  canEdit: boolean
  moving: boolean
  relation: TaskRelation | null
  onOpen: (task: Task, mode: 'view' | 'edit') => void
  onMove: (task: Task, columnId: string) => void
  onDelete: (task: Task) => void
  onToggleRelation: (taskId: string) => void
  /** Asa de arrastre (solo para quien puede editar). */
  dragHandle?: ReactNode
  /** Estado y nombre de la columna (para las fechas de seguimiento del flujo). */
  columnStatus: ColumnStatus
  columnName: string
  /** Días de atraso respecto de su fecha de fin (null si no está atrasada). */
  overdueDays: number | null
  /** Resaltado de «Atrasadas»: la tarjeta se destaca o se atenúa. */
  emphasis: 'overdue' | 'dimmed' | null
  onSaveStatusDate: StatusDateSave
}

const shortDate = (value: string) => formatDateKey(value, { day: 'numeric', month: 'short' })

function TaskCard({
  task,
  number,
  predecessorNumbers,
  columns,
  scheduleInfo,
  assignees,
  comments,
  canEdit,
  moving,
  relation,
  onOpen,
  onMove,
  onDelete,
  onToggleRelation,
  dragHandle,
  columnStatus,
  columnName,
  overdueDays,
  emphasis,
  onSaveStatusDate,
}: TaskCardProps) {
  const summary = task.description ? descriptionSummary(task.description) : ''
  const sprint = task.description ? descriptionField(task.description, 'Sprint') : null
  const estimate = task.description ? descriptionField(task.description, 'Estimación') : null

  return (
    <article
      className={`task-card task-card-${task.priority} transition ${relation === 'dimmed' || emphasis === 'dimmed' ? 'opacity-40' : ''} ${emphasis === 'overdue' ? 'task-card-overdue-focus' : ''} ${columnStatus === 'done' && task.completed_at ? 'task-card-completed' : ''} ${
        relation === 'selected' ? 'ring-2 ring-[var(--accent-mint)]' : relation === 'predecessor' ? 'task-card-predecessor' : relation === 'successor' ? 'task-card-successor' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        {dragHandle}
        <button
          type="button"
          onClick={() => onToggleRelation(task.id)}
          className={`task-number ${relation && relation !== 'dimmed' ? `task-number-${relation}` : ''}`}
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
        {overdueDays !== null && (
          <span className="overdue-chip" title={`La fecha de fin era el ${task.end_date}`}>
            ⚠ Atrasada {overdueDays} d
          </span>
        )}
        {comments && comments.alerts > 0 && (
          <span className="alert-chip" title="Tiene problemas o parches temporales reportados en los comentarios">
            ⚠ {comments.alerts} {comments.alerts === 1 ? 'aviso' : 'avisos'}
          </span>
        )}
        {comments && comments.total > 0 && (
          <span className="meta-chip" title={`${comments.total} comentario(s)`}>💬 {comments.total}</span>
        )}
        {assignees.length > 0 && (
          <span className="ml-auto">
            <AssigneeAvatars people={assignees} />
          </span>
        )}
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

      {/* «Completada el» en Completado; «En esta columna desde» en En progreso (y en
          Pendiente solo si ya se registró: allí se edita desde el detalle). */}
      {columnStatus === 'done' && (
        <StatusDateControl task={task} variant="completed" columnName={columnName} canEdit={canEdit} onSave={onSaveStatusDate} />
      )}
      {(columnStatus === 'in_progress' || (columnStatus === 'todo' && task.column_entered_at)) && (
        <StatusDateControl task={task} variant="entered" columnName={columnName} canEdit={canEdit} onSave={onSaveStatusDate} />
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

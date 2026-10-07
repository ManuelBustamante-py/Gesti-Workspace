import { useState, type FormEvent } from 'react'

import {
  COLUMN_STATUSES,
  columnStatusLabels,
  resolveColumnStatus,
  type ColumnStatus,
} from '../../domain/columnStatus'
import type { BoardPerson } from '../../domain/people'
import { diffDays, todayKey } from '../../domain/dates'
import type { TaskScheduleInfo } from '../../domain/schedule'
import type { BoardColumn } from '../../services/columns'
import type { Task, TaskPriority } from '../../services/tasks'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'

import SortableTaskCard from './SortableTaskCard'
import type { StatusDateSave } from './StatusDateControl'
import type { TaskRelation } from './TaskCard'

export type TaskDraft = { title: string; priority: TaskPriority; startDate: string; endDate: string }

const emptyTaskDraft: TaskDraft = { title: '', priority: 'medium', startDate: '', endDate: '' }

interface ColumnProps {
  column: BoardColumn
  tasks: Task[]
  columns: BoardColumn[]
  numbers: Map<string, number>
  schedule: Map<string, TaskScheduleInfo>
  relations: Map<string, TaskRelation>
  assignments: Record<string, string[]>
  peopleById: Map<string, BoardPerson>
  commentStats: Record<string, { total: number; alerts: number }>
  canEdit: boolean
  /** Arrastrar y soltar activo (editores y sin filtros). */
  dragEnabled: boolean
  creatingTask: boolean
  movingTaskId: string | null
  onRename: (name: string, status: ColumnStatus) => Promise<boolean>
  onDelete: () => void
  onCreateTask: (draft: TaskDraft) => Promise<boolean>
  onOpenTask: (task: Task, mode: 'view' | 'edit') => void
  onMoveTask: (task: Task, columnId: string) => void
  onDeleteTask: (task: Task) => void
  onToggleRelation: (taskId: string) => void
  /** Modo «Atrasadas»: destaca las tareas atrasadas y atenúa el resto. */
  highlightOverdue: boolean
  onSaveStatusDate: StatusDateSave
}

function Column({
  column,
  tasks,
  columns,
  numbers,
  schedule,
  relations,
  assignments,
  peopleById,
  commentStats,
  canEdit,
  dragEnabled,
  creatingTask,
  movingTaskId,
  onRename,
  onDelete,
  onCreateTask,
  onOpenTask,
  onMoveTask,
  onDeleteTask,
  onToggleRelation,
  highlightOverdue,
  onSaveStatusDate,
}: ColumnProps) {
  const status = resolveColumnStatus(column)
  const today = todayKey()
  // Atrasada: no está completada y su fecha de fin ya pasó.
  const overdueDays = (task: Task) =>
    status !== 'done' && task.end_date && task.end_date < today ? diffDays(task.end_date, today) : null
  // Toda la lista es zona de destino, también cuando la columna está vacía.
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: column.id, disabled: !dragEnabled })
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(column.name)
  const [nextStatus, setNextStatus] = useState<ColumnStatus>(status)
  const [savingColumn, setSavingColumn] = useState(false)
  const [draft, setDraft] = useState<TaskDraft>(emptyTaskDraft)
  const [showDraftDetails, setShowDraftDetails] = useState(false)

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavingColumn(true)
    const saved = await onRename(name, nextStatus)
    setSavingColumn(false)
    if (saved) setEditing(false)
  }

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (await onCreateTask(draft)) {
      setDraft(emptyTaskDraft)
    }
  }

  return (
    <section className={`column-panel column-status-${status}`} aria-label={`Columna ${column.name}`}>
      {editing ? (
        <form onSubmit={submitRename} className="space-y-2">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="control-input w-full rounded-lg px-3 py-2"
            aria-label="Nombre de la columna"
            required
          />
          <label className="field-label">
            Estado de sus tareas
            <select
              value={nextStatus}
              onChange={(event) => setNextStatus(event.target.value as ColumnStatus)}
              className="control-input mt-1 w-full rounded-lg px-3 py-2 text-sm"
            >
              {COLUMN_STATUSES.map((value) => (
                <option key={value} value={value}>{columnStatusLabels[value]}</option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={savingColumn} className="btn-mint-primary px-3 py-2 text-sm">
              {savingColumn ? 'Guardando...' : 'Guardar'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setName(column.name)
                setNextStatus(status)
              }}
              className="btn-ghost px-3 py-2 text-sm"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <header>
          <div className="flex items-center justify-between gap-3">
            <h4 className="column-title min-w-0 truncate text-base font-semibold text-[var(--text-main)]">
              {column.name}
            </h4>
            <span className="column-count" aria-label={`${tasks.length} tareas`}>{tasks.length}</span>
          </div>
          <p className="mt-1 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            {columnStatusLabels[status]}
          </p>
          {canEdit && (
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setEditing(true)} className="btn-ghost px-3 py-1.5 text-xs">Editar</button>
              <button type="button" onClick={onDelete} className="btn-danger px-3 py-1.5 text-xs">Eliminar</button>
            </div>
          )}
        </header>
      )}

      {canEdit && (
        <form onSubmit={submitTask} className="mt-4 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="Nueva tarea"
              aria-label={`Nueva tarea en ${column.name}`}
              className="control-input min-w-0 flex-1 rounded-lg px-3 py-2 text-sm"
            />
            <button type="submit" disabled={creatingTask || !draft.title.trim()} className="btn-mint-primary shrink-0 px-3 py-2 text-sm disabled:opacity-50">
              {creatingTask ? '...' : 'Agregar'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowDraftDetails((value) => !value)}
            className="text-xs text-[var(--text-muted)] hover:text-white"
            aria-expanded={showDraftDetails}
          >
            {showDraftDetails ? '− Ocultar prioridad y fechas' : '+ Prioridad y fechas'}
          </button>
          {showDraftDetails && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select
                value={draft.priority}
                onChange={(event) => setDraft({ ...draft, priority: event.target.value as TaskPriority })}
                className="control-input rounded-lg px-2 py-2 text-sm"
                aria-label="Prioridad"
              >
                <option value="high">Alta</option>
                <option value="medium">Media</option>
                <option value="low">Baja</option>
              </select>
              <input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} className="control-input min-w-0 rounded-lg px-2 py-2 text-sm" aria-label="Fecha de inicio" />
              <input type="date" value={draft.endDate} min={draft.startDate || undefined} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} className="control-input min-w-0 rounded-lg px-2 py-2 text-sm" aria-label="Fecha de fin" />
            </div>
          )}
        </form>
      )}

      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
      <div ref={setDropRef} className={`task-drop-zone mt-4 space-y-2 ${isOver ? 'task-drop-zone-over' : ''}`}>
        {tasks.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{dragEnabled ? 'Sin tareas. Puedes soltar una aquí.' : 'No hay tareas aún.'}</p>
        ) : (
          tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              dragEnabled={dragEnabled}
              task={task}
              number={numbers.get(task.id)}
              predecessorNumbers={(task.predecessor_ids ?? [])
                .map((id) => numbers.get(id))
                .filter((value): value is number => value !== undefined)}
              columns={columns}
              scheduleInfo={schedule.get(task.id)}
              comments={commentStats[task.id]}
              assignees={(assignments[task.id] ?? [])
                .map((userId) => peopleById.get(userId))
                .filter((person): person is BoardPerson => Boolean(person))}
              canEdit={canEdit}
              moving={movingTaskId === task.id}
              relation={relations.get(task.id) ?? null}
              onOpen={onOpenTask}
              onMove={onMoveTask}
              onDelete={onDeleteTask}
              onToggleRelation={onToggleRelation}
              columnStatus={status}
              columnName={column.name}
              overdueDays={overdueDays(task)}
              emphasis={highlightOverdue ? (overdueDays(task) !== null ? 'overdue' : 'dimmed') : null}
              onSaveStatusDate={onSaveStatusDate}
            />
          ))
        )}
      </div>
      </SortableContext>
    </section>
  )
}

export default Column

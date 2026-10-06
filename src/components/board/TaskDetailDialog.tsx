import { useState, type FormEvent } from 'react'

import Modal from '../ui/Modal'
import AssigneeAvatars from './AssigneeAvatars'
import AssigneePicker from './AssigneePicker'
import TaskComments from './TaskComments'
import TaskDescription from './TaskDescription'
import { columnStatusLabels, resolveColumnStatus } from '../../domain/columnStatus'
import { formatDateKey } from '../../domain/dates'
import { descriptionField } from '../../domain/description'
import type { BoardPerson } from '../../domain/people'
import { priorityLabels } from '../../domain/priority'
import type { TaskScheduleInfo } from '../../domain/schedule'
import type { BoardColumn } from '../../services/columns'
import type { Task, TaskInput, TaskPriority } from '../../services/tasks'

interface TaskDetailDialogProps {
  task: Task
  columns: BoardColumn[]
  allTasks: Task[]
  numbers: Map<string, number>
  scheduleInfo?: TaskScheduleInfo
  canEdit: boolean
  initialMode: 'view' | 'edit'
  saving: boolean
  /** Propietario y colaboradores que pueden ser responsables. */
  people: BoardPerson[]
  assignees: BoardPerson[]
  canAssign: boolean
  assigneesSupported: boolean
  currentUserId: string | undefined
  boardId: string
  isBoardOwner: boolean
  commentsSupported: boolean
  onSaveAssignees: (userIds: string[]) => Promise<boolean>
  onSave: (input: TaskInput & { predecessorIds: string[] }) => Promise<boolean>
  onDelete: () => void
  onClose: () => void
}

function TaskDetailDialog({
  task,
  columns,
  allTasks,
  numbers,
  scheduleInfo,
  canEdit,
  initialMode,
  saving,
  people,
  assignees,
  canAssign,
  assigneesSupported,
  currentUserId,
  boardId,
  isBoardOwner,
  commentsSupported,
  onSaveAssignees,
  onSave,
  onDelete,
  onClose,
}: TaskDetailDialogProps) {
  const [mode, setMode] = useState(canEdit ? initialMode : 'view')
  const [form, setForm] = useState({
    title: task.title,
    description: task.description ?? '',
    priority: task.priority,
    startDate: task.start_date ?? '',
    endDate: task.end_date ?? '',
    predecessorIds: task.predecessor_ids ?? [],
  })
  const [predecessorQuery, setPredecessorQuery] = useState('')
  const [pickingAssignees, setPickingAssignees] = useState(false)
  const [savingAssignees, setSavingAssignees] = useState(false)

  async function handleSaveAssignees(userIds: string[]) {
    setSavingAssignees(true)
    const saved = await onSaveAssignees(userIds)
    setSavingAssignees(false)
    if (saved) setPickingAssignees(false)
  }

  const column = columns.find((item) => item.id === task.column_id)
  const status = column ? resolveColumnStatus(column) : 'todo'
  const number = numbers.get(task.id)
  const label = (item: Task) => `#${numbers.get(item.id) ?? '?'} · ${item.title}`
  const predecessors = allTasks.filter((item) => (task.predecessor_ids ?? []).includes(item.id))
  const successors = allTasks.filter((item) => (item.predecessor_ids ?? []).includes(task.id))
  const sprint = task.description ? descriptionField(task.description, 'Sprint') : null
  const estimate = task.description ? descriptionField(task.description, 'Estimación') : null

  const query = predecessorQuery.trim().toLowerCase()
  const candidates = allTasks
    .filter((item) => item.id !== task.id)
    .filter((item) => !query || label(item).toLowerCase().includes(query))
    .sort((left, right) => (numbers.get(left.id) ?? 0) - (numbers.get(right.id) ?? 0))

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const saved = await onSave(form)
    if (saved) setMode('view')
  }

  const viewContent = (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className={`status-pill status-pill-${status}`}>{columnStatusLabels[status]}</span>
        <span className={`priority-${task.priority} rounded-full px-2 py-1`}>Prioridad {priorityLabels[task.priority].toLowerCase()}</span>
        {sprint && <span className="meta-chip">{sprint}</span>}
        {estimate && <span className="meta-chip">Peso {estimate}</span>}
        {scheduleInfo?.critical && <span className="critical-chip">◆ Ruta crítica</span>}
      </div>

      <section className="assignee-section" aria-labelledby={`assignees-${task.id}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`assignees-${task.id}`} className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Responsables
          </h3>
          {canAssign && assigneesSupported && !pickingAssignees && (
            <button type="button" onClick={() => setPickingAssignees(true)} className="btn-ghost px-3 py-1.5 text-xs">
              {assignees.length ? 'Cambiar responsables' : '+ Asignar responsables'}
            </button>
          )}
        </div>
        {!assigneesSupported ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Las asignaciones estarán disponibles cuando se aplique la migración de responsables en Supabase.
          </p>
        ) : pickingAssignees ? (
          <div className="mt-3">
            <AssigneePicker
              people={people}
              selectedIds={assignees.map((person) => person.userId)}
              currentUserId={currentUserId}
              saving={savingAssignees}
              onSave={(userIds) => void handleSaveAssignees(userIds)}
              onCancel={() => setPickingAssignees(false)}
            />
          </div>
        ) : assignees.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Sin responsables{canAssign ? '.' : '. Solo el propietario del tablero puede asignarlos.'}
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {assignees.map((person) => (
              <li key={person.userId} className="assignee-chip">
                <AssigneeAvatars people={[person]} max={1} />
                <span className="truncate">
                  {person.name}
                  {person.userId === currentUserId && <span className="text-[var(--text-muted)]"> (tú)</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <dl className="detail-grid">
        <div>
          <dt>Columna</dt>
          <dd>{column?.name ?? '—'}</dd>
        </div>
        <div>
          <dt>Fechas</dt>
          <dd>
            {task.start_date ? formatDateKey(task.start_date) : 'Sin inicio'} → {task.end_date ? formatDateKey(task.end_date) : 'Sin fin'}
          </dd>
        </div>
        {scheduleInfo && (
          <div>
            <dt>Duración</dt>
            <dd>
              {scheduleInfo.duration} día{scheduleInfo.duration === 1 ? '' : 's'} hábil{scheduleInfo.duration === 1 ? '' : 'es'}
              {Number.isFinite(scheduleInfo.totalFloat) && scheduleInfo.totalFloat > 0 && ` · holgura ${scheduleInfo.totalFloat}`}
            </dd>
          </div>
        )}
        <div>
          <dt>Predecesoras</dt>
          <dd>{predecessors.length ? predecessors.map(label).join(', ') : 'Ninguna'}</dd>
        </div>
        <div>
          <dt>Sucesoras</dt>
          <dd>{successors.length ? successors.map(label).join(', ') : 'Ninguna'}</dd>
        </div>
      </dl>

      {scheduleInfo?.startsBeforePredecessor && (
        <p className="alert-warning rounded-lg p-3 text-sm">
          ⚠ Esta tarea empieza antes de que termine una de sus predecesoras. Revisa las fechas o la dependencia.
        </p>
      )}

      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Descripción</h3>
        <TaskDescription text={task.description ?? ''} />
      </div>

      <div className="border-t border-white/10 pt-5">
        {commentsSupported ? (
          <TaskComments
            boardId={boardId}
            taskId={task.id}
            currentUserId={currentUserId}
            canComment={canEdit}
            isBoardOwner={isBoardOwner}
          />
        ) : (
          <p className="text-sm text-[var(--text-muted)]">
            Los comentarios estarán disponibles cuando se aplique la migración de comentarios en Supabase.
          </p>
        )}
      </div>
    </div>
  )

  const editContent = (
    <form id={`task-form-${task.id}`} onSubmit={handleSubmit} className="space-y-4">
      <label className="field-label">
        Título
        <input
          type="text"
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          required
          className="control-input mt-1 w-full rounded-lg px-3 py-2"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="field-label">
          Prioridad
          <select
            value={form.priority}
            onChange={(event) => setForm({ ...form, priority: event.target.value as TaskPriority })}
            className="control-input mt-1 w-full rounded-lg px-3 py-2"
          >
            <option value="high">Alta</option>
            <option value="medium">Media</option>
            <option value="low">Baja</option>
          </select>
        </label>
        <label className="field-label">
          Inicio
          <input
            type="date"
            value={form.startDate}
            onChange={(event) => setForm({ ...form, startDate: event.target.value })}
            className="control-input mt-1 w-full rounded-lg px-3 py-2"
          />
        </label>
        <label className="field-label">
          Fin
          <input
            type="date"
            value={form.endDate}
            min={form.startDate || undefined}
            onChange={(event) => setForm({ ...form, endDate: event.target.value })}
            className="control-input mt-1 w-full rounded-lg px-3 py-2"
          />
        </label>
      </div>

      <label className="field-label">
        Descripción
        <textarea
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
          rows={10}
          className="control-input mt-1 w-full resize-y rounded-lg px-3 py-2 text-sm leading-relaxed"
          aria-describedby={`description-help-${task.id}`}
        />
        <span id={`description-help-${task.id}`} className="mt-1 block text-xs text-[var(--text-muted)]">
          Formato opcional: «▌Título» o «## Título» para secciones, «1.» para pasos y «•» o «-» para viñetas.
        </span>
      </label>

      <fieldset>
        <legend className="field-label">
          Predecesoras (fin a inicio) · {form.predecessorIds.length} seleccionada{form.predecessorIds.length === 1 ? '' : 's'}
        </legend>
        <input
          type="search"
          value={predecessorQuery}
          onChange={(event) => setPredecessorQuery(event.target.value)}
          placeholder="Buscar por número o título"
          className="control-input mt-1 w-full rounded-lg px-3 py-2 text-sm"
          aria-label="Buscar predecesoras"
        />
        <div className="predecessor-list mt-2">
          {candidates.length === 0 ? (
            <p className="p-3 text-sm text-[var(--text-muted)]">No hay tareas que coincidan.</p>
          ) : (
            candidates.map((candidate) => {
              const checked = form.predecessorIds.includes(candidate.id)
              return (
                <label key={candidate.id} className={`predecessor-option ${checked ? 'predecessor-option-checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setForm({
                        ...form,
                        predecessorIds: checked
                          ? form.predecessorIds.filter((id) => id !== candidate.id)
                          : [...form.predecessorIds, candidate.id],
                      })
                    }
                  />
                  <span className="min-w-0">{label(candidate)}</span>
                </label>
              )
            })
          )}
        </div>
      </fieldset>
    </form>
  )

  return (
    <Modal
      title={
        <>
          {number !== undefined && <span className="mr-2 text-[var(--text-muted)]">#{number}</span>}
          {mode === 'edit' ? 'Editar tarea' : task.title}
        </>
      }
      subtitle={mode === 'edit' ? task.title : undefined}
      onClose={onClose}
      size="xl"
      focusFirstField={mode === 'edit'}
      footer={
        mode === 'edit' ? (
          <>
            <button type="button" onClick={() => setMode('view')} className="btn-ghost px-4 py-2 text-sm">
              Cancelar
            </button>
            <button type="submit" form={`task-form-${task.id}`} disabled={saving} className="btn-mint-primary px-4 py-2 text-sm font-semibold">
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </>
        ) : canEdit ? (
          <>
            <button type="button" onClick={onDelete} className="btn-danger mr-auto px-4 py-2 text-sm">
              Eliminar
            </button>
            <button type="button" onClick={() => setMode('edit')} className="btn-mint-primary px-4 py-2 text-sm font-semibold">
              Editar
            </button>
          </>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">👀 Tienes acceso de lectura a este tablero.</span>
        )
      }
    >
      {mode === 'edit' ? editContent : viewContent}
    </Modal>
  )
}

export default TaskDetailDialog

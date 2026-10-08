import { useEffect, useMemo, useState, type FormEvent } from 'react'

import Modal from '../ui/Modal'
import { boardWorkingDays, type Board } from '../../services/boards'
import type { BoardColumn } from '../../services/columns'
import type { Task } from '../../services/tasks'
import { resolveColumnStatus } from '../../domain/columnStatus'
import { formatDateKey } from '../../domain/dates'
import { activityNumbers } from '../../domain/numbering'
import { planProjectDates, tasksDateRange, type TaskDates } from '../../domain/projectDates'

export type BoardContent = { columns: BoardColumn[]; tasksByColumn: Record<string, Task[]> }

export type EditBoardValues = {
  name: string
  description: string
  color: string
  start: string | null
  end: string | null
  /** Tareas pendientes con fechas nuevas (vacío si no se mueven). */
  taskDates: TaskDates[]
}

interface EditBoardModalProps {
  board: Board
  /** Columnas y tareas del tablero, para calcular el impacto de cambiar las fechas. */
  loadContent: () => Promise<BoardContent>
  onSave: (values: EditBoardValues) => Promise<string | null>
  onClose: () => void
}

const short = (day: string | null) => (day ? formatDateKey(day, { day: 'numeric', month: 'short' }) : '—')
const range = (task: TaskDates) => `${short(task.start_date)} – ${short(task.end_date)}`
const PREVIEW_LIMIT = 5

function EditBoardModal({ board, loadContent, onSave, onClose }: EditBoardModalProps) {
  const [name, setName] = useState(board.name)
  const [description, setDescription] = useState(board.description ?? '')
  const [color, setColor] = useState(board.color)
  const [start, setStart] = useState(board.start_date ?? '')
  const [end, setEnd] = useState(board.end_date ?? '')
  // Al fijar el inicio por primera vez lo normal es registrarlo, no mover el proyecto.
  const [shiftTasks, setShiftTasks] = useState(Boolean(board.start_date))
  const [content, setContent] = useState<BoardContent | null>(null)
  const [contentError, setContentError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    loadContent()
      .then((result) => {
        if (!cancelled) setContent(result)
      })
      .catch(() => {
        if (!cancelled) setContentError('No se pudieron cargar las tareas para calcular el impacto.')
      })
    return () => {
      cancelled = true
    }
  }, [loadContent])

  const analysis = useMemo(() => {
    if (!content) return null
    const numbers = activityNumbers(content.columns, content.tasksByColumn)
    const allTasks = Object.values(content.tasksByColumn).flat()
    const pendingTasks = content.columns
      .filter((column) => resolveColumnStatus(column) !== 'done')
      .flatMap((column) => content.tasksByColumn[column.id] ?? [])
    const tasksRange = tasksDateRange(allTasks)
    const nextStart = start || null
    const nextEnd = end || null
    const plan = planProjectDates({
      pendingTasks,
      previousStart: board.start_date ?? tasksRange.start,
      start: nextStart !== (board.start_date ?? null) ? nextStart : null,
      end: nextEnd,
      shiftTasks,
      workingDays: boardWorkingDays(board),
    })
    // Sin cambio de inicio no se mueve nada, pero se revisa contra el inicio vigente.
    const startBefore = nextStart && nextStart === (board.start_date ?? null)
      ? pendingTasks.filter((task) => task.start_date && task.start_date < nextStart).map((task) => task.id)
      : plan.startBeforeProject
    const label = (ids: string[]) =>
      ids.slice(0, 8).map((id) => `#${numbers.get(id) ?? '?'}`).join(', ') + (ids.length > 8 ? ` y ${ids.length - 8} más` : '')
    return { numbers, tasksRange, plan, startBefore, label }
  }, [board, content, end, shiftTasks, start])

  const datesChanged = (start || null) !== (board.start_date ?? null) || (end || null) !== (board.end_date ?? null)
  const startChanged = (start || null) !== (board.start_date ?? null)
  const invalidRange = Boolean(start && end && start > end)
  const plan = analysis?.plan
  const moving = shiftTasks && plan ? plan.moved : []
  const canShift = Boolean(startChanged && start && plan && (board.start_date ?? analysis?.tasksRange.start))

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) {
      setError('El tablero debe tener un nombre.')
      return
    }
    if (invalidRange) {
      setError('El inicio del proyecto no puede ser posterior al fin.')
      return
    }
    if (datesChanged && !content) {
      setError(contentError || 'Espera a que se calcule el impacto en las tareas.')
      return
    }
    setSaving(true)
    const saveError = await onSave({
      name: name.trim(),
      description: description.trim(),
      color,
      start: start || null,
      end: end || null,
      taskDates: moving.map(({ after }) => after),
    })
    setSaving(false)
    if (saveError) setError(saveError)
  }

  return (
    <Modal
      title="Editar tablero"
      size="md"
      focusFirstField
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" form="edit-board-form" disabled={saving || invalidRange} className="btn-mint-primary px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {saving ? 'Guardando...' : moving.length > 0 ? `Guardar y mover ${moving.length} tarea(s)` : 'Guardar cambios'}
          </button>
        </>
      }
    >
      <form id="edit-board-form" onSubmit={handleSubmit} className="space-y-4">
        <label className="field-label">
          Nombre
          <input type="text" value={name} onChange={(event) => setName(event.target.value)} required className="theme-input mt-1 w-full rounded-lg px-4 py-3" />
        </label>
        <label className="field-label">
          Descripción
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="theme-input mt-1 w-full resize-none rounded-lg px-4 py-3" />
        </label>
        <label className="field-label">
          Color
          <input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="theme-input mt-1 block h-10 w-16 cursor-pointer rounded" />
        </label>

        <fieldset className="project-dates">
          <legend className="text-sm font-medium text-white">Fechas del proyecto</legend>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            El fin comprometido es la meta contra la que se miden el flujo acumulado (CFD), el Gantt y el resumen.
            {analysis && !board.start_date && !board.end_date && analysis.tasksRange.start && (
              <> Hoy se usan las fechas de las tareas: {short(analysis.tasksRange.start)} – {short(analysis.tasksRange.end)}.</>
            )}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="field-label">
              Inicio del proyecto
              <input type="date" value={start} max={end || undefined} onChange={(event) => setStart(event.target.value)} className="theme-input mt-1 w-full rounded-lg px-3 py-2" />
            </label>
            <label className="field-label">
              Fin comprometido
              <input type="date" value={end} min={start || undefined} onChange={(event) => setEnd(event.target.value)} className="theme-input mt-1 w-full rounded-lg px-3 py-2" />
            </label>
          </div>
          {invalidRange && <p className="mt-2 text-xs text-[var(--critical)]">El inicio no puede ser posterior al fin.</p>}

          {datesChanged && !invalidRange && (
            <div className="alert-warning mt-3 space-y-2 rounded-lg p-3 text-sm" role="status">
              <p className="font-semibold">⚠ Cambiar las fechas del proyecto puede reprogramar tareas</p>
              {!content && !contentError && <p>Calculando el impacto en las tareas…</p>}
              {contentError && <p>{contentError}</p>}
              {analysis && plan && (
                <>
                  {canShift && plan.shiftDays !== 0 && (
                    <label className="flex items-start gap-2">
                      <input type="checkbox" checked={shiftTasks} onChange={(event) => setShiftTasks(event.target.checked)} className="mt-1" />
                      <span>
                        Mover las tareas pendientes junto con el inicio ({Math.abs(plan.shiftDays)} día(s) hábil(es) {plan.shiftDays > 0 ? 'después' : 'antes'}).
                        Conservan su duración, orden y dependencias.
                      </span>
                    </label>
                  )}
                  {moving.length > 0 && (
                    <ul className="project-dates-moves">
                      {moving.slice(0, PREVIEW_LIMIT).map(({ before, after }) => (
                        <li key={after.id}>
                          <strong>#{analysis.numbers.get(after.id) ?? '?'}</strong> {range(before)} → {range(after)}
                        </li>
                      ))}
                      {moving.length > PREVIEW_LIMIT && <li>y {moving.length - PREVIEW_LIMIT} tarea(s) más</li>}
                    </ul>
                  )}
                  {plan.endAfterProject.length > 0 && (
                    <p>
                      {plan.endAfterProject.length} tarea(s) pendiente(s) terminan después del fin comprometido ({analysis.label(plan.endAfterProject)}).
                      No se mueven: ajústalas o revisa el fin.
                    </p>
                  )}
                  {analysis.startBefore.length > 0 && (
                    <p>{analysis.startBefore.length} tarea(s) pendiente(s) empiezan antes del inicio del proyecto ({analysis.label(analysis.startBefore)}).</p>
                  )}
                  {moving.length === 0 && plan.endAfterProject.length === 0 && analysis.startBefore.length === 0 && (
                    <p>Ninguna tarea cambia ni queda fuera del rango.</p>
                  )}
                  <p className="text-xs opacity-80">Las tareas completadas nunca se modifican: sus fechas son historial real del proyecto.</p>
                </>
              )}
            </div>
          )}
        </fieldset>

        {error && <p className="alert-error rounded-lg p-3 text-sm" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}

export default EditBoardModal

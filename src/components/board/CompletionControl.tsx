import { useState, type FormEvent } from 'react'

import { formatDateKey, todayKey } from '../../domain/dates'
import type { Task } from '../../services/tasks'

interface CompletionControlProps {
  task: Task
  canEdit: boolean
  onSetCompletion: (task: Task, completedOn: string | null) => Promise<boolean>
}

/**
 * Confirmación de finalización para tareas en columnas «Completado»: registra
 * la fecha real en que se terminó (la usa el diagrama de flujo acumulado).
 */
function CompletionControl({ task, canEdit, onSetCompletion }: CompletionControlProps) {
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState(task.completed_at ?? todayKey())
  const [saving, setSaving] = useState(false)

  async function save(value: string | null) {
    setSaving(true)
    const saved = await onSetCompletion(task, value)
    setSaving(false)
    if (saved) setEditing(false)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void save(date)
  }

  if (editing) {
    return (
      <form onSubmit={handleSubmit} className="completion-form">
        <label className="field-label">
          Fecha en que se completó
          <input
            type="date"
            value={date}
            max={todayKey()}
            onChange={(event) => setDate(event.target.value)}
            required
            className="control-input mt-1 w-full rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={saving || !date} className="btn-mint-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
          {task.completed_at && (
            <button type="button" onClick={() => void save(null)} disabled={saving} className="btn-danger px-3 py-1.5 text-xs">
              Quitar marca
            </button>
          )}
          <button type="button" onClick={() => setEditing(false)} className="btn-ghost px-3 py-1.5 text-xs">
            Cancelar
          </button>
        </div>
      </form>
    )
  }

  if (task.completed_at) {
    return (
      <p className="completion-confirmed">
        <span aria-hidden="true">✓</span>
        <span className="min-w-0 flex-1">
          Completada el <strong>{formatDateKey(task.completed_at, { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
        </span>
        {canEdit && (
          <button type="button" onClick={() => setEditing(true)} className="completion-change">
            Cambiar
          </button>
        )}
      </p>
    )
  }

  return canEdit ? (
    <button type="button" onClick={() => setEditing(true)} className="completion-confirm">
      ✓ Confirmar finalización
    </button>
  ) : (
    <p className="text-[11px] text-[var(--text-muted)]">Finalización sin confirmar.</p>
  )
}

export default CompletionControl

import { useState, type FormEvent } from 'react'

import { formatDateKey, todayKey } from '../../domain/dates'
import type { Task, TaskStatusDateField } from '../../services/tasks'

export type StatusDateSave = (task: Task, field: TaskStatusDateField, value: string | null) => Promise<boolean>

interface StatusDateControlProps {
  task: Task
  /** «Completada el» en columnas «Completado»; «En esta columna desde» en el resto. */
  variant: 'completed' | 'entered'
  columnName: string
  canEdit: boolean
  onSave: StatusDateSave
}

const longDate = (value: string) => formatDateKey(value, { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Fecha real de seguimiento del flujo de una tarea. La usa el diagrama de flujo
 * acumulado en lugar del momento en que se movió la tarjeta.
 */
function StatusDateControl({ task, variant, columnName, canEdit, onSave }: StatusDateControlProps) {
  const field: TaskStatusDateField = variant === 'completed' ? 'completed_at' : 'column_entered_at'
  const value = task[field] ?? null
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState(value ?? todayKey())
  const [saving, setSaving] = useState(false)

  const text = variant === 'completed'
    ? { action: '✓ Confirmar finalización', label: 'Fecha en que se completó', shown: 'Completada el', remove: 'Quitar marca' }
    : { action: `📍 ¿Desde cuándo está en «${columnName}»?`, label: `Fecha en que entró a «${columnName}»`, shown: `En «${columnName}» desde`, remove: 'Quitar fecha' }

  async function save(next: string | null) {
    setSaving(true)
    const saved = await onSave(task, field, next)
    setSaving(false)
    if (saved) setEditing(false)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void save(date)
  }

  if (editing) {
    return (
      <form onSubmit={handleSubmit} className={`status-date-form status-date-${variant}`}>
        <label className="field-label">
          {text.label}
          <input
            type="date"
            value={date}
            max={todayKey()}
            onChange={(event) => setDate(event.target.value)}
            required
            className="control-input mt-1 w-full rounded-lg px-2 py-1.5 text-sm"
          />
        </label>
        {variant === 'entered' && (
          <span className="text-[11px] text-[var(--text-muted)]">
            Úsala si la tarjeta se movió después de que el trabajo empezara. Se borra al cambiar de columna.
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={saving || !date} className="btn-mint-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
          {value && (
            <button type="button" onClick={() => void save(null)} disabled={saving} className="btn-danger px-3 py-1.5 text-xs">
              {text.remove}
            </button>
          )}
          <button type="button" onClick={() => setEditing(false)} className="btn-ghost px-3 py-1.5 text-xs">
            Cancelar
          </button>
        </div>
      </form>
    )
  }

  if (value) {
    return (
      <p className={`status-date-shown status-date-${variant}`}>
        <span aria-hidden="true">{variant === 'completed' ? '✓' : '📍'}</span>
        <span className="min-w-0 flex-1">
          {text.shown} <strong>{longDate(value)}</strong>
        </span>
        {canEdit && (
          <button type="button" onClick={() => setEditing(true)} className="status-date-change">
            Cambiar
          </button>
        )}
      </p>
    )
  }

  if (!canEdit) {
    return variant === 'completed' ? <p className="text-[11px] text-[var(--text-muted)]">Finalización sin confirmar.</p> : null
  }

  return (
    <button type="button" onClick={() => setEditing(true)} className={`status-date-action status-date-${variant}`}>
      {text.action}
    </button>
  )
}

export default StatusDateControl

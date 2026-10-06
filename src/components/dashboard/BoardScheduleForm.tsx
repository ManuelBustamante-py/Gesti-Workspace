import { useState, type FormEvent } from 'react'

import { boardSchedule, describeWorkingDays, type BoardSchedule } from '../../domain/workSchedule'
import type { Board } from '../../services/boards'

const DAYS: Array<[number, string]> = [
  [2, 'Lun'],
  [3, 'Mar'],
  [4, 'Mié'],
  [5, 'Jue'],
  [6, 'Vie'],
  [7, 'Sáb'],
  [1, 'Dom'],
]

interface BoardScheduleFormProps {
  board: Board
  canManage: boolean
  onSave: (schedule: BoardSchedule) => Promise<boolean>
}

/** El componente se monta con key={board.updated_at}: un cambio remoto reinicia el formulario. */
function BoardScheduleForm({ board, canManage, onSave }: BoardScheduleFormProps) {
  const [schedule, setSchedule] = useState<BoardSchedule>(() => boardSchedule(board))
  const [saving, setSaving] = useState(false)

  function toggleDay(day: number) {
    setSchedule((current) => ({
      ...current,
      working_days: current.working_days.includes(day)
        ? current.working_days.filter((value) => value !== day)
        : [...current.working_days, day].sort((left, right) => left - right),
    }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    await onSave(schedule)
    setSaving(false)
  }

  if (!canManage) {
    const current = boardSchedule(board)
    return (
      <p className="text-sm text-[var(--text-muted)]">
        Jornada: <strong className="text-[var(--text-main)]">{describeWorkingDays(current.working_days)}</strong>, {current.work_start_time}–{current.work_end_time}. Solo el propietario puede cambiarla.
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <fieldset>
        <legend className="field-label">Días laborables</legend>
        <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
          {DAYS.map(([day, label]) => {
            const checked = schedule.working_days.includes(day)
            return (
              <label key={day} className={`day-toggle ${checked ? 'day-toggle-on' : ''}`}>
                <input type="checkbox" checked={checked} onChange={() => toggleDay(day)} className="sr-only" />
                {label}
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field-label">
          Hora de inicio
          <input
            type="time"
            value={schedule.work_start_time}
            onChange={(event) => setSchedule({ ...schedule, work_start_time: event.target.value })}
            className="theme-input mt-1 w-full rounded-lg px-4 py-3"
          />
        </label>
        <label className="field-label">
          Hora de término
          <input
            type="time"
            value={schedule.work_end_time}
            onChange={(event) => setSchedule({ ...schedule, work_end_time: event.target.value })}
            className="theme-input mt-1 w-full rounded-lg px-4 py-3"
          />
        </label>
      </div>

      <button type="submit" disabled={saving} className="btn-mint-primary px-4 py-3 font-semibold disabled:opacity-50">
        {saving ? 'Guardando jornada...' : 'Guardar jornada'}
      </button>
    </form>
  )
}

export default BoardScheduleForm

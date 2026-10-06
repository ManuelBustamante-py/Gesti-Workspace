import { useState } from 'react'

import { initials, type BoardPerson } from '../../domain/people'
import { roleEmotes, roleLabels } from '../../domain/roles'

interface AssigneePickerProps {
  people: BoardPerson[]
  selectedIds: string[]
  currentUserId: string | undefined
  saving: boolean
  onSave: (userIds: string[]) => void
  onCancel: () => void
}

/** Lista de propietario y colaboradores con casillas; objetivos táctiles de 44px. */
function AssigneePicker({ people, selectedIds, currentUserId, saving, onSave, onCancel }: AssigneePickerProps) {
  const [selected, setSelected] = useState<string[]>(selectedIds)

  function toggle(userId: string) {
    setSelected((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    )
  }

  return (
    <fieldset className="assignee-picker">
      <legend className="sr-only">Elegir responsables</legend>
      <div className="predecessor-list">
        {people.map((person) => {
          const checked = selected.includes(person.userId)
          return (
              <label key={person.userId} className={`predecessor-option ${checked ? 'predecessor-option-checked' : ''}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(person.userId)} />
                {person.avatarUrl ? (
                  <img src={person.avatarUrl} alt="" className="assignee-avatar assignee-avatar-inline" />
                ) : (
                  <span className="assignee-avatar assignee-avatar-inline" aria-hidden="true">{initials(person.name)}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[var(--text-main)]">
                    {person.name} {person.userId === currentUserId && <span className="text-[var(--text-muted)]">(tú)</span>}
                  </span>
                  {person.username && <span className="block truncate text-xs text-[var(--text-muted)]">@{person.username}</span>}
                </span>
                <span className="shrink-0 text-xs text-[var(--text-muted)]" title={roleLabels[person.role]}>
                  {roleEmotes[person.role]} <span className="hidden sm:inline">{roleLabels[person.role]}</span>
                </span>
              </label>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {selected.length > 0 && (
          <button type="button" onClick={() => setSelected([])} className="mr-auto text-xs text-[var(--text-muted)] hover:text-white">
            Quitar todos
          </button>
        )}
        <button type="button" onClick={onCancel} className="btn-ghost px-3 py-2 text-sm">Cancelar</button>
        <button type="button" onClick={() => onSave(selected)} disabled={saving} className="btn-mint-primary px-3 py-2 text-sm font-semibold disabled:opacity-50">
          {saving ? 'Guardando...' : `Guardar (${selected.length})`}
        </button>
      </div>
    </fieldset>
  )
}

export default AssigneePicker

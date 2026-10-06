import { useState, type FormEvent } from 'react'

import Modal from '../ui/Modal'
import type { Board } from '../../services/boards'

interface EditBoardModalProps {
  board: Board
  onSave: (values: { name: string; description: string; color: string }) => Promise<string | null>
  onClose: () => void
}

function EditBoardModal({ board, onSave, onClose }: EditBoardModalProps) {
  const [name, setName] = useState(board.name)
  const [description, setDescription] = useState(board.description ?? '')
  const [color, setColor] = useState(board.color)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) {
      setError('El tablero debe tener un nombre.')
      return
    }
    setSaving(true)
    const saveError = await onSave({ name: name.trim(), description: description.trim(), color })
    setSaving(false)
    if (saveError) setError(saveError)
  }

  return (
    <Modal
      title="Editar tablero"
      size="md"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" form="edit-board-form" disabled={saving} className="btn-mint-primary px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {saving ? 'Guardando...' : 'Guardar cambios'}
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
        {error && <p className="alert-error rounded-lg p-3 text-sm" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}

export default EditBoardModal

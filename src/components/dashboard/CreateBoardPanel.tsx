import { useState, type ChangeEvent, type FormEvent } from 'react'

export type NewBoardValues = { name: string; description: string; color: string }

const EMPTY_BOARD: NewBoardValues = { name: '', description: '', color: '#6366f1' }

interface CreateBoardPanelProps {
  creating: boolean
  importing: boolean
  /** Devuelve true si el tablero se creó (entonces se limpia el formulario). */
  onCreate: (values: NewBoardValues) => Promise<boolean>
  onImport: (file: File) => void
  onDownloadTemplate: () => void
}

/** «Crear tablero»: formulario y alternativa desde una plantilla Excel. */
function CreateBoardPanel({ creating, importing, onCreate, onImport, onDownloadTemplate }: CreateBoardPanelProps) {
  const [values, setValues] = useState<NewBoardValues>(EMPTY_BOARD)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (await onCreate(values)) setValues(EMPTY_BOARD)
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) onImport(file)
  }

  return (
    <section className="glass-panel mt-8 rounded-2xl p-5 sm:p-6">
      <h2 className="text-xl font-semibold text-white">Crear tablero</h2>
      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <label className="field-label">
          Nombre
          <input type="text" value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} required className="theme-input mt-1 w-full rounded-lg px-4 py-3" placeholder="Mi proyecto" />
        </label>
        <label className="field-label">
          Descripción
          <textarea value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} rows={3} className="theme-input mt-1 w-full resize-none rounded-lg px-4 py-3" placeholder="Descripción opcional..." />
        </label>
        <label className="field-label">
          Color
          <input type="color" value={values.color} onChange={(event) => setValues({ ...values, color: event.target.value })} className="theme-input mt-1 block h-10 w-16 cursor-pointer rounded" />
        </label>
        <button type="submit" disabled={creating} className="btn-mint-primary w-full px-5 py-3 font-semibold disabled:opacity-50 sm:w-auto">
          {creating ? 'Creando...' : 'Crear tablero'}
        </button>
      </form>
      <div className="mt-6 border-t border-white/5 pt-5">
        <p className="text-sm text-[var(--text-muted)]">También puedes crear un tablero completo desde una plantilla Excel.</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={onDownloadTemplate} className="btn-ghost px-4 py-2 text-sm">
            Descargar plantilla XLSX
          </button>
          <label className={`btn-action-secondary cursor-pointer border border-white/10 px-4 py-2 text-center text-sm ${importing ? 'opacity-60' : ''}`}>
            {importing ? 'Importando...' : 'Importar tablero XLSX'}
            <input type="file" accept=".xls,.xlsx" onChange={handleFile} disabled={importing} className="sr-only" />
          </label>
        </div>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Columnas: N° Tarea, Columna, Tarea, Descripción, Prioridad, Fecha inicio, Fecha fin y Predecesoras. La hoja «Instrucciones» explica cómo dar formato a descripciones largas. El archivo se valida completo antes de crear nada.
        </p>
      </div>
    </section>
  )
}

export default CreateBoardPanel

import { useState, type FormEvent } from 'react'

import Modal from '../ui/Modal'
import { blankTemplate, UML_CATEGORIES, UML_DIAGRAM_TYPES, umlDiagramType, type UmlSupport } from '../../domain/umlCatalog'
import { generatePlantUml } from '../../domain/uml/generatePlantUml'
import { initialModel } from '../../domain/uml/examples'
import { isVisualKind } from '../../domain/uml/visualModel'
import type { DiagramMode } from '../../services/diagrams'

export type NewDiagramValues = { name: string; kind: string; mode: DiagramMode; source: string; model?: unknown }

interface NewDiagramModalProps {
  onCreate: (values: NewDiagramValues) => Promise<string | null>
  onClose: () => void
}

const supportLabels: Record<UmlSupport, string> = {
  native: 'Nativo',
  adapted: 'Adaptado',
  unavailable: 'No disponible',
}

/** «Añadir diagrama»: tipo (por categorías), modo, nombre y plantilla inicial. */
function NewDiagramModal({ onCreate, onClose }: NewDiagramModalProps) {
  const [kind, setKind] = useState('class')
  const [name, setName] = useState('')
  const [withTemplate, setWithTemplate] = useState(true)
  // Los tipos con editor visual empiezan en modo visual; se puede elegir código.
  const [preferVisual, setPreferVisual] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selected = umlDiagramType(kind)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || selected.support === 'unavailable') return
    setSaving(true)
    const visual = preferVisual && isVisualKind(selected.id)
    const model = visual ? initialModel(selected.id, withTemplate) : undefined
    const saveError = await onCreate({
      name: name.trim() || selected.name,
      kind: selected.id,
      mode: visual ? 'visual' : 'code',
      source: model ? generatePlantUml(model) : withTemplate ? selected.template : blankTemplate(selected),
      model,
    })
    setSaving(false)
    if (saveError) setError(saveError)
  }

  return (
    <Modal
      title="Añadir diagrama"
      subtitle="Elige el tipo de diagrama. Queda asociado a este tablero."
      size="xl"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancelar</button>
          <button
            type="submit"
            form="new-diagram-form"
            disabled={saving || !selected || selected.support === 'unavailable'}
            className="btn-mint-primary px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Creando...' : 'Crear diagrama'}
          </button>
        </>
      }
    >
      <form id="new-diagram-form" onSubmit={handleSubmit} className="space-y-5">
        {UML_CATEGORIES.map((category) => (
          <fieldset key={category.id}>
            <legend className="text-sm font-semibold text-white">{category.name}</legend>
            <div className="uml-type-grid mt-2" role="radiogroup" aria-label={category.name}>
              {UML_DIAGRAM_TYPES.filter((type) => type.category === category.id).map((type) => (
                <button
                  key={type.id}
                  type="button"
                  role="radio"
                  aria-checked={kind === type.id}
                  disabled={type.support === 'unavailable'}
                  onClick={() => setKind(type.id)}
                  title={type.note}
                  className={`uml-type ${kind === type.id ? 'uml-type-active' : ''}`}
                >
                  <span className="uml-type-name">{type.name}</span>
                  <span className="uml-type-english">{type.english}</span>
                  <span className="uml-type-badges">
                    <span className={`uml-badge uml-badge-${type.support}`}>{supportLabels[type.support]}</span>
                    {isVisualKind(type.id) && <span className="uml-badge uml-badge-visual">✥ Visual</span>}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
        ))}

        {selected && (
          <div className="uml-selected">
            <p className="text-sm font-semibold text-white">{selected.name}</p>
            {selected.note && <p className="mt-1 text-xs text-[var(--text-muted)]">{selected.note}</p>}

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="field-label">
                Nombre
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={selected.name}
                  maxLength={120}
                  className="theme-input mt-1 w-full rounded-lg px-3 py-2"
                />
              </label>
              <div className="field-label">
                Modo de edición
                <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="Modo de edición">
                  {isVisualKind(selected.id) && (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={preferVisual}
                      onClick={() => setPreferVisual(true)}
                      className={`uml-mode ${preferVisual ? 'uml-mode-active' : ''}`}
                      title="Arrastrar y soltar; el PlantUML se genera solo"
                    >
                      ✥ Visual (arrastrar y soltar)
                    </button>
                  )}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!isVisualKind(selected.id) || !preferVisual}
                    onClick={() => setPreferVisual(false)}
                    className={`uml-mode ${!isVisualKind(selected.id) || !preferVisual ? 'uml-mode-active' : ''}`}
                  >
                    ⌨ Código (PlantUML)
                  </button>
                </div>
              </div>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm text-[var(--text-main)]">
              <input type="checkbox" checked={withTemplate} onChange={(event) => setWithTemplate(event.target.checked)} />
              Empezar con un ejemplo de este tipo de diagrama
            </label>
          </div>
        )}

        {error && <p className="alert-error rounded-lg p-3 text-sm" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}

export default NewDiagramModal

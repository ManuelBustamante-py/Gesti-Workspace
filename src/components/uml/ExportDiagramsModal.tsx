import { useState, type FormEvent } from 'react'

import Modal from '../ui/Modal'
import { buildDiagramTemplate, serializeTemplate, templateFileName } from '../../domain/uml/diagramTemplate'
import { umlDiagramType } from '../../domain/umlCatalog'
import { downloadJson } from '../../lib/diagramExport'
import { getArchitectureSettings } from '../../services/architectureSettings'
import { listDiagramsForAnalysis, type DiagramSummary } from '../../services/diagrams'

interface ExportDiagramsModalProps {
  board: { id: string; name: string; description: string | null }
  diagrams: DiagramSummary[]
  onClose: () => void
  onExported: (count: number) => void
}

/**
 * «Exportar»: descarga los diagramas elegidos como plantilla JSON, lista para
 * importarse en otro tablero (o en este mismo).
 */
function ExportDiagramsModal({ board, diagrams, onClose, onExported }: ExportDiagramsModalProps) {
  const [selected, setSelected] = useState(() => new Set(diagrams.map((diagram) => diagram.id)))
  const [includeSettings, setIncludeSettings] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const allSelected = selected.size === diagrams.length

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selected.size === 0) return
    setExporting(true)
    setError('')
    try {
      const [rows, stored] = await Promise.all([
        listDiagramsForAnalysis(board.id),
        includeSettings ? getArchitectureSettings(board.id) : Promise.resolve(null),
      ])
      // Se respeta el orden de la galería.
      const byId = new Map(rows.map((row) => [row.id, row]))
      const chosen = diagrams.flatMap((diagram) => {
        const row = selected.has(diagram.id) ? byId.get(diagram.id) : undefined
        return row ? [row] : []
      })
      if (chosen.length === 0) throw new Error('Los diagramas elegidos ya no existen. Recarga la página.')
      const template = buildDiagramTemplate({
        project: { name: board.name, description: board.description },
        diagrams: chosen,
        settings: stored?.settings ?? null,
      })
      downloadJson(serializeTemplate(template), templateFileName(board.name))
      onExported(chosen.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron exportar los diagramas.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Modal
      title="Exportar diagramas"
      subtitle="Se descarga una plantilla (.json) con el código y el diseño de cada diagrama. Puedes importarla en cualquier tablero."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancelar</button>
          <button
            type="submit"
            form="export-diagrams-form"
            disabled={exporting || selected.size === 0}
            className="btn-mint-primary px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {exporting ? 'Preparando…' : `Descargar plantilla (${selected.size})`}
          </button>
        </>
      }
    >
      <form id="export-diagrams-form" onSubmit={handleSubmit} className="space-y-4">
        <fieldset>
          <div className="flex items-center justify-between gap-3">
            <legend className="text-sm font-semibold text-white">Diagramas a incluir</legend>
            <button
              type="button"
              onClick={() => setSelected(allSelected ? new Set() : new Set(diagrams.map((diagram) => diagram.id)))}
              className="text-xs text-[var(--text-muted)] underline-offset-2 hover:text-white hover:underline"
            >
              {allSelected ? 'Quitar todos' : 'Seleccionar todos'}
            </button>
          </div>
          <ul className="diagram-transfer-list mt-2">
            {diagrams.map((diagram) => (
              <li key={diagram.id}>
                <label className="diagram-transfer-row">
                  <input type="checkbox" checked={selected.has(diagram.id)} onChange={() => toggle(diagram.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-white">{diagram.name}</span>
                    <span className="block text-xs text-[var(--text-muted)]">
                      {umlDiagramType(diagram.kind)?.name ?? diagram.kind} · {diagram.mode === 'visual' ? '✥ Visual' : '⌨ Código'}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <label className="flex items-start gap-2 text-sm text-[var(--text-main)]">
          <input type="checkbox" className="mt-1" checked={includeSettings} onChange={(event) => setIncludeSettings(event.target.checked)} />
          <span>
            Incluir la configuración de coherencia arquitectónica
            <span className="block text-xs text-[var(--text-muted)]">Estilo, reglas, equivalencias y excepciones del análisis de este tablero.</span>
          </span>
        </label>

        {error && <p className="alert-error rounded-lg p-3 text-sm" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}

export default ExportDiagramsModal

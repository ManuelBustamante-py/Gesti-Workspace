import { useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'

import Modal from '../ui/Modal'
import {
  exampleTemplate,
  MAX_DIAGRAM_NAME,
  MAX_TEMPLATE_BYTES,
  parseDiagramFile,
  serializeTemplate,
  TEMPLATE_ACCEPT,
  TEMPLATE_FILE_SUFFIX,
  uniqueDiagramName,
  type ImportCandidate,
  type ParsedImport,
} from '../../domain/uml/diagramTemplate'
import { UML_DIAGRAM_TYPES, umlDiagramType } from '../../domain/umlCatalog'
import { downloadJson } from '../../lib/diagramExport'
import { saveArchitectureSettings } from '../../services/architectureSettings'
import { createDiagrams, type Diagram } from '../../services/diagrams'

interface ImportDiagramsModalProps {
  boardId: string
  /** Nombres ya usados en el tablero: los importados no los repiten. */
  existingNames: string[]
  onClose: () => void
  /** `warnings`: avisos de la importación (p. ej. la configuración no se pudo guardar). */
  onImported: (created: Diagram[], warnings: string[]) => void
}

type Row = ImportCandidate & { key: number; include: boolean }

const AVAILABLE_TYPES = UML_DIAGRAM_TYPES.filter((type) => type.support !== 'unavailable')

/**
 * «Importar»: lee una plantilla exportada (.json) o un archivo PlantUML (.puml),
 * muestra lo que se va a crear y lo crea en el tablero.
 */
function ImportDiagramsModal({ boardId, existingNames, onClose, onImported }: ImportDiagramsModalProps) {
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [applySettings, setApplySettings] = useState(false)
  const [reading, setReading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const chosen = rows.filter((row) => row.include)

  async function readFile(file: File) {
    setError('')
    if (file.size > MAX_TEMPLATE_BYTES) {
      setError(`El archivo pesa más de ${MAX_TEMPLATE_BYTES / 1024 / 1024} MB.`)
      return
    }
    setReading(true)
    try {
      const result = parseDiagramFile(file.name, await file.text())
      if (result.diagrams.length === 0) {
        throw new Error(['El archivo no tiene diagramas que se puedan importar.', ...result.warnings].join('\n'))
      }
      setFileName(file.name)
      setParsed(result)
      setRows(result.diagrams.map((diagram, index) => ({ ...diagram, key: index, include: true })))
      // En un tablero sin diagramas la configuración de la plantilla se aplica por defecto.
      setApplySettings(result.settings !== null && existingNames.length === 0)
    } catch (err) {
      setParsed(null)
      setRows([])
      setError(err instanceof Error ? err.message : 'No se pudo leer el archivo.')
    } finally {
      setReading(false)
    }
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void readFile(file)
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) void readFile(file)
  }

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (chosen.length === 0) return
    setImporting(true)
    setError('')
    try {
      const taken = new Set(existingNames.map((name) => name.trim().toLocaleLowerCase('es')))
      const items = chosen.map((row) => ({
        name: uniqueDiagramName(row.name.trim() || umlDiagramType(row.kind)?.name || 'Diagrama', taken),
        kind: row.kind,
        mode: row.mode,
        source: row.source,
        model: row.model,
      }))
      const created = await createDiagrams(boardId, items)
      const warnings: string[] = []
      if (applySettings && parsed?.settings) {
        try {
          await saveArchitectureSettings(boardId, parsed.settings)
        } catch (err) {
          warnings.push(`Los diagramas se importaron, pero la configuración de coherencia no se guardó: ${err instanceof Error ? err.message : 'error desconocido'}`)
        }
      }
      onImported(created, warnings)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron importar los diagramas.')
      setImporting(false)
    }
  }

  return (
    <Modal
      title="Importar diagramas"
      subtitle="Desde una plantilla exportada de otro tablero (.json) o desde código PlantUML (.puml)."
      size="xl"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancelar</button>
          <button
            type="submit"
            form="import-diagrams-form"
            disabled={importing || reading || chosen.length === 0}
            className="btn-mint-primary px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {importing ? 'Importando…' : chosen.length > 0 ? `Importar ${chosen.length} diagrama${chosen.length === 1 ? '' : 's'}` : 'Importar'}
          </button>
        </>
      }
    >
      <form id="import-diagrams-form" onSubmit={handleSubmit} className="space-y-4">
        <label
          className={`diagram-dropzone ${dragging ? 'diagram-dropzone-active' : ''} ${reading ? 'opacity-60' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <span className="text-2xl" aria-hidden="true">⇪</span>
          <span className="text-sm font-semibold text-white">
            {reading ? 'Leyendo archivo…' : fileName ? `Archivo: ${fileName}` : 'Elige un archivo o arrástralo aquí'}
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            {fileName ? 'Haz clic para elegir otro.' : `Plantilla ${TEMPLATE_FILE_SUFFIX} o PlantUML .puml (hasta ${MAX_TEMPLATE_BYTES / 1024 / 1024} MB)`}
          </span>
          <input type="file" accept={TEMPLATE_ACCEPT} onChange={handleFile} disabled={reading || importing} className="sr-only" />
        </label>

        {!parsed && (
          <p className="text-xs text-[var(--text-muted)]">
            ¿Empiezas desde cero?{' '}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-white"
              onClick={() => downloadJson(serializeTemplate(exampleTemplate()), `plantilla-ejemplo${TEMPLATE_FILE_SUFFIX}`)}
            >
              Descarga una plantilla de ejemplo
            </button>{' '}
            con casos de uso, clases, secuencia y actividades, edítala y vuelve a importarla.
          </p>
        )}

        {parsed && (
          <>
            {parsed.projectName && (
              <p className="text-sm text-[var(--text-muted)]">
                Plantilla del proyecto <strong className="text-white">{parsed.projectName}</strong>.
              </p>
            )}

            <fieldset>
              <legend className="text-sm font-semibold text-white">Diagramas a crear</legend>
              <ul className="diagram-transfer-list mt-2">
                {rows.map((row) => (
                  <li key={row.key} className="diagram-transfer-row">
                    <input
                      type="checkbox"
                      checked={row.include}
                      onChange={(event) => updateRow(row.key, { include: event.target.checked })}
                      aria-label={`Importar «${row.name}»`}
                    />
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
                      <input
                        type="text"
                        value={row.name}
                        maxLength={MAX_DIAGRAM_NAME}
                        disabled={!row.include}
                        onChange={(event) => updateRow(row.key, { name: event.target.value })}
                        className="theme-input w-full rounded-lg px-3 py-1.5 text-sm"
                        aria-label="Nombre del diagrama"
                      />
                      {row.guessedKind ? (
                        <select
                          value={row.kind}
                          disabled={!row.include}
                          onChange={(event) => updateRow(row.key, { kind: event.target.value })}
                          className="theme-input w-full rounded-lg px-2 py-1.5 text-sm"
                          aria-label="Tipo de diagrama"
                          title="Tipo deducido del código: revísalo"
                        >
                          {AVAILABLE_TYPES.map((type) => (
                            <option key={type.id} value={type.id}>{type.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="self-center text-xs text-[var(--text-muted)]">
                          {umlDiagramType(row.kind)?.name ?? row.kind} · {row.mode === 'visual' ? '✥ Visual' : '⌨ Código'}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {rows.some((row) => row.guessedKind) && (
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  El tipo de los diagramas PlantUML se deduce de su código: revísalo antes de importar. Se importan en modo código.
                </p>
              )}
              <p className="mt-2 text-xs text-[var(--text-muted)]">Si un nombre ya existe en el tablero se le añade un número, por ejemplo «Clases (2)».</p>
            </fieldset>

            {parsed.settings && (
              <label className="flex items-start gap-2 text-sm text-[var(--text-main)]">
                <input type="checkbox" className="mt-1" checked={applySettings} onChange={(event) => setApplySettings(event.target.checked)} />
                <span>
                  Aplicar la configuración de coherencia arquitectónica de la plantilla
                  <span className="block text-xs text-[var(--text-muted)]">Reemplaza la configuración actual del análisis de este tablero.</span>
                </span>
              </label>
            )}

            {parsed.warnings.length > 0 && (
              <div className="alert-warning rounded-lg p-3 text-sm">
                <strong>Avisos de la plantilla:</strong>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {parsed.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            )}
          </>
        )}

        {error && <p className="alert-error whitespace-pre-line rounded-lg p-3 text-sm" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}

export default ImportDiagramsModal

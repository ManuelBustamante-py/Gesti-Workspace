import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'

import DiagramPreview, { type RenderState } from './DiagramPreview'
import { diagramFileName } from '../../domain/diagramSvg'
import { umlDiagramType } from '../../domain/umlCatalog'
import { downloadPlantUml, downloadPng, downloadSvg } from '../../lib/diagramExport'
import { deleteDiagram, updateDiagram, type Diagram } from '../../services/diagrams'

interface DiagramEditorProps {
  diagram: Diagram
  canEdit: boolean
  narrow: boolean
  onSaved: (diagram: Diagram) => void
  onDeleted: () => void
  onBack: () => void
}

const INDENT = '  '
const editedAt = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Editor de un diagrama en modo código: PlantUML a la izquierda, vista previa en vivo a la derecha. */
function DiagramEditor({ diagram, canEdit, narrow, onSaved, onDeleted, onBack }: DiagramEditorProps) {
  const [name, setName] = useState(diagram.name)
  const [source, setSource] = useState(diagram.source)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [render, setRender] = useState<RenderState>({ status: 'loading' })
  const [tab, setTab] = useState<'code' | 'preview'>('code')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  const type = umlDiagramType(diagram.kind)
  const dirty = name.trim() !== diagram.name || source !== diagram.source
  const errorLine = render.status === 'ready' ? render.error?.line ?? null : null
  const lineCount = source.split('\n').length

  const save = useCallback(async () => {
    if (!canEdit || !dirty || saving) return
    setSaving(true)
    setError('')
    try {
      const saved = await updateDiagram(
        diagram.id,
        { name: name.trim() !== diagram.name ? name : undefined, source: source !== diagram.source ? source : undefined },
        diagram.updated_at,
      )
      onSaved(saved)
      setNotice('Cambios guardados.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el diagrama.')
    } finally {
      setSaving(false)
    }
  }, [canEdit, diagram, dirty, name, onSaved, saving, source])

  // Ctrl/⌘ + S guarda; al salir con cambios sin guardar, el navegador pregunta.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      }
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [dirty, save])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 2500)
    return () => clearTimeout(timer)
  }, [notice])

  // Tab y Mayús+Tab indentan; Enter mantiene la sangría de la línea.
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const area = event.currentTarget
    const { selectionStart: start, selectionEnd: end, value } = area
    if (event.key === 'Tab') {
      event.preventDefault()
      const lineStart = value.lastIndexOf('\n', start - 1) + 1
      if (event.shiftKey) {
        if (value.startsWith(INDENT, lineStart)) {
          area.setRangeText('', lineStart, lineStart + INDENT.length, 'preserve')
          area.setSelectionRange(Math.max(lineStart, start - INDENT.length), Math.max(lineStart, end - INDENT.length))
        }
      } else {
        area.setRangeText(INDENT, start, end, 'end')
      }
      setSource(area.value)
    } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1
      const indent = /^[ \t]*/.exec(value.slice(lineStart, start))?.[0] ?? ''
      if (!indent) return
      event.preventDefault()
      area.setRangeText(`\n${indent}`, start, end, 'end')
      setSource(area.value)
    }
  }

  function goToLine(line: number) {
    const area = textareaRef.current
    if (!area) return
    const rows = area.value.split('\n')
    const offset = rows.slice(0, line - 1).reduce((total, row) => total + row.length + 1, 0)
    area.focus()
    area.setSelectionRange(offset, offset + (rows[line - 1]?.length ?? 0))
    setTab('code')
  }

  async function handleDelete() {
    if (!window.confirm(`¿Eliminar el diagrama «${diagram.name}»? Esta acción no se puede deshacer.`)) return
    try {
      await deleteDiagram(diagram.id)
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el diagrama.')
    }
  }

  function handleBack() {
    if (dirty && !window.confirm('Hay cambios sin guardar. ¿Salir sin guardar?')) return
    onBack()
  }

  async function exportAs(format: 'svg' | 'png' | 'puml') {
    setError('')
    try {
      if (format === 'puml') return downloadPlantUml(source, diagramFileName(name, 'puml'))
      if (render.status !== 'ready') throw new Error('Espera a que se dibuje el diagrama.')
      if (format === 'svg') downloadSvg(render.svg, diagramFileName(name, 'svg'))
      else await downloadPng(render.svg, diagramFileName(name, 'png'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo exportar el diagrama.')
    }
  }

  const code = (
    <div className="uml-code">
      <div ref={gutterRef} className="uml-gutter" aria-hidden="true">
        {Array.from({ length: lineCount }, (_, index) => (
          <span key={index} className={errorLine === index + 1 ? 'uml-gutter-error' : undefined}>{index + 1}</span>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        value={source}
        onChange={(event) => setSource(event.target.value)}
        onKeyDown={handleKeyDown}
        onScroll={(event) => {
          if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop
        }}
        readOnly={!canEdit}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        aria-label="Código PlantUML del diagrama"
        className="uml-textarea"
      />
    </div>
  )
  const preview = <DiagramPreview source={source} onRendered={setRender} />

  return (
    <div className="uml-editor">
      <div className="uml-editor-bar">
        <button type="button" onClick={handleBack} className="btn-ghost px-3 py-1.5 text-sm">← Diagramas</button>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          readOnly={!canEdit}
          maxLength={120}
          aria-label="Nombre del diagrama"
          className="theme-input min-w-0 flex-1 rounded-lg px-3 py-1.5 font-semibold"
        />
        <span className="uml-badge uml-badge-native" title={type?.english}>{type?.name ?? diagram.kind}</span>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void exportAs('svg')} className="btn-ghost px-3 py-1.5 text-sm">SVG</button>
          <button type="button" onClick={() => void exportAs('png')} className="btn-ghost px-3 py-1.5 text-sm">PNG</button>
          <button type="button" onClick={() => void exportAs('puml')} className="btn-ghost px-3 py-1.5 text-sm" title="Código fuente PlantUML">.puml</button>
          {canEdit && (
            <>
              <button type="button" onClick={() => void handleDelete()} className="btn-danger px-3 py-1.5 text-sm">Eliminar</button>
              <button type="button" onClick={() => void save()} disabled={!dirty || saving} className="btn-mint-primary px-4 py-1.5 text-sm font-semibold disabled:opacity-50" title="Ctrl + S">
                {saving ? 'Guardando…' : dirty ? 'Guardar' : 'Guardado'}
              </button>
            </>
          )}
        </div>
      </div>

      <p className="uml-editor-meta">
        {canEdit ? 'Escribe PlantUML; la vista previa se actualiza sola. Ctrl + S guarda.' : 'Solo lectura: tu rol en este tablero es de lector.'}
        {' '}Última edición: {editedAt.format(new Date(diagram.updated_at))}.
        {errorLine && (
          <button type="button" onClick={() => goToLine(errorLine)} className="ml-2 underline hover:text-white">Ir a la línea {errorLine}</button>
        )}
      </p>
      {error && <p className="alert-error mb-3 rounded-lg p-3 text-sm" role="alert">{error}</p>}
      {notice && <p className="mb-3 text-sm text-[var(--status-done)]" role="status">✓ {notice}</p>}

      {narrow ? (
        <>
          <div className="filter-chips mb-3" role="tablist" aria-label="Vista del editor">
            <button type="button" role="tab" aria-selected={tab === 'code'} onClick={() => setTab('code')} className={`filter-chip ${tab === 'code' ? 'filter-chip-active' : ''}`}>Código</button>
            <button type="button" role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')} className={`filter-chip ${tab === 'preview' ? 'filter-chip-active' : ''}`}>Vista previa</button>
          </div>
          {/* Ambos quedan montados: exportar usa siempre el último dibujo. */}
          <div hidden={tab !== 'code'}>{code}</div>
          <div hidden={tab !== 'preview'}>{preview}</div>
        </>
      ) : (
        <div className="uml-split">
          {code}
          {preview}
        </div>
      )}
    </div>
  )
}

export default DiagramEditor

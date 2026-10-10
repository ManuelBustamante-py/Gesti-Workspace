import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import DiagramPreview, { type RenderState } from './DiagramPreview'
import InterpretationPanel from './InterpretationPanel'
import WireframeView from './structured/WireframeView'
import type { LiveConnection } from './live'
import { explainRegex } from '../../domain/uml/interpretStructured'
import type { WireframeModel } from '../../domain/uml/structured'
import { diagramFileName } from '../../domain/diagramSvg'
import { umlDiagramType } from '../../domain/umlCatalog'
import { generatePlantUml } from '../../domain/uml/generatePlantUml'
import { interpretModel } from '../../domain/uml/interpret'
import { parsePlantUml } from '../../domain/uml/parsePlantUml'
import { isVisualKind, modelFromDiagram } from '../../domain/uml/visualModel'
import { canvasToSvg, downloadPlantUml, downloadPng, downloadSvg } from '../../lib/diagramExport'
import { deleteDiagram, updateDiagram, type Diagram } from '../../services/diagrams'

interface DiagramEditorProps {
  diagram: Diagram
  canEdit: boolean
  narrow: boolean
  onSaved: (diagram: Diagram) => void
  onDeleted: () => void
  onBack: () => void
  /** Colaboración en vivo: el texto se comparte (gana el último en escribir) y se ve quién está. */
  live?: LiveConnection
}

const INDENT = '  '
const editedAt = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Editor de un diagrama en modo código: PlantUML a la izquierda, vista previa en vivo a la derecha. */
function DiagramEditor({ diagram, canEdit, narrow, onSaved, onDeleted, onBack, live }: DiagramEditorProps) {
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
  const visualCapable = isVisualKind(diagram.kind)
  const dirty = name.trim() !== diagram.name || source !== diagram.source

  // Interpretación en vivo: el código se lee como modelo (si el tipo lo permite).
  const deferredSource = useDeferredValue(source)
  const parsed = useMemo(() => {
    if (!visualCapable) return null
    try {
      return parsePlantUml(deferredSource, diagram.kind, null)
    } catch {
      return null
    }
  }, [deferredSource, diagram.kind, visualCapable])
  const interpretation = useMemo(() => {
    if (diagram.kind === 'regex') return explainRegex(deferredSource)
    return parsed ? interpretModel(parsed.model) : null
  }, [deferredSource, diagram.kind, parsed])
  // El wireframe se dibuja con el renderizador propio (el motor no incluye Salt).
  const wireframe = diagram.kind === 'wireframe' && parsed ? (parsed.model as WireframeModel) : null
  const wireRef = useRef<SVGSVGElement | null>(null)

  // Colaboración en vivo: el texto propio se comparte; el ajeno se aplica si no estás escribiendo.
  const lastLocalEdit = useRef(0)
  const publishSource = live?.publishSource
  const changeSource = (value: string) => {
    lastLocalEdit.current = Date.now()
    setSource(value)
    publishSource?.(value)
  }
  const remoteSource = live?.remoteSource
  useEffect(() => {
    if (!remoteSource) return
    const apply = () => {
      if (lastLocalEdit.current > remoteSource.stamp) return
      setSource(remoteSource.source)
      setNotice(`${remoteSource.from} actualizó el código.`)
    }
    const wait = 1500 - (Date.now() - lastLocalEdit.current)
    if (wait <= 0) {
      apply()
      return
    }
    const timer = setTimeout(apply, wait)
    return () => clearTimeout(timer)
  }, [remoteSource])

  /**
   * Pasa al lienzo: el código se interpreta como modelo. Los elementos que ya
   * estaban en el lienzo antes conservan su posición; lo que el editor visual no
   * maneja se conserva como PlantUML adicional.
   */
  async function switchToVisual() {
    setError('')
    try {
      const previous = diagram.model ? modelFromDiagram(diagram.kind, diagram.model) : null
      const result = parsePlantUml(source, diagram.kind, previous)
      const notes = [
        ...result.warnings,
        ...(result.kept.length ? [`${result.kept.length} línea(s) que el lienzo no dibuja se conservan como PlantUML adicional (p. ej. «${result.kept[0]}»).`] : []),
      ]
      if (notes.length && !window.confirm(`Al pasar al lienzo:\n\n• ${notes.slice(0, 6).join('\n• ')}\n\n¿Continuar?`)) return
      const saved = await updateDiagram(
        diagram.id,
        { name: name.trim() !== diagram.name ? name : undefined, mode: 'visual', model: result.model, source: generatePlantUml(result.model) },
        diagram.updated_at,
      )
      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo pasar el diagrama al lienzo.')
    }
  }
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
      live?.publishSaved(saved)
      setNotice('Cambios guardados.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el diagrama.')
    } finally {
      setSaving(false)
    }
  }, [canEdit, diagram, dirty, live, name, onSaved, saving, source])

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
      changeSource(area.value)
    } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1
      const indent = /^[ \t]*/.exec(value.slice(lineStart, start))?.[0] ?? ''
      if (!indent) return
      event.preventDefault()
      area.setRangeText(`\n${indent}`, start, end, 'end')
      changeSource(area.value)
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
      let svg: string
      if (wireframe) {
        if (!wireRef.current) throw new Error('No se encontró la vista del wireframe.')
        svg = canvasToSvg(wireRef.current, null)
      } else {
        if (render.status !== 'ready') throw new Error('Espera a que se dibuje el diagrama.')
        svg = render.svg
      }
      if (format === 'svg') downloadSvg(svg, diagramFileName(name, 'svg'))
      else await downloadPng(svg, diagramFileName(name, 'png'))
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
        onChange={(event) => changeSource(event.target.value)}
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
  const preview = wireframe ? (
    <div className="uml-preview">
      <div className="uml-preview-bar"><span className="uml-preview-status text-[var(--text-muted)]">Wireframe dibujado por la plataforma (Salt)</span></div>
      <div className="uml-preview-canvas wire-canvas"><WireframeView model={wireframe} svgRef={wireRef} /></div>
    </div>
  ) : (
    <DiagramPreview source={source} onRendered={setRender} />
  )

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
        {canEdit && visualCapable && (
          <button type="button" onClick={() => void switchToVisual()} className="btn-ghost ml-3 px-3 py-1 text-xs" title="Convierte el código en el editor visual; puedes volver al código cuando quieras">
            ✥ Editar en modo visual
          </button>
        )}
        {live && live.peers.length > 0 && (
          <span className="uml-peers ml-3" title="Personas en este diagrama ahora">
            {live.peers.map((peer) => <span key={peer.key} className="uml-peer" style={{ borderColor: peer.color, color: peer.color }}>{peer.name}</span>)}
          </span>
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
      <InterpretationPanel
        interpretation={interpretation}
        unavailable={visualCapable || diagram.kind === 'regex' ? 'No se pudo leer el código para interpretarlo.' : 'Este tipo de diagrama no tiene interpretación automática.'}
      />
    </div>
  )
}

export default DiagramEditor

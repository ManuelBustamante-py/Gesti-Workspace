import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import DiagramPreview, { type RenderState } from '../DiagramPreview'
import InterpretationPanel from '../InterpretationPanel'
import GanttForm from './GanttForm'
import MindmapForm from './MindmapForm'
import NetworkForm from './NetworkForm'
import TimingForm from './TimingForm'
import WireframeForm from './WireframeForm'
import WireframeView from './WireframeView'
import type { FormProps } from './forms'
import { diagramFileName } from '../../../domain/diagramSvg'
import { umlDiagramType } from '../../../domain/umlCatalog'
import { generatePlantUml } from '../../../domain/uml/generatePlantUml'
import { interpretModel } from '../../../domain/uml/interpret'
import type { GanttModel, MindmapModel, NetworkModel, StructuredModel, TimingModel, WireframeModel } from '../../../domain/uml/structured'
import { modelFromDiagram } from '../../../domain/uml/visualModel'
import { useHistory } from '../../../hooks/useHistory'
import { canvasToSvg, downloadPlantUml, downloadPng, downloadSvg } from '../../../lib/diagramExport'
import { deleteDiagram, updateDiagram, type Diagram } from '../../../services/diagrams'
import { applyPatch } from '../../../domain/uml/liveSync'
import type { LiveConnection } from '../live'

interface StructuredEditorProps {
  diagram: Diagram
  canEdit: boolean
  narrow: boolean
  onSaved: (diagram: Diagram) => void
  onDeleted: () => void
  onBack: () => void
  live?: LiveConnection
}

const editedAt = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

/** Editor estructurado (formulario + vista previa) para mapa mental, Gantt, red, tiempos y wireframe. */
function StructuredEditor({ diagram, canEdit, narrow, onSaved, onDeleted, onBack, live }: StructuredEditorProps) {
  const savedModel = useMemo(() => modelFromDiagram(diagram.kind, diagram.model) as StructuredModel, [diagram])
  const savedJson = useMemo(() => JSON.stringify(savedModel), [savedModel])
  const history = useHistory<StructuredModel>(savedModel)
  const { state: model, set: setModel, undo, redo, checkpoint } = history
  const [name, setName] = useState(diagram.name)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [render, setRender] = useState<RenderState>({ status: 'loading' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const wireRef = useRef<SVGSVGElement | null>(null)

  const source = useMemo(() => generatePlantUml(model), [model])
  const interpretation = useMemo(() => interpretModel(model), [model])
  const dirty = name.trim() !== diagram.name || JSON.stringify(model) !== savedJson
  const type = umlDiagramType(diagram.kind)
  const readOnly = !canEdit

  const publishModel = live?.publishModel
  const change = useCallback((next: StructuredModel, record: boolean) => {
    setModel(next, record)
    publishModel?.(next)
  }, [publishModel, setModel])

  const remote = live?.remotePatch
  useEffect(() => {
    if (remote) setModel((current) => applyPatch(current, remote.patch) as StructuredModel, false)
  }, [remote, setModel])

  const setBaseline = live?.setBaseline
  useEffect(() => {
    setBaseline?.(savedModel)
  }, [savedModel, setBaseline])

  const save = useCallback(async () => {
    if (readOnly || !dirty || saving) return
    setSaving(true)
    setError('')
    try {
      const saved = await updateDiagram(diagram.id, { name: name.trim() !== diagram.name ? name : undefined, model, source }, diagram.updated_at)
      onSaved(saved)
      live?.publishSaved(saved)
      setNotice('Cambios guardados.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el diagrama.')
    } finally {
      setSaving(false)
    }
  }, [diagram, dirty, live, model, name, onSaved, readOnly, saving, source])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        void save()
      } else if (!readOnly && !isTyping(event.target) && (key === 'z' || key === 'y')) {
        event.preventDefault()
        if (key === 'y' || event.shiftKey) redo()
        else undo()
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
  }, [dirty, readOnly, redo, save, undo])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 2500)
    return () => clearTimeout(timer)
  }, [notice])

  async function switchToCode() {
    try {
      const saved = await updateDiagram(diagram.id, { name: name.trim() !== diagram.name ? name : undefined, mode: 'code', source, model }, diagram.updated_at)
      onSaved(saved)
      live?.publishSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar al modo código.')
    }
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
      if (model.kind === 'wireframe') {
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

  const formProps = { readOnly, onCheckpoint: checkpoint, selectedId, onSelect: setSelectedId }
  const form = (() => {
    switch (model.kind) {
      case 'mindmap': return <MindmapForm {...formProps} model={model} onChange={change as FormProps<MindmapModel>['onChange']} />
      case 'gantt': return <GanttForm {...formProps} model={model} onChange={change as FormProps<GanttModel>['onChange']} />
      case 'network': return <NetworkForm {...formProps} model={model} onChange={change as FormProps<NetworkModel>['onChange']} />
      case 'timing': return <TimingForm {...formProps} model={model} onChange={change as FormProps<TimingModel>['onChange']} />
      case 'wireframe': return <WireframeForm {...formProps} model={model} onChange={change as FormProps<WireframeModel>['onChange']} />
    }
  })()

  const preview = model.kind === 'wireframe' ? (
    <div className="uml-preview">
      <div className="uml-preview-bar"><span className="uml-preview-status text-[var(--text-muted)]">Vista del diseño · haz clic en un control para editarlo</span></div>
      <div className="uml-preview-canvas wire-canvas">
        <WireframeView model={model} selectedId={selectedId} onSelect={setSelectedId} svgRef={wireRef} />
      </div>
    </div>
  ) : (
    <DiagramPreview source={source} onRendered={setRender} />
  )

  return (
    <div className="uml-editor">
      <div className="uml-editor-bar">
        <button type="button" onClick={handleBack} className="btn-ghost px-3 py-1.5 text-sm">← Diagramas</button>
        <input type="text" value={name} onChange={(event) => setName(event.target.value)} readOnly={readOnly} maxLength={120} aria-label="Nombre del diagrama" className="theme-input min-w-0 flex-1 rounded-lg px-3 py-1.5 font-semibold" />
        <span className="uml-badge uml-badge-visual" title={type?.english}>✥ {type?.name ?? diagram.kind}</span>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void exportAs('svg')} className="btn-ghost px-3 py-1.5 text-sm">SVG</button>
          <button type="button" onClick={() => void exportAs('png')} className="btn-ghost px-3 py-1.5 text-sm">PNG</button>
          <button type="button" onClick={() => void exportAs('puml')} className="btn-ghost px-3 py-1.5 text-sm" title="PlantUML generado">.puml</button>
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

      <div className="uml-visual-toolbar">
        {canEdit && (
          <div className="flex items-center gap-1">
            <button type="button" onClick={undo} disabled={!history.canUndo} className="flow-zoom-button" aria-label="Deshacer" title="Deshacer (Ctrl + Z)">↶</button>
            <button type="button" onClick={redo} disabled={!history.canRedo} className="flow-zoom-button" aria-label="Rehacer" title="Rehacer (Ctrl + Y)">↷</button>
          </div>
        )}
        {canEdit && (
          <button type="button" onClick={() => void switchToCode()} className="btn-ghost px-3 py-1.5 text-sm" title="Editar escribiendo el código; puedes volver al editor cuando quieras">⌨ Editar como código</button>
        )}
        {live && live.peers.length > 0 && (
          <span className="uml-peers" title="Personas editando este diagrama ahora">
            {live.peers.map((peer) => <span key={peer.key} className="uml-peer" style={{ borderColor: peer.color, color: peer.color }}>{peer.name}</span>)}
          </span>
        )}
        <span className="uml-editor-meta m-0">{readOnly ? 'Solo lectura: tu rol en este tablero es de lector.' : `Última edición: ${editedAt.format(new Date(diagram.updated_at))}`}</span>
      </div>
      {error && <p className="alert-error mb-3 rounded-lg p-3 text-sm" role="alert">{error}</p>}
      {notice && <p className="mb-3 text-sm text-[var(--status-done)]" role="status">✓ {notice}</p>}

      <div className={narrow ? 'struct-layout struct-layout-narrow' : 'struct-layout'}>
        <div className="struct-panel">{form}</div>
        {preview}
      </div>

      <InterpretationPanel interpretation={interpretation} />
    </div>
  )
}

export default StructuredEditor

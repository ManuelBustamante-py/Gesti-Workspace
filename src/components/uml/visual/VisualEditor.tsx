import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import DiagramPreview from '../DiagramPreview'
import InterpretationPanel from '../InterpretationPanel'
import GraphCanvas, { NODE_DRAG_TYPE, type CanvasController, type Selection } from './GraphCanvas'
import PropertiesPanel from './PropertiesPanel'
import SequenceCanvas, { PARTICIPANT_DRAG_TYPE } from './SequenceCanvas'
import { diagramFileName } from '../../../domain/diagramSvg'
import { umlDiagramType } from '../../../domain/umlCatalog'
import { generatePlantUml } from '../../../domain/uml/generatePlantUml'
import { contentBounds, type Point } from '../../../domain/uml/geometry'
import { interpretModel } from '../../../domain/uml/interpret'
import { kindSpec } from '../../../domain/uml/kinds'
import { addNode, addParticipant } from '../../../domain/uml/modelOps'
import {
  MESSAGE_LABELS,
  PARTICIPANT_LABELS,
  modelFromDiagram,
  type GraphModel,
  type MessageType,
  type ParticipantType,
  type SequenceModel,
  type CanvasModel,
} from '../../../domain/uml/visualModel'
import { useHistory } from '../../../hooks/useHistory'
import { applyPatch } from '../../../domain/uml/liveSync'
import type { LiveConnection } from '../live'
import { canvasToSvg, downloadPlantUml, downloadPng, downloadSvg } from '../../../lib/diagramExport'
import { deleteDiagram, updateDiagram, type Diagram } from '../../../services/diagrams'

interface VisualEditorProps {
  diagram: Diagram
  canEdit: boolean
  narrow: boolean
  onSaved: (diagram: Diagram) => void
  onDeleted: () => void
  onBack: () => void
  /** Colaboración en vivo (opcional): cambios entrantes y salientes, y presencia. */
  live?: LiveConnection
}

const PARTICIPANT_ICONS: Record<ParticipantType, string> = {
  actor: '웃', participant: '▭', boundary: '⊢', control: '↻', entity: '◉', database: '⛁', collections: '⧉', queue: '⇶',
}
const SEQUENCE_ZOOMS = [0.5, 0.75, 1, 1.25, 1.5]
const editedAt = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

/** Editor de arrastrar y soltar para los diagramas de grafo y de secuencia. Genera el PlantUML. */
function VisualEditor({ diagram, canEdit, narrow, onSaved, onDeleted, onBack, live }: VisualEditorProps) {
  const savedModel = useMemo(() => modelFromDiagram(diagram.kind, diagram.model) as CanvasModel, [diagram])
  const savedJson = useMemo(() => JSON.stringify(savedModel), [savedModel])
  const history = useHistory<CanvasModel>(savedModel)
  const { state: model, set: setModel, undo, redo, checkpoint } = history
  const spec = model.kind === 'sequence' ? null : kindSpec(model.kind)
  const [name, setName] = useState(diagram.name)
  const [selection, setSelection] = useState<Selection>(null)
  const [edgeType, setEdgeType] = useState(spec?.defaultEdge ?? 'association')
  const [messageType, setMessageType] = useState<MessageType>('sync')
  const [sequenceZoom, setSequenceZoom] = useState(1)
  const [view, setView] = useState<'canvas' | 'plantuml'>('canvas')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const svgRef = useRef<SVGSVGElement | null>(null)
  const controllerRef = useRef<CanvasController | null>(null)

  const source = useMemo(() => generatePlantUml(model), [model])
  const interpretation = useMemo(() => interpretModel(model), [model])
  const empty = model.kind === 'sequence' ? (model as SequenceModel).participants.length === 0 : (model as GraphModel).nodes.length === 0
  const dirty = name.trim() !== diagram.name || JSON.stringify(model) !== savedJson
  const type = umlDiagramType(diagram.kind)
  const readOnly = !canEdit

  // Cambios propios: se aplican y se comparten con quienes están conectados.
  const publishModel = live?.publishModel
  const change = useCallback((next: CanvasModel, record: boolean) => {
    setModel(next, record)
    publishModel?.(next)
  }, [publishModel, setModel])

  // Cambios remotos (colaboración en vivo): se aplican sobre el estado propio, sin crear paso de deshacer.
  const remote = live?.remotePatch
  useEffect(() => {
    if (remote) setModel((current) => applyPatch(current, remote.patch) as CanvasModel, false)
  }, [remote, setModel])

  // Punto de partida común: los envíos son diferencias sobre lo guardado.
  const setBaseline = live?.setBaseline
  useEffect(() => {
    setBaseline?.(savedModel)
  }, [savedModel, setBaseline])

  const publishSelection = live?.publishSelection
  useEffect(() => {
    publishSelection?.(selection?.id ?? null)
  }, [publishSelection, selection])

  const save = useCallback(async () => {
    if (readOnly || !dirty || saving) return
    setSaving(true)
    setError('')
    try {
      const saved = await updateDiagram(
        diagram.id,
        { name: name.trim() !== diagram.name ? name : undefined, model, source },
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
  }, [diagram, dirty, live, model, name, onSaved, readOnly, saving, source])

  // Atajos: Ctrl+S guarda; Ctrl+Z / Ctrl+Y (o Ctrl+Mayús+Z) deshacen y rehacen fuera de los campos de texto.
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

  // Si se deshace hasta antes de crear lo seleccionado, la selección se descarta.
  const selectionExists =
    !selection ||
    (model.kind === 'sequence'
      ? [...(model as SequenceModel).participants, ...(model as SequenceModel).messages].some((item) => item.id === selection.id)
      : [...(model as GraphModel).nodes, ...(model as GraphModel).edges].some((item) => item.id === selection.id))
  const activeSelection = selectionExists ? selection : null

  function addGraphNode(nodeType: string, point?: Point) {
    if (model.kind === 'sequence') return
    // Con clic en la paleta se busca un hueco libre cerca del centro de la vista.
    const graph = model as GraphModel
    const result = point
      ? addNode(graph, nodeType, point)
      : addNode(graph, nodeType, controllerRef.current?.center() ?? { x: 300, y: 200 }, true)
    change(result.model, true)
    setSelection({ kind: 'node', id: result.id })
  }

  function addSequenceParticipant(participantType: ParticipantType, index?: number) {
    if (model.kind !== 'sequence') return
    const result = addParticipant(model as SequenceModel, participantType, index)
    change(result.model, true)
    setSelection({ kind: 'participant', id: result.id })
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

  /** Pasa a modo código conservando el modelo: al volver a visual se recuperan las posiciones. */
  async function switchToCode() {
    try {
      const saved = await updateDiagram(diagram.id, { name: name.trim() !== diagram.name ? name : undefined, mode: 'code', source, model }, diagram.updated_at)
      onSaved(saved)
      live?.publishSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar al modo código.')
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
      if (!svgRef.current || view !== 'canvas') throw new Error('Vuelve a la pestaña «Lienzo» para exportar la imagen.')
      const graph = model as GraphModel
      const svg = canvasToSvg(svgRef.current, model.kind === 'sequence' ? null : contentBounds(graph.kind, graph.nodes, graph.edges, 30))
      if (format === 'svg') downloadSvg(svg, diagramFileName(name, 'svg'))
      else await downloadPng(svg, diagramFileName(name, 'png'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo exportar el diagrama.')
    }
  }

  const palette = model.kind === 'sequence' ? (
    <div className="uml-palette">
      <p className="uml-palette-title">Participantes</p>
      <div className="uml-palette-items">
        {(Object.keys(PARTICIPANT_LABELS) as ParticipantType[]).map((participantType) => (
          <button
            key={participantType}
            type="button"
            disabled={readOnly}
            draggable={!readOnly}
            onDragStart={(event) => event.dataTransfer.setData(PARTICIPANT_DRAG_TYPE, participantType)}
            onClick={() => addSequenceParticipant(participantType)}
            className="uml-palette-item"
            title="Clic para agregar al final o arrástralo a su posición"
          >
            <span aria-hidden="true">{PARTICIPANT_ICONS[participantType]}</span> {PARTICIPANT_LABELS[participantType]}
          </button>
        ))}
      </div>
      <p className="uml-palette-title">Mensaje nuevo</p>
      <div className="uml-palette-items" role="radiogroup" aria-label="Tipo de mensaje nuevo">
        {(Object.keys(MESSAGE_LABELS) as MessageType[]).map((messageKind) => (
          <button key={messageKind} type="button" role="radio" aria-checked={messageType === messageKind} onClick={() => setMessageType(messageKind)} className={`uml-palette-item ${messageType === messageKind ? 'uml-palette-item-active' : ''}`}>
            {messageKind === 'sync' ? '→' : messageKind === 'async' ? '⇢' : '⇠'} {MESSAGE_LABELS[messageKind]}
          </button>
        ))}
      </div>
    </div>
  ) : (
    <div className="uml-palette">
      <p className="uml-palette-title">Elementos</p>
      <div className="uml-palette-items">
        {spec?.nodes.map((nodeSpecValue) => (
          <button
            key={nodeSpecValue.type}
            type="button"
            disabled={readOnly}
            draggable={!readOnly}
            onDragStart={(event) => event.dataTransfer.setData(NODE_DRAG_TYPE, nodeSpecValue.type)}
            onClick={() => addGraphNode(nodeSpecValue.type)}
            className="uml-palette-item"
            title="Clic para agregar o arrástralo al lienzo"
          >
            <span aria-hidden="true">{nodeSpecValue.icon}</span> {nodeSpecValue.label}
          </button>
        ))}
      </div>
      {(spec?.edges.length ?? 0) > 1 && (
        <>
          <p className="uml-palette-title">Relación al conectar</p>
          <div className="uml-palette-items" role="radiogroup" aria-label="Tipo de relación al conectar">
            {spec?.edges.map((edgeSpecValue) => (
              <button key={edgeSpecValue.type} type="button" role="radio" aria-checked={edgeType === edgeSpecValue.type} onClick={() => setEdgeType(edgeSpecValue.type)} className={`uml-palette-item ${edgeType === edgeSpecValue.type ? 'uml-palette-item-active' : ''}`}>
                {edgeSpecValue.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )

  const canvas = model.kind === 'sequence' ? (
    <div className="relative h-full">
      <SequenceCanvas
        model={model as SequenceModel}
        readOnly={readOnly}
        selection={activeSelection}
        messageType={messageType}
        zoom={sequenceZoom}
        svgRef={svgRef}
        onSelect={setSelection}
        onChange={change}
        onAddParticipant={(participantType, index) => addSequenceParticipant(participantType, index)}
      />
      <div className="uml-canvas-zoom" role="group" aria-label="Zoom del lienzo">
        <button type="button" className="flow-zoom-button" disabled={sequenceZoom <= SEQUENCE_ZOOMS[0]} onClick={() => setSequenceZoom((zoom) => [...SEQUENCE_ZOOMS].reverse().find((step) => step < zoom) ?? zoom)} aria-label="Alejar">−</button>
        <span className="uml-canvas-zoom-value">{Math.round(sequenceZoom * 100)}%</span>
        <button type="button" className="flow-zoom-button" disabled={sequenceZoom >= SEQUENCE_ZOOMS[SEQUENCE_ZOOMS.length - 1]} onClick={() => setSequenceZoom((zoom) => SEQUENCE_ZOOMS.find((step) => step > zoom) ?? zoom)} aria-label="Acercar">+</button>
      </div>
    </div>
  ) : (
    <GraphCanvas
      model={model as GraphModel}
      readOnly={readOnly}
      selection={activeSelection}
      edgeType={edgeType}
      svgRef={svgRef}
      controllerRef={controllerRef}
      onSelect={setSelection}
      onChange={change}
      onCheckpoint={checkpoint}
      onAddNode={addGraphNode}
      peers={live?.peers}
    />
  )

  return (
    <div className="uml-editor">
      <div className="uml-editor-bar">
        <button type="button" onClick={handleBack} className="btn-ghost px-3 py-1.5 text-sm">← Diagramas</button>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          readOnly={readOnly}
          maxLength={120}
          aria-label="Nombre del diagrama"
          className="theme-input min-w-0 flex-1 rounded-lg px-3 py-1.5 font-semibold"
        />
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
        <div className="filter-chips" role="tablist" aria-label="Vista del editor">
          <button type="button" role="tab" aria-selected={view === 'canvas'} onClick={() => setView('canvas')} className={`filter-chip ${view === 'canvas' ? 'filter-chip-active' : ''}`}>✥ Lienzo</button>
          <button type="button" role="tab" aria-selected={view === 'plantuml'} onClick={() => setView('plantuml')} className={`filter-chip ${view === 'plantuml' ? 'filter-chip-active' : ''}`}>⌨ PlantUML generado</button>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <button type="button" onClick={undo} disabled={!history.canUndo} className="flow-zoom-button" aria-label="Deshacer" title="Deshacer (Ctrl + Z)">↶</button>
            <button type="button" onClick={redo} disabled={!history.canRedo} className="flow-zoom-button" aria-label="Rehacer" title="Rehacer (Ctrl + Y)">↷</button>
          </div>
        )}
        {canEdit && (
          <button type="button" onClick={() => void switchToCode()} className="btn-ghost px-3 py-1.5 text-sm" title="Editar escribiendo PlantUML; puedes volver al lienzo cuando quieras">
            ⌨ Editar como código
          </button>
        )}
        {live && live.peers.length > 0 && (
          <span className="uml-peers" title="Personas editando este diagrama ahora">
            {live.peers.map((peer) => (
              <span key={peer.key} className="uml-peer" style={{ borderColor: peer.color, color: peer.color }}>{peer.name}</span>
            ))}
          </span>
        )}
        <span className="uml-editor-meta m-0">
          {readOnly ? 'Solo lectura: tu rol en este tablero es de lector.' : `Última edición: ${editedAt.format(new Date(diagram.updated_at))}`}
        </span>
      </div>
      {error && <p className="alert-error mb-3 rounded-lg p-3 text-sm" role="alert">{error}</p>}
      {notice && <p className="mb-3 text-sm text-[var(--status-done)]" role="status">✓ {notice}</p>}

      {view === 'canvas' ? (
        <div className={narrow ? 'uml-visual uml-visual-narrow' : 'uml-visual'}>
          {!readOnly && palette}
          <div className="uml-visual-canvas">{canvas}</div>
          <PropertiesPanel
            model={model}
            selection={activeSelection}
            readOnly={readOnly}
            onChange={change}
            onCheckpoint={checkpoint}
            onSelect={setSelection}
          />
        </div>
      ) : (
        <div className="uml-split">
          <div className="uml-generated">
            <pre className="uml-generated-code">{source}</pre>
            <div className="uml-generated-actions">
              <p>
                Este código se genera a partir del lienzo.{' '}
                {model.kind !== 'sequence' && (model as GraphModel).layout === 'canvas'
                  ? 'Las relaciones llevan pistas de dirección para que PlantUML se acerque a tu distribución.'
                  : 'PlantUML decide su propia distribución.'}
              </p>
            </div>
          </div>
          {empty ? (
            <div className="uml-preview"><p className="p-6 text-sm text-slate-500">Agrega elementos en el lienzo para ver el diagrama de PlantUML.</p></div>
          ) : (
            <DiagramPreview source={source} />
          )}
        </div>
      )}

      <InterpretationPanel interpretation={interpretation} />
    </div>
  )
}

export default VisualEditor

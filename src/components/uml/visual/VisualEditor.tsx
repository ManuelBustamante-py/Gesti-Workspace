import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import DiagramPreview from '../DiagramPreview'
import GraphCanvas, { NODE_DRAG_TYPE, type CanvasController, type Selection } from './GraphCanvas'
import PropertiesPanel from './PropertiesPanel'
import SequenceCanvas, { PARTICIPANT_DRAG_TYPE } from './SequenceCanvas'
import { diagramFileName } from '../../../domain/diagramSvg'
import { umlDiagramType } from '../../../domain/umlCatalog'
import { generatePlantUml } from '../../../domain/uml/generatePlantUml'
import { contentBounds, type Point } from '../../../domain/uml/geometry'
import { addNode, addParticipant } from '../../../domain/uml/modelOps'
import {
  EDGE_LABELS,
  MESSAGE_LABELS,
  NODE_LABELS,
  PALETTE,
  PARTICIPANT_LABELS,
  initialModel,
  isVisualKind,
  type EdgeType,
  type MessageType,
  type NodeType,
  type ParticipantType,
  type VisualModel,
} from '../../../domain/uml/visualModel'
import { useHistory } from '../../../hooks/useHistory'
import { canvasToSvg, downloadPlantUml, downloadPng, downloadSvg } from '../../../lib/diagramExport'
import { deleteDiagram, updateDiagram, type Diagram } from '../../../services/diagrams'

interface VisualEditorProps {
  diagram: Diagram
  canEdit: boolean
  narrow: boolean
  onSaved: (diagram: Diagram) => void
  onDeleted: () => void
  onBack: () => void
}

const NODE_ICONS: Record<NodeType, string> = {
  actor: '웃', usecase: '◯', boundary: '▭', class: '▤', abstract: '▤', interface: '◌', enum: '≡', package: '▱', note: '✎',
}
const PARTICIPANT_ICONS: Record<ParticipantType, string> = {
  actor: '웃', participant: '▭', boundary: '⊢', control: '↻', entity: '◉', database: '⛁',
}
const SEQUENCE_ZOOMS = [0.5, 0.75, 1, 1.25, 1.5]
const editedAt = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Modelo guardado, o uno vacío si no corresponde al tipo (datos dañados o de otra versión). */
function loadModel(diagram: Diagram): VisualModel {
  const raw = diagram.model as Partial<VisualModel> | null
  const kind = isVisualKind(diagram.kind) ? diagram.kind : 'class'
  if (raw && raw.kind === kind) {
    if (kind === 'sequence' && Array.isArray((raw as { participants?: unknown }).participants) && Array.isArray((raw as { messages?: unknown }).messages)) return raw as VisualModel
    if (kind !== 'sequence' && Array.isArray((raw as { nodes?: unknown }).nodes) && Array.isArray((raw as { edges?: unknown }).edges)) return raw as VisualModel
  }
  return initialModel(kind, false)
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

/** Editor de arrastrar y soltar para casos de uso, clases y secuencia. Genera el PlantUML. */
function VisualEditor({ diagram, canEdit, narrow, onSaved, onDeleted, onBack }: VisualEditorProps) {
  const savedModel = useMemo(() => loadModel(diagram), [diagram])
  const savedJson = useMemo(() => JSON.stringify(savedModel), [savedModel])
  const history = useHistory<VisualModel>(savedModel)
  const { state: model, set: setModel, undo, redo, checkpoint } = history
  const [name, setName] = useState(diagram.name)
  const [selection, setSelection] = useState<Selection>(null)
  const [edgeType, setEdgeType] = useState<EdgeType>('association')
  const [messageType, setMessageType] = useState<MessageType>('sync')
  const [sequenceZoom, setSequenceZoom] = useState(1)
  const [view, setView] = useState<'canvas' | 'plantuml'>('canvas')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const svgRef = useRef<SVGSVGElement | null>(null)
  const controllerRef = useRef<CanvasController | null>(null)

  const source = useMemo(() => generatePlantUml(model), [model])
  const empty = model.kind === 'sequence' ? model.participants.length === 0 : model.nodes.length === 0
  const dirty = name.trim() !== diagram.name || JSON.stringify(model) !== savedJson
  const type = umlDiagramType(diagram.kind)
  const readOnly = !canEdit

  const change = useCallback((next: VisualModel, record: boolean) => setModel(next, record), [setModel])

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
      setNotice('Cambios guardados.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el diagrama.')
    } finally {
      setSaving(false)
    }
  }, [diagram, dirty, model, name, onSaved, readOnly, saving, source])

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
      ? [...model.participants, ...model.messages].some((item) => item.id === selection.id)
      : [...model.nodes, ...model.edges].some((item) => item.id === selection.id))
  const activeSelection = selectionExists ? selection : null

  function addGraphNode(nodeType: NodeType, point?: Point) {
    if (model.kind === 'sequence') return
    // Con clic en la paleta se busca un hueco libre cerca del centro de la vista.
    const result = point
      ? addNode(model, nodeType, point)
      : addNode(model, nodeType, controllerRef.current?.center() ?? { x: 300, y: 200 }, true)
    change(result.model, true)
    setSelection({ kind: 'node', id: result.id })
  }

  function addSequenceParticipant(participantType: ParticipantType, index?: number) {
    if (model.kind !== 'sequence') return
    const result = addParticipant(model, participantType, index)
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

  async function convertToCode() {
    const message = dirty
      ? 'Se guardarán tus cambios y el diagrama pasará a modo código: desde ahí se edita escribiendo PlantUML y ya no con el lienzo. ¿Continuar?'
      : 'El diagrama pasará a modo código: desde ahí se edita escribiendo PlantUML y ya no con el lienzo. ¿Continuar?'
    if (!window.confirm(message)) return
    try {
      const saved = await updateDiagram(diagram.id, { name: name.trim() !== diagram.name ? name : undefined, mode: 'code', source, model: null }, diagram.updated_at)
      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo convertir el diagrama.')
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
      const svg = canvasToSvg(svgRef.current, model.kind === 'sequence' ? null : contentBounds(model.nodes, 30))
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
        {(Object.keys(MESSAGE_LABELS) as MessageType[]).map((type) => (
          <button key={type} type="button" role="radio" aria-checked={messageType === type} onClick={() => setMessageType(type)} className={`uml-palette-item ${messageType === type ? 'uml-palette-item-active' : ''}`}>
            {type === 'sync' ? '→' : type === 'async' ? '⇢' : '⇠'} {MESSAGE_LABELS[type]}
          </button>
        ))}
      </div>
    </div>
  ) : (
    <div className="uml-palette">
      <p className="uml-palette-title">Elementos</p>
      <div className="uml-palette-items">
        {PALETTE[model.kind].nodes.map((nodeType) => (
          <button
            key={nodeType}
            type="button"
            disabled={readOnly}
            draggable={!readOnly}
            onDragStart={(event) => event.dataTransfer.setData(NODE_DRAG_TYPE, nodeType)}
            onClick={() => addGraphNode(nodeType)}
            className="uml-palette-item"
            title="Clic para agregar o arrástralo al lienzo"
          >
            <span aria-hidden="true">{NODE_ICONS[nodeType]}</span> {NODE_LABELS[nodeType]}
          </button>
        ))}
      </div>
      <p className="uml-palette-title">Relación al conectar</p>
      <div className="uml-palette-items" role="radiogroup" aria-label="Tipo de relación al conectar">
        {PALETTE[model.kind].edges.map((type) => (
          <button key={type} type="button" role="radio" aria-checked={edgeType === type} onClick={() => setEdgeType(type)} className={`uml-palette-item ${edgeType === type ? 'uml-palette-item-active' : ''}`}>
            {EDGE_LABELS[type]}
          </button>
        ))}
      </div>
    </div>
  )

  const canvas = model.kind === 'sequence' ? (
    <div className="relative h-full">
      <SequenceCanvas
        model={model}
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
      model={model}
      readOnly={readOnly}
      selection={activeSelection}
      edgeType={edgeType}
      svgRef={svgRef}
      controllerRef={controllerRef}
      onSelect={setSelection}
      onChange={change}
      onCheckpoint={checkpoint}
      onAddNode={addGraphNode}
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
            {canEdit && (
              <div className="uml-generated-actions">
                <p>
                  Este código se genera solo a partir del lienzo; PlantUML decide su propia distribución. Para editarlo a mano, pasa el
                  diagrama a modo código (el lienzo deja de usarse).
                </p>
                <button type="button" onClick={() => void convertToCode()} className="btn-ghost px-3 py-1.5 text-sm">⌨ Pasar a modo código</button>
              </div>
            )}
          </div>
          {empty ? (
            <div className="uml-preview"><p className="p-6 text-sm text-slate-500">Agrega elementos en el lienzo para ver el diagrama de PlantUML.</p></div>
          ) : (
            <DiagramPreview source={source} />
          )}
        </div>
      )}
    </div>
  )
}

export default VisualEditor

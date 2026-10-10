import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react'

import { COLORS, EdgeShape, MarkerDefs, NodeShape, edgePath, parallelOffsets } from './shapes'
import { center, contentBounds, nodeRect, snap, type Point } from '../../../domain/uml/geometry'
import { addBend, addEdge, bendsWithin, deleteEdge, deleteNode, descendantsOf, moveBend, moveNodes, removeBend, updateNode } from '../../../domain/uml/modelOps'
import { isContainer, type GraphModel } from '../../../domain/uml/visualModel'

export type Selection = { kind: 'node' | 'edge' | 'participant' | 'message'; id: string } | null

export type CanvasController = { center: () => Point; fit: () => void }

export const NODE_DRAG_TYPE = 'application/x-uml-node'

type Viewport = { x: number; y: number; scale: number }

type Interaction =
  | { mode: 'pan'; start: Point; origin: Viewport }
  | { mode: 'drag'; start: Point; origins: Map<string, Point>; bends: Map<string, Point[]>; moved: boolean }
  | { mode: 'resize'; id: string; start: Point; width: number; height: number; moved: boolean }
  | { mode: 'connect'; source: string }
  | { mode: 'bend'; edgeId: string; index: number; moved: boolean }

export type Peer = { key: string; name: string; color: string; selection: string | null }

interface GraphCanvasProps {
  model: GraphModel
  readOnly: boolean
  selection: Selection
  edgeType: string
  svgRef: RefObject<SVGSVGElement | null>
  controllerRef: RefObject<CanvasController | null>
  onSelect: (selection: Selection) => void
  onChange: (model: GraphModel, record: boolean) => void
  onCheckpoint: () => void
  onAddNode: (type: string, point: Point) => void
  /** Otros usuarios conectados y lo que tienen seleccionado. */
  peers?: Peer[]
}

const MIN_SCALE = 0.25
const MAX_SCALE = 3

/** Lienzo de diagramas de grafo: mover, conectar, codos, redimensionar, desplazar y hacer zoom. */
function GraphCanvas({ model, readOnly, selection, edgeType, svgRef, controllerRef, onSelect, onChange, onCheckpoint, onAddNode, peers = [] }: GraphCanvasProps) {
  const prefix = `uml-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const kind = model.kind
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 40, y: 40, scale: 1 })
  const [connectLine, setConnectLine] = useState<{ from: Point; to: Point } | null>(null)
  const [selectedBend, setSelectedBend] = useState<{ edgeId: string; index: number } | null>(null)
  const interaction = useRef<Interaction | null>(null)
  // Valores al día para los manejadores registrados una sola vez.
  const latest = useRef({ model, viewport })
  useEffect(() => {
    latest.current = { model, viewport }
  })

  const nodesById = useMemo(() => new Map(model.nodes.map((node) => [node.id, node])), [model.nodes])
  // Contenedores grandes al fondo, luego relaciones y luego el resto de elementos.
  const containers = useMemo(
    () => model.nodes
      .filter((node) => isContainer(kind, node.type))
      .sort((a, b) => nodeRect(kind, b).width * nodeRect(kind, b).height - nodeRect(kind, a).width * nodeRect(kind, a).height),
    [kind, model.nodes],
  )
  const elements = model.nodes.filter((node) => !isContainer(kind, node.type))
  const offsets = useMemo(() => parallelOffsets(model.edges), [model.edges])

  const toWorld = (clientX: number, clientY: number, current = viewport): Point => {
    const bounds = wrapperRef.current?.getBoundingClientRect()
    return {
      x: (clientX - (bounds?.left ?? 0) - current.x) / current.scale,
      y: (clientY - (bounds?.top ?? 0) - current.y) / current.scale,
    }
  }

  const fit = () => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const { model: current } = latest.current
    const bounds = contentBounds(current.kind, current.nodes, current.edges)
    const scale = Math.max(MIN_SCALE, Math.min(1.25, wrapper.clientWidth / bounds.width, wrapper.clientHeight / bounds.height))
    setViewport({
      scale,
      x: (wrapper.clientWidth - bounds.width * scale) / 2 - bounds.x * scale,
      y: (wrapper.clientHeight - bounds.height * scale) / 2 - bounds.y * scale,
    })
  }

  useEffect(() => {
    controllerRef.current = {
      center: () => {
        const wrapper = wrapperRef.current
        const { viewport: current } = latest.current
        return {
          x: ((wrapper?.clientWidth ?? 800) / 2 - current.x) / current.scale,
          y: ((wrapper?.clientHeight ?? 500) / 2 - current.y) / current.scale,
        }
      },
      fit,
    }
  })

  // Al abrir, el diagrama se encuadra en el espacio disponible (fit lee el modelo desde `latest`).
  useEffect(() => {
    const frame = requestAnimationFrame(() => fit())
    return () => cancelAnimationFrame(frame)
  }, [])

  // Rueda: Ctrl/⌘ (o pellizco) hace zoom bajo el puntero; si no, desplaza el lienzo.
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const bounds = wrapper.getBoundingClientRect()
      setViewport((current) => {
        if (event.ctrlKey || event.metaKey) {
          const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * Math.exp(-event.deltaY * 0.0025)))
          const px = event.clientX - bounds.left
          const py = event.clientY - bounds.top
          return { scale, x: px - ((px - current.x) / current.scale) * scale, y: py - ((py - current.y) / current.scale) * scale }
        }
        const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX
        const dy = event.shiftKey ? 0 : event.deltaY
        return { ...current, x: current.x - dx, y: current.y - dy }
      })
    }
    wrapper.addEventListener('wheel', onWheel, { passive: false })
    return () => wrapper.removeEventListener('wheel', onWheel)
  }, [])

  const zoomBy = (factor: number) => {
    const wrapper = wrapperRef.current
    const px = (wrapper?.clientWidth ?? 800) / 2
    const py = (wrapper?.clientHeight ?? 500) / 2
    setViewport((current) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor))
      return { scale, x: px - ((px - current.x) / current.scale) * scale, y: py - ((py - current.y) / current.scale) * scale }
    })
  }

  function select(next: Selection) {
    setSelectedBend(null)
    onSelect(next)
  }

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    // El segundo clic de un doble clic lo maneja onDoubleClick.
    if (event.button !== 0 || event.detail > 1) return
    wrapperRef.current?.focus({ preventScroll: true })
    const target = event.target as Element
    const point = toWorld(event.clientX, event.clientY)
    const handle = target.closest('[data-handle]')
    const bend = target.closest('[data-bend]')
    const nodeElement = target.closest('[data-node-id]')
    const edgeElement = target.closest('[data-edge-id]')

    if (bend) {
      const edgeId = bend.getAttribute('data-for')!
      const index = Number(bend.getAttribute('data-bend'))
      setSelectedBend({ edgeId, index })
      if (!readOnly) interaction.current = { mode: 'bend', edgeId, index, moved: false }
    } else if (handle && !readOnly) {
      const id = handle.getAttribute('data-for')!
      const node = nodesById.get(id)
      if (!node) return
      if (handle.getAttribute('data-handle') === 'resize') {
        const rect = nodeRect(kind, node)
        interaction.current = { mode: 'resize', id, start: point, width: rect.width, height: rect.height, moved: false }
      } else {
        interaction.current = { mode: 'connect', source: id }
        setConnectLine({ from: center(nodeRect(kind, node)), to: point })
      }
    } else if (nodeElement) {
      const id = nodeElement.getAttribute('data-node-id')!
      select({ kind: 'node', id })
      if (!readOnly) {
        const node = nodesById.get(id)!
        const ids = isContainer(kind, node.type) ? [id, ...descendantsOf(model, id)] : [id]
        const origins = new Map(ids.map((nodeId) => {
          const item = nodesById.get(nodeId)!
          return [nodeId, { x: item.x, y: item.y }] as const
        }))
        interaction.current = { mode: 'drag', start: point, origins, bends: bendsWithin(model, new Set(ids)), moved: false }
      }
    } else if (edgeElement) {
      select({ kind: 'edge', id: edgeElement.getAttribute('data-edge-id')! })
    } else {
      select(null)
      interaction.current = { mode: 'pan', start: { x: event.clientX, y: event.clientY }, origin: viewport }
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Puntero ya liberado (o sintético): el arrastre sigue funcionando sin captura.
    }
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const current = interaction.current
    if (!current) return
    const point = toWorld(event.clientX, event.clientY)
    if (current.mode === 'pan') {
      setViewport({ ...current.origin, x: current.origin.x + event.clientX - current.start.x, y: current.origin.y + event.clientY - current.start.y })
    } else if (current.mode === 'drag') {
      const dx = point.x - current.start.x
      const dy = point.y - current.start.y
      if (!current.moved && Math.hypot(dx, dy) < 3) return
      // El paso de deshacer se crea al empezar a mover, no al hacer clic.
      if (!current.moved) onCheckpoint()
      current.moved = true
      onChange(moveNodes(model, current.origins, dx, dy, current.bends), false)
    } else if (current.mode === 'resize') {
      if (!current.moved) onCheckpoint()
      current.moved = true
      onChange(updateNode(model, current.id, {
        width: Math.max(160, snap(current.width + point.x - current.start.x)),
        height: Math.max(120, snap(current.height + point.y - current.start.y)),
      }), false)
    } else if (current.mode === 'bend') {
      if (!current.moved) onCheckpoint()
      current.moved = true
      onChange(moveBend(model, current.edgeId, current.index, point), false)
    } else if (current.mode === 'connect') {
      setConnectLine((line) => (line ? { ...line, to: point } : line))
    }
  }

  function handlePointerUp(event: PointerEvent<SVGSVGElement>) {
    const current = interaction.current
    interaction.current = null
    if (current?.mode === 'connect') {
      setConnectLine(null)
      // Se busca el elemento bajo el puntero (la línea temporal no recibe eventos).
      const targetId = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-node-id]')?.getAttribute('data-node-id')
      if (targetId) {
        const result = addEdge(model, edgeType, current.source, targetId)
        if (result.id) {
          onChange(result.model, true)
          select({ kind: 'edge', id: result.id })
        }
      }
    }
  }

  // Doble clic: sobre una relación agrega un codo; sobre un codo, lo quita.
  function handleDoubleClick(event: MouseEvent<SVGSVGElement>) {
    if (readOnly) return
    const target = event.target as Element
    const bend = target.closest('[data-bend]')
    if (bend) {
      onChange(removeBend(model, bend.getAttribute('data-for')!, Number(bend.getAttribute('data-bend'))), true)
      setSelectedBend(null)
      return
    }
    const edgeElement = target.closest('[data-edge-id]')
    if (edgeElement) {
      const edgeId = edgeElement.getAttribute('data-edge-id')!
      const result = addBend(model, edgeId, toWorld(event.clientX, event.clientY))
      if (result.index >= 0) {
        onChange(result.model, true)
        onSelect({ kind: 'edge', id: edgeId })
        setSelectedBend({ edgeId, index: result.index })
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!selection || readOnly) {
      if (event.key === 'Escape') select(null)
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      if (selectedBend) {
        onChange(removeBend(model, selectedBend.edgeId, selectedBend.index), true)
        setSelectedBend(null)
        return
      }
      onChange(selection.kind === 'node' ? deleteNode(model, selection.id) : deleteEdge(model, selection.id), true)
      select(null)
    } else if (event.key === 'Escape') {
      select(null)
    } else if (selection.kind === 'node' && event.key.startsWith('Arrow')) {
      event.preventDefault()
      const step = event.shiftKey ? 50 : 10
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
      const node = nodesById.get(selection.id)
      if (!node) return
      const ids = isContainer(kind, node.type) ? [node.id, ...descendantsOf(model, node.id)] : [node.id]
      const origins = new Map(ids.map((id) => [id, { x: nodesById.get(id)!.x, y: nodesById.get(id)!.y }] as const))
      onChange(moveNodes(model, origins, dx, dy, bendsWithin(model, new Set(ids))), true)
    }
  }

  const selectedNode = selection?.kind === 'node' ? nodesById.get(selection.id) : undefined
  const selectedEdge = selection?.kind === 'edge' ? model.edges.find((edge) => edge.id === selection.id) : undefined
  const selectedRect = selectedNode ? nodeRect(kind, selectedNode) : null
  const selectedEdgePath = selectedEdge ? edgePath(kind, selectedEdge, nodesById, offsets.get(selectedEdge.id)) : null

  return (
    <div
      ref={wrapperRef}
      className="uml-canvas"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onDragOver={(event) => {
        if (!readOnly && event.dataTransfer.types.includes(NODE_DRAG_TYPE)) event.preventDefault()
      }}
      onDrop={(event) => {
        const type = event.dataTransfer.getData(NODE_DRAG_TYPE)
        if (!type || readOnly) return
        event.preventDefault()
        onAddNode(type, toWorld(event.clientX, event.clientY))
      }}
      aria-label="Lienzo del diagrama. Arrastra elementos para moverlos; doble clic en una relación agrega un codo; Supr elimina la selección."
    >
      <svg
        ref={svgRef}
        className="uml-canvas-svg"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onPointerCancel={() => {
          interaction.current = null
          setConnectLine(null)
        }}
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
      >
        <MarkerDefs prefix={prefix} />
        <defs data-ui="1">
          <pattern id={`${prefix}-grid`} width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill={COLORS.grid} />
          </pattern>
        </defs>
        <g data-viewport="1" transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
          <rect data-ui="1" x={-10000} y={-10000} width={20000} height={20000} fill={`url(#${prefix}-grid)`} />

          {containers.map((node) => (
            <g key={node.id} data-node-id={node.id} className="uml-node">
              <NodeShape kind={kind} node={node} />
            </g>
          ))}
          {model.edges.map((edge) => {
            const geometry = edgePath(kind, edge, nodesById, offsets.get(edge.id))
            return (
              <g key={edge.id} data-edge-id={edge.id} className="uml-edge">
                <EdgeShape kind={kind} edge={edge} nodes={nodesById} prefix={prefix} offset={offsets.get(edge.id)} />
                {/* Zona de clic más gruesa que la línea. */}
                {geometry && <path data-ui="1" d={geometry.d} fill="none" stroke="transparent" strokeWidth={14} />}
              </g>
            )
          })}
          {elements.map((node) => (
            <g key={node.id} data-node-id={node.id} className="uml-node">
              <NodeShape kind={kind} node={node} />
            </g>
          ))}

          {/* Lo que tienen seleccionado otros colaboradores conectados. */}
          {peers.map((peer) => {
            const node = peer.selection ? nodesById.get(peer.selection) : undefined
            if (!node) return null
            const rect = nodeRect(kind, node)
            return (
              <g key={peer.key} data-ui="1" pointerEvents="none">
                <rect x={rect.x - 8} y={rect.y - 8} width={rect.width + 16} height={rect.height + 16} rx={7} fill="none" stroke={peer.color} strokeWidth={2} />
                <text x={rect.x - 6} y={rect.y - 12} fontSize={10.5} fontFamily="Inter, sans-serif" fill={peer.color} fontWeight={600}>{peer.name}</text>
              </g>
            )
          })}

          {selectedEdgePath && (
            <g data-ui="1">
              <path d={selectedEdgePath.d} fill="none" stroke={COLORS.accent} strokeWidth={3} strokeOpacity={0.55} pointerEvents="none" />
              {(selectedEdge?.points ?? []).map((point, index) => (
                <circle
                  key={index}
                  data-bend={index}
                  data-for={selectedEdge!.id}
                  className="uml-bend"
                  cx={point.x}
                  cy={point.y}
                  r={6}
                  fill={selectedBend?.edgeId === selectedEdge!.id && selectedBend.index === index ? COLORS.accent : COLORS.paper}
                  stroke={COLORS.accent}
                  strokeWidth={2}
                >
                  <title>Arrastra para mover el codo · doble clic o Supr para quitarlo</title>
                </circle>
              ))}
            </g>
          )}
          {selectedRect && selectedNode && (
            <g data-ui="1">
              <rect
                x={selectedRect.x - 5}
                y={selectedRect.y - 5}
                width={selectedRect.width + 10}
                height={selectedRect.height + 10}
                rx={6}
                fill="none"
                stroke={COLORS.accent}
                strokeWidth={1.5}
                strokeDasharray="5 3"
                pointerEvents="none"
              />
              {!readOnly && !isContainer(kind, selectedNode.type) && (
                <g data-handle="connect" data-for={selectedNode.id} className="uml-handle" transform={`translate(${selectedRect.x + selectedRect.width + 18} ${selectedRect.y + selectedRect.height / 2})`}>
                  <title>Arrastra hasta otro elemento para conectarlos</title>
                  <circle r={9} fill={COLORS.accent} />
                  <path d="M -4 0 H 4 M 0 -4 V 4" stroke="#fff" strokeWidth={2} />
                </g>
              )}
              {!readOnly && isContainer(kind, selectedNode.type) && (
                <rect
                  data-handle="resize"
                  data-for={selectedNode.id}
                  className="uml-handle-resize"
                  x={selectedRect.x + selectedRect.width - 6}
                  y={selectedRect.y + selectedRect.height - 6}
                  width={12}
                  height={12}
                  rx={2}
                  fill={COLORS.accent}
                >
                  <title>Arrastra para cambiar el tamaño</title>
                </rect>
              )}
            </g>
          )}
          {connectLine && (
            <line data-ui="1" x1={connectLine.from.x} y1={connectLine.from.y} x2={connectLine.to.x} y2={connectLine.to.y} stroke={COLORS.accent} strokeWidth={2} strokeDasharray="6 4" pointerEvents="none" />
          )}
        </g>
      </svg>

      <div className="uml-canvas-zoom" role="group" aria-label="Zoom del lienzo">
        <button type="button" className="flow-zoom-button" onClick={() => zoomBy(1 / 1.2)} aria-label="Alejar">−</button>
        <span className="uml-canvas-zoom-value">{Math.round(viewport.scale * 100)}%</span>
        <button type="button" className="flow-zoom-button" onClick={() => zoomBy(1.2)} aria-label="Acercar">+</button>
        <button type="button" className="flow-zoom-preset" onClick={fit} title="Encuadrar todo el diagrama">Ajustar</button>
      </div>
      {model.nodes.length === 0 && (
        <p className="uml-canvas-empty">Arrastra elementos desde la paleta o haz clic en ellos para empezar.</p>
      )}
    </div>
  )
}

export default GraphCanvas

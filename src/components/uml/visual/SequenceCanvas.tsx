import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'

import { COLORS, FONT } from './shapes'
import type { Selection } from './GraphCanvas'
import { addMessage, deleteParticipant, moveMessage, moveParticipant } from '../../../domain/uml/modelOps'
import type { MessageType, Participant, ParticipantType, SequenceModel } from '../../../domain/uml/visualModel'

export const PARTICIPANT_DRAG_TYPE = 'application/x-uml-participant'

const LEFT = 30
const COLUMN = 180
const HEADER_TOP = 16
const HEADER_HEIGHT = 66
const FIRST_MESSAGE = HEADER_TOP + HEADER_HEIGHT + 44
const ROW = 50

const columnX = (index: number) => LEFT + index * COLUMN + COLUMN / 2
const messageY = (index: number) => FIRST_MESSAGE + index * ROW

type Interaction =
  | { mode: 'message'; from: string; startY: number; startClient: Point }
  | { mode: 'participant'; id: string; startX: number }
  | { mode: 'reorder'; id: string; startY: number }

type Point = { x: number; y: number }

interface SequenceCanvasProps {
  model: SequenceModel
  readOnly: boolean
  selection: Selection
  messageType: MessageType
  zoom: number
  svgRef: RefObject<SVGSVGElement | null>
  onSelect: (selection: Selection) => void
  onChange: (model: SequenceModel, record: boolean) => void
  onAddParticipant: (type: ParticipantType, index: number) => void
}

function ParticipantIcon({ type, cx, cy }: { type: ParticipantType; cx: number; cy: number }) {
  const stroke = { stroke: COLORS.stroke, strokeWidth: 1.5, fill: COLORS.fill }
  switch (type) {
    case 'actor':
      return (
        <g {...stroke} fill="none">
          <circle cx={cx} cy={cy - 12} r={7} fill={COLORS.fill} />
          <path d={`M ${cx} ${cy - 5} V ${cy + 9} M ${cx - 11} ${cy} H ${cx + 11} M ${cx} ${cy + 9} L ${cx - 9} ${cy + 21} M ${cx} ${cy + 9} L ${cx + 9} ${cy + 21}`} />
        </g>
      )
    case 'boundary':
      return (
        <g {...stroke}>
          <path d={`M ${cx - 20} ${cy - 12} V ${cy + 12} M ${cx - 20} ${cy} H ${cx - 12}`} fill="none" />
          <circle cx={cx + 2} cy={cy} r={13} />
        </g>
      )
    case 'control':
      return (
        <g {...stroke}>
          <circle cx={cx} cy={cy + 2} r={13} />
          <path d={`M ${cx + 2} ${cy - 15} L ${cx - 4} ${cy - 11} L ${cx + 2} ${cy - 7}`} fill="none" />
        </g>
      )
    case 'entity':
      return (
        <g {...stroke}>
          <circle cx={cx} cy={cy - 2} r={13} />
          <line x1={cx - 15} y1={cy + 14} x2={cx + 15} y2={cy + 14} />
        </g>
      )
    case 'database':
      return (
        <g {...stroke}>
          <path d={`M ${cx - 14} ${cy - 12} V ${cy + 12} A 14 5 0 0 0 ${cx + 14} ${cy + 12} V ${cy - 12}`} />
          <ellipse cx={cx} cy={cy - 12} rx={14} ry={5} />
        </g>
      )
    case 'collections':
      return (
        <g {...stroke}>
          <rect x={cx - 12} y={cy - 16} width={26} height={22} />
          <rect x={cx - 16} y={cy - 12} width={26} height={22} />
        </g>
      )
    case 'queue':
      return (
        <g {...stroke}>
          <path d={`M ${cx - 16} ${cy - 10} H ${cx + 12} A 5 10 0 0 1 ${cx + 12} ${cy + 10} H ${cx - 16} A 5 10 0 0 1 ${cx - 16} ${cy - 10} Z`} />
          <path d={`M ${cx + 12} ${cy - 10} A 5 10 0 0 0 ${cx + 12} ${cy + 10}`} fill="none" />
        </g>
      )
    default:
      return null
  }
}

function ParticipantHeader({ participant, cx }: { participant: Participant; cx: number }) {
  const name = participant.name || ' '
  if (participant.type === 'participant') {
    const width = Math.min(COLUMN - 16, Math.max(90, name.length * 7.5 + 24))
    return (
      <g>
        <rect x={cx - width / 2} y={HEADER_TOP + 16} width={width} height={34} rx={4} fill={COLORS.header} stroke={COLORS.stroke} strokeWidth={1.5} />
        <text x={cx} y={HEADER_TOP + 37} fontSize={13} fontFamily={FONT} fill={COLORS.text} textAnchor="middle">{name}</text>
      </g>
    )
  }
  return (
    <g>
      <ParticipantIcon type={participant.type} cx={cx} cy={HEADER_TOP + 22} />
      <text x={cx} y={HEADER_TOP + 60} fontSize={13} fontFamily={FONT} fill={COLORS.text} textAnchor="middle">{name}</text>
    </g>
  )
}

/** Lienzo del diagrama de secuencia: participantes en columnas y mensajes en filas. */
function SequenceCanvas({ model, readOnly, selection, messageType, zoom, svgRef, onSelect, onChange, onAddParticipant }: SequenceCanvasProps) {
  const prefix = `seq-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const interaction = useRef<Interaction | null>(null)
  const [draft, setDraft] = useState<{ from: Point; to: Point } | null>(null)
  const [offset, setOffset] = useState<{ id: string; dx: number; dy: number } | null>(null)

  const index = new Map(model.participants.map((participant, position) => [participant.id, position]))
  const width = Math.max(640, LEFT * 2 + model.participants.length * COLUMN)
  const bottom = messageY(model.messages.length) + 10
  const height = bottom + 30

  const toLocal = (clientX: number, clientY: number): Point => {
    const bounds = svgRef.current?.getBoundingClientRect()
    return { x: (clientX - (bounds?.left ?? 0)) / zoom, y: (clientY - (bounds?.top ?? 0)) / zoom }
  }

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return
    ;(event.currentTarget.parentElement as HTMLElement | null)?.focus({ preventScroll: true })
    const target = event.target as Element
    const point = toLocal(event.clientX, event.clientY)
    const header = target.closest('[data-participant-id]')
    const message = target.closest('[data-message-id]')
    const lifeline = target.closest('[data-lifeline]')
    if (header) {
      const id = header.getAttribute('data-participant-id')!
      onSelect({ kind: 'participant', id })
      if (!readOnly) interaction.current = { mode: 'participant', id, startX: point.x }
    } else if (message) {
      const id = message.getAttribute('data-message-id')!
      onSelect({ kind: 'message', id })
      if (!readOnly) interaction.current = { mode: 'reorder', id, startY: point.y }
    } else if (lifeline && !readOnly) {
      const from = lifeline.getAttribute('data-lifeline')!
      interaction.current = { mode: 'message', from, startY: point.y, startClient: { x: event.clientX, y: event.clientY } }
      setDraft({ from: { x: columnX(index.get(from)!), y: point.y }, to: point })
    } else {
      onSelect(null)
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
    const point = toLocal(event.clientX, event.clientY)
    if (current.mode === 'message') setDraft((line) => (line ? { ...line, to: point } : line))
    else if (current.mode === 'participant') setOffset({ id: current.id, dx: point.x - current.startX, dy: 0 })
    else setOffset({ id: current.id, dx: 0, dy: point.y - current.startY })
  }

  function handlePointerUp(event: PointerEvent<SVGSVGElement>) {
    const current = interaction.current
    interaction.current = null
    setDraft(null)
    setOffset(null)
    if (!current) return
    const point = toLocal(event.clientX, event.clientY)

    if (current.mode === 'message') {
      // Un clic sin arrastrar no crea nada.
      if (Math.hypot(event.clientX - current.startClient.x, event.clientY - current.startClient.y) < 10) return
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-lifeline], [data-participant-id]')
      const to = target?.getAttribute('data-lifeline') ?? target?.getAttribute('data-participant-id')
      if (!to) return
      const position = Math.max(0, Math.min(model.messages.length, Math.ceil((current.startY - FIRST_MESSAGE) / ROW)))
      const result = addMessage(model, current.from, to, messageType, position)
      onChange(result.model, true)
      onSelect({ kind: 'message', id: result.id })
    } else if (current.mode === 'participant') {
      const from = index.get(current.id) ?? 0
      const to = Math.max(0, Math.min(model.participants.length - 1, Math.round((columnX(from) + point.x - current.startX - LEFT - COLUMN / 2) / COLUMN)))
      if (to !== from) onChange(moveParticipant(model, current.id, to), true)
    } else {
      const from = model.messages.findIndex((message) => message.id === current.id)
      const to = Math.max(0, Math.min(model.messages.length - 1, Math.round((messageY(from) + point.y - current.startY - FIRST_MESSAGE) / ROW)))
      if (to !== from) onChange(moveMessage(model, current.id, to), true)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!selection || readOnly) {
      if (event.key === 'Escape') onSelect(null)
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      onChange(
        selection.kind === 'participant'
          ? deleteParticipant(model, selection.id)
          : { ...model, messages: model.messages.filter((message) => message.id !== selection.id) },
        true,
      )
    } else if (event.key === 'Escape') {
      onSelect(null)
    } else if (selection.kind === 'message' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      const from = model.messages.findIndex((message) => message.id === selection.id)
      onChange(moveMessage(model, selection.id, from + (event.key === 'ArrowUp' ? -1 : 1)), true)
    } else if (selection.kind === 'participant' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      onChange(moveParticipant(model, selection.id, (index.get(selection.id) ?? 0) + (event.key === 'ArrowLeft' ? -1 : 1)), true)
    }
  }

  const markers = { sync: `url(#${prefix}-filled)`, async: `url(#${prefix}-open)`, reply: `url(#${prefix}-open)` }

  return (
    <div
      className="uml-canvas uml-canvas-scroll"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onDragOver={(event) => {
        if (!readOnly && event.dataTransfer.types.includes(PARTICIPANT_DRAG_TYPE)) event.preventDefault()
      }}
      onDrop={(event) => {
        const type = event.dataTransfer.getData(PARTICIPANT_DRAG_TYPE) as ParticipantType
        if (!type || readOnly) return
        event.preventDefault()
        const point = toLocal(event.clientX, event.clientY)
        onAddParticipant(type, Math.max(0, Math.round((point.x - LEFT) / COLUMN)))
      }}
      aria-label="Lienzo del diagrama de secuencia. Arrastra de una línea de vida a otra para crear un mensaje."
    >
      <svg
        ref={svgRef}
        width={width * zoom}
        height={height * zoom}
        viewBox={`0 0 ${width} ${height}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          interaction.current = null
          setDraft(null)
          setOffset(null)
        }}
        fontFamily={FONT}
        style={{ display: 'block' }}
      >
        <defs>
          <marker id={`${prefix}-filled`} viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M 1 1 L 11 6 L 1 11 Z" fill={COLORS.stroke} />
          </marker>
          <marker id={`${prefix}-open`} viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M 1 1 L 11 6 L 1 11" fill="none" stroke={COLORS.stroke} strokeWidth="1.5" />
          </marker>
        </defs>
        <rect width={width} height={height} fill={COLORS.paper} />

        {model.participants.map((participant, position) => {
          const cx = columnX(position)
          const shift = offset?.id === participant.id ? offset.dx : 0
          const selected = selection?.kind === 'participant' && selection.id === participant.id
          return (
            <g key={participant.id} transform={shift ? `translate(${shift} 0)` : undefined} opacity={shift ? 0.75 : 1}>
              <line x1={cx} y1={HEADER_TOP + HEADER_HEIGHT} x2={cx} y2={bottom} stroke={COLORS.muted} strokeWidth={1} strokeDasharray="5 4" />
              <rect data-ui="1" data-lifeline={participant.id} className="uml-lifeline" x={cx - 16} y={HEADER_TOP + HEADER_HEIGHT} width={32} height={bottom - HEADER_TOP - HEADER_HEIGHT} fill="transparent" />
              <g data-participant-id={participant.id} className="uml-node">
                <rect data-ui="1" x={cx - COLUMN / 2 + 8} y={HEADER_TOP} width={COLUMN - 16} height={HEADER_HEIGHT} fill="transparent" />
                <ParticipantHeader participant={participant} cx={cx} />
              </g>
              {selected && (
                <rect data-ui="1" x={cx - COLUMN / 2 + 6} y={HEADER_TOP - 4} width={COLUMN - 12} height={HEADER_HEIGHT + 6} rx={6} fill="none" stroke={COLORS.accent} strokeWidth={1.5} strokeDasharray="5 3" pointerEvents="none" />
              )}
            </g>
          )
        })}

        {model.messages.map((message, position) => {
          if (message.raw !== undefined) {
            // Fila de PlantUML libre (alt, else, loop, nota…): banda gris a lo ancho.
            const y = messageY(position)
            const shift = offset?.id === message.id ? offset.dy : 0
            const selected = selection?.kind === 'message' && selection.id === message.id
            const closing = /^(end|else)\b/.test(message.raw.trim())
            return (
              <g key={message.id} data-message-id={message.id} className="uml-edge" transform={shift ? `translate(0 ${shift})` : undefined}>
                <rect x={LEFT / 2} y={y - 15} width={width - LEFT} height={26} rx={4} fill={closing ? '#f0f3f4' : '#e8efee'} stroke={selected ? COLORS.accent : '#c9d4d6'} strokeWidth={selected ? 2 : 1} strokeDasharray={closing ? '4 3' : undefined} />
                <text x={LEFT / 2 + 10} y={y + 3} fontSize={11.5} fontFamily="ui-monospace, Consolas, monospace" fill={COLORS.muted}>{message.raw.trim() || '(fila vacía)'}</text>
              </g>
            )
          }
          const from = index.get(message.from)
          const to = index.get(message.to)
          if (from === undefined || to === undefined) return null
          const y = messageY(position)
          const x1 = columnX(from)
          const x2 = columnX(to)
          const self = from === to
          const d = self ? `M ${x1} ${y} H ${x1 + 44} V ${y + 20} H ${x1 + 2}` : `M ${x1} ${y} H ${x2 + (x2 > x1 ? -1 : 1)}`
          const text = `${model.autonumber ? `${position + 1}. ` : ''}${message.label}`
          const shift = offset?.id === message.id ? offset.dy : 0
          const selected = selection?.kind === 'message' && selection.id === message.id
          return (
            <g key={message.id} data-message-id={message.id} className="uml-edge" transform={shift ? `translate(0 ${shift})` : undefined}>
              {selected && <path data-ui="1" d={d} fill="none" stroke={COLORS.accent} strokeWidth={4} strokeOpacity={0.45} />}
              <path d={d} fill="none" stroke={COLORS.stroke} strokeWidth={1.5} strokeDasharray={message.type === 'reply' ? '6 4' : undefined} markerEnd={markers[message.type]} />
              <path data-ui="1" d={d} fill="none" stroke="transparent" strokeWidth={14} />
              {text.trim() && (
                <text
                  x={self ? x1 + 50 : (x1 + x2) / 2}
                  y={self ? y + 4 : y - 7}
                  fontSize={12}
                  fontFamily={FONT}
                  fill={COLORS.text}
                  textAnchor={self ? 'start' : 'middle'}
                  paintOrder="stroke"
                  stroke={COLORS.paper}
                  strokeWidth={4}
                  strokeLinejoin="round"
                >
                  {text}
                </text>
              )}
            </g>
          )
        })}

        {draft && (
          <line data-ui="1" x1={draft.from.x} y1={draft.from.y} x2={draft.to.x} y2={draft.to.y} stroke={COLORS.accent} strokeWidth={2} strokeDasharray="6 4" pointerEvents="none" />
        )}
      </svg>
      {model.participants.length === 0 && (
        <p className="uml-canvas-empty">Agrega participantes desde la paleta. Luego arrastra de una línea de vida a otra para crear mensajes.</p>
      )}
    </div>
  )
}

export default SequenceCanvas

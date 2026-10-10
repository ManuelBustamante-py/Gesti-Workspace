import {
  MEMBER_FONT,
  MEMBER_LINE,
  NAME_FONT,
  center,
  classHeaderHeight,
  compartmentHeight,
  edgeLine,
  isClassLike,
  nameLines,
  nodeRect,
  stereotypeOf,
  type Point,
} from '../../../domain/uml/geometry'
import type { EdgeType, GraphEdge, GraphNode } from '../../../domain/uml/visualModel'

/**
 * Figuras UML del lienzo. Los colores van como atributos (no clases CSS) para
 * que el SVG exportado se vea igual fuera de la plataforma.
 */
export const COLORS = {
  paper: '#ffffff',
  grid: '#e2e8ea',
  stroke: '#33434a',
  fill: '#f4f7f7',
  header: '#e3eeec',
  text: '#1d2a2f',
  muted: '#5c6b70',
  noteFill: '#fff6d5',
  noteStroke: '#c2aa4e',
  accent: '#1f9d8b',
}

export const FONT = 'Inter, ui-sans-serif, system-ui, sans-serif'

function TextLines({ lines, x, y, size, weight, anchor = 'middle', italic = false }: {
  lines: string[]; x: number; y: number; size: number; weight?: number; anchor?: 'start' | 'middle'; italic?: boolean
}) {
  return (
    <text x={x} y={y} fontSize={size} fontFamily={FONT} fill={COLORS.text} textAnchor={anchor} fontWeight={weight} fontStyle={italic ? 'italic' : undefined}>
      {lines.map((line, index) => (
        <tspan key={index} x={x} dy={index === 0 ? 0 : size + 4}>{line || ' '}</tspan>
      ))}
    </text>
  )
}

export function NodeShape({ node }: { node: GraphNode }) {
  const rect = nodeRect(node)
  const { x, y, width, height } = rect
  const lines = nameLines(node.name)
  const c = center(rect)

  switch (node.type) {
    case 'actor': {
      const cx = c.x
      return (
        <g stroke={COLORS.stroke} strokeWidth={1.5} fill="none">
          <circle cx={cx} cy={y + 12} r={10} fill={COLORS.fill} />
          <line x1={cx} y1={y + 22} x2={cx} y2={y + 44} />
          <line x1={cx - 16} y1={y + 30} x2={cx + 16} y2={y + 30} />
          <line x1={cx} y1={y + 44} x2={cx - 13} y2={y + 62} />
          <line x1={cx} y1={y + 44} x2={cx + 13} y2={y + 62} />
          <g stroke="none"><TextLines lines={lines} x={cx} y={y + 80} size={NAME_FONT} /></g>
        </g>
      )
    }
    case 'usecase':
      return (
        <g>
          <ellipse cx={c.x} cy={c.y} rx={width / 2} ry={height / 2} fill={COLORS.fill} stroke={COLORS.stroke} strokeWidth={1.5} />
          {node.stereotype && (
            <TextLines lines={[`«${node.stereotype}»`]} x={c.x} y={c.y - (lines.length * 17) / 2 - 2} size={10} italic />
          )}
          <TextLines lines={lines} x={c.x} y={c.y - ((lines.length - 1) * 17) / 2 + 4} size={NAME_FONT} />
        </g>
      )
    case 'boundary':
      return (
        <g>
          <rect x={x} y={y} width={width} height={height} rx={4} fill="rgba(244,247,247,0.45)" stroke={COLORS.stroke} strokeWidth={1.5} />
          <TextLines lines={lines} x={c.x} y={y + 22} size={NAME_FONT} weight={600} />
        </g>
      )
    case 'package': {
      const tab = Math.min(width - 20, Math.max(80, lines[0].length * 8 + 24))
      return (
        <g>
          <path d={`M ${x} ${y + 24} V ${y} H ${x + tab} V ${y + 24}`} fill={COLORS.header} stroke={COLORS.stroke} strokeWidth={1.5} />
          <rect x={x} y={y + 24} width={width} height={height - 24} fill="rgba(244,247,247,0.45)" stroke={COLORS.stroke} strokeWidth={1.5} />
          <TextLines lines={[lines[0]]} x={x + 10} y={y + 17} size={12} weight={600} anchor="start" />
        </g>
      )
    }
    case 'note':
      return (
        <g>
          <path
            d={`M ${x} ${y} H ${x + width - 12} L ${x + width} ${y + 12} V ${y + height} H ${x} Z M ${x + width - 12} ${y} V ${y + 12} H ${x + width}`}
            fill={COLORS.noteFill}
            stroke={COLORS.noteStroke}
            strokeWidth={1.2}
          />
          <TextLines lines={lines} x={x + 12} y={y + 22} size={MEMBER_FONT} anchor="start" />
        </g>
      )
    default: {
      if (!isClassLike(node)) return null
      const stereotype = stereotypeOf(node)
      const header = classHeaderHeight(node)
      const attributesTop = y + header
      const methodsTop = attributesTop + compartmentHeight(node.attributes)
      const members = (items: string[] | undefined, top: number) =>
        (items ?? []).map((line, index) => (
          <text key={index} x={x + 10} y={top + 16 + index * MEMBER_LINE} fontSize={MEMBER_FONT} fontFamily={FONT} fill={COLORS.text}>
            {line}
          </text>
        ))
      return (
        <g>
          <rect x={x} y={y} width={width} height={height} rx={3} fill={COLORS.fill} stroke={COLORS.stroke} strokeWidth={1.5} />
          <rect x={x + 0.75} y={y + 0.75} width={width - 1.5} height={header - 0.75} rx={2.5} fill={COLORS.header} />
          {stereotype && <TextLines lines={[`«${stereotype}»`]} x={c.x} y={y + 15} size={10.5} italic />}
          <TextLines
            lines={lines}
            x={c.x}
            y={y + (stereotype ? 32 : 20)}
            size={NAME_FONT}
            weight={700}
            italic={node.type === 'abstract'}
          />
          <line x1={x} y1={attributesTop} x2={x + width} y2={attributesTop} stroke={COLORS.stroke} strokeWidth={1} />
          {members(node.attributes, attributesTop)}
          {node.type !== 'enum' && (
            <>
              <line x1={x} y1={methodsTop} x2={x + width} y2={methodsTop} stroke={COLORS.stroke} strokeWidth={1} />
              {members(node.methods, methodsTop)}
            </>
          )}
        </g>
      )
    }
  }
}

/** Marcadores de las puntas; `prefix` los hace únicos por lienzo. */
export function MarkerDefs({ prefix }: { prefix: string }) {
  const common = { markerUnits: 'userSpaceOnUse' as const, orient: 'auto' as const }
  return (
    <defs>
      <marker id={`${prefix}-open`} viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" {...common}>
        <path d="M 1 1 L 11 6 L 1 11" fill="none" stroke={COLORS.stroke} strokeWidth="1.5" />
      </marker>
      <marker id={`${prefix}-triangle`} viewBox="0 0 16 16" refX="15" refY="8" markerWidth="16" markerHeight="16" {...common}>
        <path d="M 1 1 L 15 8 L 1 15 Z" fill={COLORS.paper} stroke={COLORS.stroke} strokeWidth="1.5" />
      </marker>
      <marker id={`${prefix}-diamond`} viewBox="0 0 20 12" refX="1" refY="6" markerWidth="20" markerHeight="12" {...common}>
        <path d="M 1 6 L 10 1 L 19 6 L 10 11 Z" fill={COLORS.paper} stroke={COLORS.stroke} strokeWidth="1.5" />
      </marker>
      <marker id={`${prefix}-diamond-filled`} viewBox="0 0 20 12" refX="1" refY="6" markerWidth="20" markerHeight="12" {...common}>
        <path d="M 1 6 L 10 1 L 19 6 L 10 11 Z" fill={COLORS.stroke} stroke={COLORS.stroke} strokeWidth="1.5" />
      </marker>
    </defs>
  )
}

const DASHED: EdgeType[] = ['include', 'extend', 'realization', 'dependency', 'note-link']

function edgeMarkers(type: EdgeType, prefix: string) {
  const url = (name: string) => `url(#${prefix}-${name})`
  switch (type) {
    case 'directed':
    case 'include':
    case 'extend':
    case 'dependency':
      return { end: url('open') }
    case 'generalization':
    case 'realization':
      return { end: url('triangle') }
    case 'aggregation':
      return { start: url('diamond') }
    case 'composition':
      return { start: url('diamond-filled') }
    default:
      return {}
  }
}

/** Punto a `distance` del inicio hacia el fin, desplazado `side` px en perpendicular. */
function along(start: Point, end: Point, distance: number, side: number): Point {
  const length = Math.hypot(end.x - start.x, end.y - start.y) || 1
  const ux = (end.x - start.x) / length
  const uy = (end.y - start.y) / length
  return { x: start.x + ux * distance - uy * side, y: start.y + uy * distance + ux * side }
}

/**
 * Separación de las relaciones paralelas (mismo par de elementos): cada una se
 * desplaza en perpendicular para que no se dibujen una encima de otra.
 */
export function parallelOffsets(edges: GraphEdge[], gap = 14): Map<string, number> {
  const groups = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.source === edge.target) continue
    const key = [edge.source, edge.target].sort().join('|')
    groups.set(key, [...(groups.get(key) ?? []), edge.id])
  }
  const offsets = new Map<string, number>()
  for (const ids of groups.values()) {
    ids.forEach((id, index) => offsets.set(id, (index - (ids.length - 1) / 2) * gap))
  }
  return offsets
}

/** Geometría de una relación: recta entre bordes (desplazada si es paralela) o bucle si es recursiva. */
export function edgePath(edge: GraphEdge, nodes: Map<string, GraphNode>, offset = 0) {
  const source = nodes.get(edge.source)
  const target = nodes.get(edge.target)
  if (!source || !target) return null
  if (source.id === target.id) {
    const rect = nodeRect(source)
    const start = { x: rect.x + rect.width - 28, y: rect.y }
    const end = { x: rect.x + rect.width, y: rect.y + 24 }
    return {
      d: `M ${start.x} ${start.y} C ${start.x} ${start.y - 46}, ${end.x + 46} ${end.y}, ${end.x} ${end.y}`,
      start,
      end,
      middle: { x: rect.x + rect.width + 14, y: rect.y - 22 },
    }
  }
  const line = edgeLine(source, target)
  // El desplazamiento se mide siempre en el mismo sentido (de id menor a mayor),
  // así dos relaciones opuestas entre el mismo par también se separan.
  const forward = source.id < target.id ? 1 : -1
  const length = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y) || 1
  const nx = (-(line.end.y - line.start.y) / length) * offset * forward
  const ny = ((line.end.x - line.start.x) / length) * offset * forward
  const start = { x: line.start.x + nx, y: line.start.y + ny }
  const end = { x: line.end.x + nx, y: line.end.y + ny }
  return { d: `M ${start.x} ${start.y} L ${end.x} ${end.y}`, start, end, middle: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } }
}

function EdgeText({ point, text, anchor = 'middle' }: { point: Point; text: string; anchor?: 'middle' | 'start' }) {
  return (
    <text x={point.x} y={point.y} fontSize={11} fontFamily={FONT} fill={COLORS.text} textAnchor={anchor} paintOrder="stroke" stroke={COLORS.paper} strokeWidth={4} strokeLinejoin="round">
      {text}
    </text>
  )
}

export function EdgeShape({ edge, nodes, prefix, offset = 0 }: { edge: GraphEdge; nodes: Map<string, GraphNode>; prefix: string; offset?: number }) {
  const path = edgePath(edge, nodes, offset)
  if (!path) return null
  const markers = edgeMarkers(edge.type, prefix)
  const text = edge.type === 'include' ? '«include»' : edge.type === 'extend' ? '«extend»' : edge.label?.trim() ?? ''
  return (
    <g>
      <path
        d={path.d}
        fill="none"
        stroke={edge.type === 'note-link' ? COLORS.noteStroke : COLORS.stroke}
        strokeWidth={1.5}
        strokeDasharray={DASHED.includes(edge.type) ? '6 4' : undefined}
        markerStart={markers.start}
        markerEnd={markers.end}
      />
      {text && <EdgeText point={{ x: path.middle.x, y: path.middle.y - 6 }} text={text} />}
      {edge.sourceLabel?.trim() && <EdgeText point={along(path.start, path.end, 22, -10)} text={edge.sourceLabel.trim()} />}
      {edge.targetLabel?.trim() && <EdgeText point={along(path.end, path.start, 22, 10)} text={edge.targetLabel.trim()} />}
    </g>
  )
}

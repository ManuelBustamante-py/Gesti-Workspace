import {
  MEMBER_FONT,
  MEMBER_LINE,
  NAME_FONT,
  center,
  classHeaderHeight,
  compartmentHeight,
  edgeRoute,
  nameLines,
  nodeRect,
  stereotypeOf,
  type Point,
} from '../../../domain/uml/geometry'
import { edgeSpec, nodeSpec, type EdgeSpec } from '../../../domain/uml/kinds'
import type { GraphEdge, GraphNode } from '../../../domain/uml/visualModel'

/**
 * Figuras del lienzo. Los colores van como atributos (no clases CSS) para que
 * el SVG exportado se vea igual fuera de la plataforma.
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

function TextLines({ lines, x, y, size, weight, anchor = 'middle', italic = false, fill = COLORS.text }: {
  lines: string[]; x: number; y: number; size: number; weight?: number; anchor?: 'start' | 'middle'; italic?: boolean; fill?: string
}) {
  return (
    <text x={x} y={y} fontSize={size} fontFamily={FONT} fill={fill} textAnchor={anchor} fontWeight={weight} fontStyle={italic ? 'italic' : undefined}>
      {lines.map((line, index) => (
        <tspan key={index} x={x} dy={index === 0 ? 0 : size + 4}>{line || ' '}</tspan>
      ))}
    </text>
  )
}

/** Nombre (y estereotipo encima) centrado en un punto. */
function CenteredLabel({ node, badge, cx, cy, bold = false }: { node: GraphNode; badge: string | null; cx: number; cy: number; bold?: boolean }) {
  const lines = nameLines(node.name)
  const top = cy - ((lines.length - 1) * 17) / 2 + 4 + (badge ? 7 : 0)
  return (
    <>
      {badge && <TextLines lines={[`«${badge}»`]} x={cx} y={top - 17} size={10.5} italic fill={COLORS.muted} />}
      <TextLines lines={lines} x={cx} y={top} size={NAME_FONT} weight={bold ? 600 : undefined} />
    </>
  )
}

const stroke = { stroke: COLORS.stroke, strokeWidth: 1.5 }

export function NodeShape({ kind, node }: { kind: string; node: GraphNode }) {
  const spec = nodeSpec(kind, node.type)
  const rect = nodeRect(kind, node)
  const { x, y, width, height } = rect
  const c = center(rect)
  const badge = stereotypeOf(node, spec)
  const fill = spec.color ?? COLORS.fill

  switch (spec.shape) {
    case 'actor':
      return (
        <g>
          <g {...stroke} fill="none">
            <circle cx={c.x} cy={y + 12} r={10} fill={COLORS.fill} />
            <path d={`M ${c.x} ${y + 22} V ${y + 44} M ${c.x - 16} ${y + 30} H ${c.x + 16} M ${c.x} ${y + 44} L ${c.x - 13} ${y + 62} M ${c.x} ${y + 44} L ${c.x + 13} ${y + 62}`} />
          </g>
          {badge && <TextLines lines={[`«${badge}»`]} x={c.x} y={y + 79} size={10.5} italic fill={COLORS.muted} />}
          <TextLines lines={nameLines(node.name)} x={c.x} y={y + (badge ? 95 : 80)} size={NAME_FONT} />
        </g>
      )
    case 'ellipse':
      return (
        <g>
          <ellipse cx={c.x} cy={c.y} rx={width / 2} ry={height / 2} fill={fill} {...stroke} />
          <CenteredLabel node={node} badge={badge} cx={c.x} cy={c.y} />
        </g>
      )
    case 'round':
    case 'rect':
    case 'archimate':
      return (
        <g>
          <rect x={x} y={y} width={width} height={height} rx={spec.shape === 'round' ? 14 : spec.shape === 'archimate' ? 6 : 3} fill={fill} {...stroke} />
          {spec.shape === 'archimate' && <TextLines lines={[spec.icon]} x={x + width - 12} y={y + 15} size={10} weight={700} fill={COLORS.muted} />}
          <CenteredLabel node={node} badge={spec.shape === 'archimate' ? node.stereotype?.trim() || null : badge} cx={c.x} cy={c.y} />
        </g>
      )
    case 'component':
      return (
        <g>
          <rect x={x} y={y} width={width} height={height} rx={3} fill={fill} {...stroke} />
          <g {...stroke} strokeWidth={1.2} fill={COLORS.paper}>
            <rect x={x + width - 22} y={y + 7} width={14} height={16} />
            <rect x={x + width - 26} y={y + 10} width={8} height={4} />
            <rect x={x + width - 26} y={y + 16} width={8} height={4} />
          </g>
          <CenteredLabel node={node} badge={badge} cx={c.x - 6} cy={c.y} />
        </g>
      )
    case 'database':
      return (
        <g>
          <path d={`M ${x} ${y + 10} V ${y + height - 10} A ${width / 2} 10 0 0 0 ${x + width} ${y + height - 10} V ${y + 10}`} fill={fill} {...stroke} />
          <ellipse cx={c.x} cy={y + 10} rx={width / 2} ry={10} fill={fill} {...stroke} />
          <CenteredLabel node={node} badge={badge} cx={c.x} cy={c.y + 6} />
        </g>
      )
    case 'queue':
      return (
        <g>
          <path d={`M ${x + 10} ${y} H ${x + width - 10} A 10 ${height / 2} 0 0 1 ${x + width - 10} ${y + height} H ${x + 10} A 10 ${height / 2} 0 0 1 ${x + 10} ${y} Z`} fill={fill} {...stroke} />
          <path d={`M ${x + width - 10} ${y} A 10 ${height / 2} 0 0 0 ${x + width - 10} ${y + height}`} fill="none" {...stroke} />
          <CenteredLabel node={node} badge={badge} cx={c.x - 4} cy={c.y} />
        </g>
      )
    case 'storage':
      return (
        <g>
          <rect x={x} y={y} width={width} height={height} rx={height / 2.5} fill={fill} {...stroke} />
          <CenteredLabel node={node} badge={badge} cx={c.x} cy={c.y} />
        </g>
      )
    case 'artifact':
      return (
        <g>
          <path d={`M ${x} ${y} H ${x + width - 14} L ${x + width} ${y + 14} V ${y + height} H ${x} Z M ${x + width - 14} ${y} V ${y + 14} H ${x + width}`} fill={fill} {...stroke} />
          <CenteredLabel node={node} badge={badge} cx={c.x} cy={c.y} />
        </g>
      )
    case 'node3d':
      return (
        <g>
          <path d={`M ${x} ${y + 10} L ${x + 10} ${y} H ${x + width} V ${y + height - 10} L ${x + width - 10} ${y + height} M ${x + width - 10} ${y + 10} L ${x + width} ${y}`} fill={fill} {...stroke} />
          <rect x={x} y={y + 10} width={width - 10} height={height - 10} fill={fill} {...stroke} />
          <CenteredLabel node={node} badge={badge} cx={c.x - 5} cy={c.y + 5} />
        </g>
      )
    case 'cloud':
      return (
        <g>
          <rect x={x} y={y} width={width} height={height} rx={height / 2} fill={fill} {...stroke} />
          <CenteredLabel node={node} badge={badge} cx={c.x} cy={c.y} />
        </g>
      )
    case 'lollipop':
      return (
        <g>
          <circle cx={c.x} cy={y + 12} r={10} fill={COLORS.paper} {...stroke} />
          <TextLines lines={nameLines(node.name)} x={c.x} y={y + 40} size={12} />
        </g>
      )
    case 'port':
      return (
        <g>
          <rect x={x} y={y} width={width} height={height} fill={node.type === 'portout' ? COLORS.stroke : COLORS.paper} {...stroke} />
          <TextLines lines={nameLines(node.name)} x={c.x} y={y + height + 14} size={11} />
        </g>
      )
    case 'initial':
      return <circle cx={c.x} cy={c.y} r={width / 2} fill={COLORS.stroke} />
    case 'final':
      return (
        <g>
          <circle cx={c.x} cy={c.y} r={width / 2} fill={COLORS.paper} {...stroke} />
          <circle cx={c.x} cy={c.y} r={width / 2 - 5} fill={COLORS.stroke} />
        </g>
      )
    case 'choice':
      return (
        <g>
          <path d={`M ${c.x} ${y} L ${x + width} ${c.y} L ${c.x} ${y + height} L ${x} ${c.y} Z`} fill={spec.color ?? COLORS.paper} {...stroke} />
          {node.name && node.name !== spec.defaultName && (
            <TextLines lines={nameLines(node.name)} x={x + width + 8} y={y + 4} size={11} anchor="start" fill={COLORS.muted} />
          )}
        </g>
      )
    case 'bar':
      return <rect x={x} y={y} width={width} height={height} rx={2} fill={COLORS.stroke} />
    case 'note':
      return (
        <g>
          <path
            d={`M ${x} ${y} H ${x + width - 12} L ${x + width} ${y + 12} V ${y + height} H ${x} Z M ${x + width - 12} ${y} V ${y + 12} H ${x + width}`}
            fill={COLORS.noteFill}
            stroke={COLORS.noteStroke}
            strokeWidth={1.2}
          />
          <TextLines lines={nameLines(node.name)} x={x + 12} y={y + 22} size={MEMBER_FONT} anchor="start" />
        </g>
      )
    case 'container-rect':
    case 'container-round':
    case 'container-component':
      return (
        <g>
          <rect x={x} y={y} width={width} height={height} rx={spec.shape === 'container-round' ? 16 : 4} fill={spec.color ?? 'rgba(244,247,247,0.45)'} {...stroke} />
          {badge && <TextLines lines={[`«${badge}»`]} x={c.x} y={y + 15} size={10.5} italic fill={COLORS.muted} />}
          <TextLines lines={nameLines(node.name)} x={c.x} y={y + (badge ? 31 : 22)} size={NAME_FONT} weight={600} />
          {spec.shape === 'container-component' && (
            <g {...stroke} strokeWidth={1.2} fill={COLORS.paper}>
              <rect x={x + width - 22} y={y + 7} width={14} height={16} />
              <rect x={x + width - 26} y={y + 10} width={8} height={4} />
              <rect x={x + width - 26} y={y + 16} width={8} height={4} />
            </g>
          )}
        </g>
      )
    case 'container-frame': {
      const tab = Math.min(width - 10, nameLines(node.name)[0].length * 7.5 + 26)
      return (
        <g>
          <rect x={x} y={y} width={width} height={height} fill="rgba(244,247,247,0.45)" {...stroke} />
          <path d={`M ${x} ${y + 22} H ${x + tab} L ${x + tab + 8} ${y + 14} V ${y}`} fill={COLORS.header} {...stroke} />
          <TextLines lines={[nameLines(node.name)[0]]} x={x + 8} y={y + 16} size={12} weight={600} anchor="start" />
        </g>
      )
    }
    case 'container-node':
      return (
        <g>
          <path d={`M ${x} ${y + 12} L ${x + 12} ${y} H ${x + width} V ${y + height - 12} L ${x + width - 12} ${y + height} M ${x + width - 12} ${y + 12} L ${x + width} ${y}`} fill={COLORS.header} {...stroke} />
          <rect x={x} y={y + 12} width={width - 12} height={height - 12} fill="rgba(244,247,247,0.6)" {...stroke} />
          {badge && <TextLines lines={[`«${badge}»`]} x={x + 10} y={y + 28} size={10.5} italic anchor="start" fill={COLORS.muted} />}
          <TextLines lines={[nameLines(node.name)[0]]} x={x + 10} y={y + (badge ? 44 : 30)} size={NAME_FONT} weight={600} anchor="start" />
        </g>
      )
    case 'container-cloud':
      return (
        <g>
          <rect x={x} y={y} width={width} height={height} rx={Math.min(40, height / 4)} fill="rgba(240,246,252,0.6)" {...stroke} strokeDasharray="8 4" />
          <TextLines lines={[`☁ ${nameLines(node.name)[0]}`]} x={c.x} y={y + 22} size={NAME_FONT} weight={600} />
        </g>
      )
    case 'container-folder': {
      const tab = Math.min(width - 20, Math.max(80, nameLines(node.name)[0].length * 8 + 24))
      return (
        <g>
          <path d={`M ${x} ${y + 24} V ${y} H ${x + tab} V ${y + 24}`} fill={COLORS.header} {...stroke} />
          <rect x={x} y={y + 24} width={width} height={height - 24} fill="rgba(244,247,247,0.45)" {...stroke} />
          <TextLines lines={[nameLines(node.name)[0]]} x={x + 10} y={y + 17} size={12} weight={600} anchor="start" />
          {badge && <TextLines lines={[`«${badge}»`]} x={x + tab + 8} y={y + 17} size={10.5} italic anchor="start" fill={COLORS.muted} />}
        </g>
      )
    }
    default: {
      // Caja con compartimentos (clase, entidad, objeto, requisito…).
      const header = classHeaderHeight(node, spec)
      const attributesTop = y + header
      const methodsTop = attributesTop + compartmentHeight(node.attributes)
      const members = (items: string[] | undefined, top: number) =>
        (items ?? []).map((line, index) => (
          <text key={index} x={x + 10} y={top + 16 + index * MEMBER_LINE} fontSize={MEMBER_FONT} fontFamily={FONT} fill={COLORS.text} textDecoration={line.includes('{static}') ? 'underline' : undefined} fontStyle={line.includes('{abstract}') ? 'italic' : undefined}>
            {line.replace('{static}', '').replace('{abstract}', '').trim()}
          </text>
        ))
      return (
        <g>
          <rect x={x} y={y} width={width} height={height} rx={3} fill={fill} {...stroke} />
          <rect x={x + 0.75} y={y + 0.75} width={width - 1.5} height={header - 0.75} rx={2.5} fill={spec.color ?? COLORS.header} />
          {badge && <TextLines lines={[`«${badge}»`]} x={c.x} y={y + 15} size={10.5} italic fill={COLORS.muted} />}
          <text x={c.x} y={y + (badge ? 32 : 20)} fontSize={NAME_FONT} fontFamily={FONT} fill={COLORS.text} textAnchor="middle" fontWeight={700} fontStyle={node.type === 'abstract' ? 'italic' : undefined} textDecoration={spec.type === 'object' ? 'underline' : undefined}>
            {nameLines(node.name).map((line, index) => <tspan key={index} x={c.x} dy={index === 0 ? 0 : 17}>{line}</tspan>)}
          </text>
          {spec.members && (
            <>
              <line x1={x} y1={attributesTop} x2={x + width} y2={attributesTop} stroke={COLORS.stroke} strokeWidth={1} />
              {members(node.attributes, attributesTop)}
            </>
          )}
          {spec.members === 'class' && (
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
      <marker id={`${prefix}-filled`} viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" {...common}>
        <path d="M 1 1 L 11 6 L 1 11 Z" fill={COLORS.stroke} />
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

function markersFor(spec: EdgeSpec, prefix: string) {
  return {
    start: spec.start ? `url(#${prefix}-${spec.start})` : undefined,
    end: spec.end ? `url(#${prefix}-${spec.end})` : undefined,
  }
}

/**
 * Separación de las relaciones paralelas (mismo par de elementos, sin codos):
 * cada una se desplaza en perpendicular para que no se dibujen una encima de otra.
 */
export function parallelOffsets(edges: GraphEdge[], gap = 14): Map<string, number> {
  const groups = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.source === edge.target || edge.points?.length) continue
    const key = [edge.source, edge.target].sort().join('|')
    groups.set(key, [...(groups.get(key) ?? []), edge.id])
  }
  const offsets = new Map<string, number>()
  for (const ids of groups.values()) {
    ids.forEach((id, index) => offsets.set(id, (index - (ids.length - 1) / 2) * gap))
  }
  return offsets
}

export type EdgeGeometry = { d: string; route: Point[]; start: Point; end: Point; middle: Point }

/** Geometría de una relación: polilínea por sus codos, desplazada si es paralela, o bucle si es recursiva. */
export function edgePath(kind: string, edge: GraphEdge, nodes: Map<string, GraphNode>, offset = 0): EdgeGeometry | null {
  const source = nodes.get(edge.source)
  const target = nodes.get(edge.target)
  if (!source || !target) return null
  if (source.id === target.id) {
    const rect = nodeRect(kind, source)
    const start = { x: rect.x + rect.width - 28, y: rect.y }
    const end = { x: rect.x + rect.width, y: rect.y + 24 }
    return {
      d: `M ${start.x} ${start.y} C ${start.x} ${start.y - 46}, ${end.x + 46} ${end.y}, ${end.x} ${end.y}`,
      route: [start, end],
      start,
      end,
      middle: { x: rect.x + rect.width + 14, y: rect.y - 22 },
    }
  }
  let route = edgeRoute(kind, edge, source, target)
  if (offset && route.length === 2) {
    // El desplazamiento se mide siempre en el mismo sentido (de id menor a mayor).
    const [a, b] = route
    const forward = source.id < target.id ? 1 : -1
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = (-(b.y - a.y) / length) * offset * forward
    const ny = ((b.x - a.x) / length) * offset * forward
    route = [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }]
  }
  // Etiqueta a mitad del recorrido total.
  const lengths = route.slice(1).map((point, index) => Math.hypot(point.x - route[index].x, point.y - route[index].y))
  let remaining = lengths.reduce((sum, value) => sum + value, 0) / 2
  let middle = route[0]
  for (let segment = 0; segment < lengths.length; segment += 1) {
    if (remaining <= lengths[segment]) {
      const t = lengths[segment] ? remaining / lengths[segment] : 0
      middle = { x: route[segment].x + (route[segment + 1].x - route[segment].x) * t, y: route[segment].y + (route[segment + 1].y - route[segment].y) * t }
      break
    }
    remaining -= lengths[segment]
  }
  return {
    d: `M ${route.map((point) => `${point.x} ${point.y}`).join(' L ')}`,
    route,
    start: route[0],
    end: route[route.length - 1],
    middle,
  }
}

/** Punto a `distance` de `from` hacia `toward`, desplazado `side` px en perpendicular. */
function along(from: Point, toward: Point, distance: number, side: number): Point {
  const length = Math.hypot(toward.x - from.x, toward.y - from.y) || 1
  const ux = (toward.x - from.x) / length
  const uy = (toward.y - from.y) / length
  return { x: from.x + ux * distance - uy * side, y: from.y + uy * distance + ux * side }
}

function EdgeText({ point, text }: { point: Point; text: string }) {
  return (
    <text x={point.x} y={point.y} fontSize={11} fontFamily={FONT} fill={COLORS.text} textAnchor="middle" paintOrder="stroke" stroke={COLORS.paper} strokeWidth={4} strokeLinejoin="round">
      {text}
    </text>
  )
}

/** Pata de gallo (entidad-relación) en un extremo según la cardinalidad. */
function CrowFoot({ at, toward, cardinality }: { at: Point; toward: Point; cardinality: string }) {
  const p = (distance: number, side: number) => along(at, toward, distance, side)
  const many = cardinality.includes('*')
  const optional = cardinality.startsWith('0')
  const parts: string[] = []
  if (many) {
    const tip = p(14, 0)
    parts.push(`M ${p(0, -8).x} ${p(0, -8).y} L ${tip.x} ${tip.y} L ${p(0, 8).x} ${p(0, 8).y}`)
  } else {
    parts.push(`M ${p(10, -7).x} ${p(10, -7).y} L ${p(10, 7).x} ${p(10, 7).y}`)
  }
  if (!optional) parts.push(`M ${p(18, -7).x} ${p(18, -7).y} L ${p(18, 7).x} ${p(18, 7).y}`)
  const circle = optional ? p(23, 0) : null
  return (
    <g stroke={COLORS.stroke} strokeWidth={1.5} fill="none">
      <path d={parts.join(' ')} />
      {circle && <circle cx={circle.x} cy={circle.y} r={4.5} fill={COLORS.paper} />}
    </g>
  )
}

export function EdgeShape({ kind, edge, nodes, prefix, offset = 0 }: { kind: string; edge: GraphEdge; nodes: Map<string, GraphNode>; prefix: string; offset?: number }) {
  const geometry = edgePath(kind, edge, nodes, offset)
  if (!geometry) return null
  const spec = edgeSpec(kind, edge.type)
  const markers = markersFor(spec, prefix)
  const { route } = geometry
  const text = spec.fixedText ? `«${spec.fixedText}»${edge.label?.trim() ? ` ${edge.label.trim()}` : ''}` : edge.label?.trim() ?? ''
  const second = route[1] ?? geometry.end
  const penultimate = route[route.length - 2] ?? geometry.start
  return (
    <g>
      <path
        d={geometry.d}
        fill="none"
        stroke={edge.type === 'note-link' ? COLORS.noteStroke : COLORS.stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeDasharray={spec.dashed ? '6 4' : undefined}
        markerStart={markers.start}
        markerEnd={markers.end}
      />
      {spec.ends === 'cardinality' && (
        <>
          <CrowFoot at={geometry.start} toward={second} cardinality={edge.sourceLabel?.trim() || '1'} />
          <CrowFoot at={geometry.end} toward={penultimate} cardinality={edge.targetLabel?.trim() || '0..*'} />
        </>
      )}
      {text && <EdgeText point={{ x: geometry.middle.x, y: geometry.middle.y - 6 }} text={text} />}
      {spec.ends === 'multiplicity' && edge.sourceLabel?.trim() && <EdgeText point={along(geometry.start, second, 22, -10)} text={edge.sourceLabel.trim()} />}
      {spec.ends === 'multiplicity' && edge.targetLabel?.trim() && <EdgeText point={along(geometry.end, penultimate, 22, 10)} text={edge.targetLabel.trim()} />}
    </g>
  )
}

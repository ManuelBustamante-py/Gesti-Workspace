import { nodeSpec, type NodeSpec } from './kinds'
import type { GraphEdge, GraphNode, Point } from './visualModel'

export type { Point } from './visualModel'
export type Rect = { x: number; y: number; width: number; height: number }

export const NAME_FONT = 13
export const MEMBER_FONT = 12
export const MEMBER_LINE = 17

let context: CanvasRenderingContext2D | null | undefined

/** Ancho de un texto. Usa el canvas del navegador; en pruebas, una aproximación. */
export function textWidth(text: string, size: number, bold = false) {
  if (context === undefined) {
    context = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  }
  if (context) {
    context.font = `${bold ? '600 ' : ''}${size}px Inter, ui-sans-serif, system-ui, sans-serif`
    return context.measureText(text).width
  }
  return text.length * size * (bold ? 0.62 : 0.58)
}

const widest = (texts: string[], size: number, bold = false) => Math.max(0, ...texts.map((text) => textWidth(text, size, bold)))
export const nameLines = (name: string) => (name || ' ').split('\n')

/** Estereotipo visible: el del usuario o el propio del tipo («interface», «Contenedor»…). */
export function stereotypeOf(node: GraphNode, spec: NodeSpec) {
  return node.stereotype?.trim() || spec.badge || null
}

export function classHeaderHeight(node: GraphNode, spec: NodeSpec) {
  return (stereotypeOf(node, spec) ? 16 : 0) + nameLines(node.name).length * 17 + 14
}

/** Alto de un compartimento de atributos o métodos; vacío queda como franja delgada. */
export function compartmentHeight(lines: string[] | undefined) {
  const count = lines?.length ?? 0
  return count > 0 ? count * MEMBER_LINE + 8 : 10
}

export function nodeSize(kind: string, node: GraphNode): { width: number; height: number } {
  const spec = nodeSpec(kind, node.type)
  const lines = nameLines(node.name)
  const nameWidth = widest(lines, NAME_FONT)
  const badge = stereotypeOf(node, spec)
  const badgeWidth = badge ? textWidth(`«${badge}»`, 10.5) : 0
  const textHeight = lines.length * 17 + (badge ? 15 : 0)

  if (spec.container) return { width: node.width ?? 320, height: node.height ?? 220 }
  switch (spec.shape) {
    case 'actor':
      return { width: Math.max(64, nameWidth + 12, badgeWidth + 12), height: 70 + textHeight }
    case 'ellipse':
      return { width: Math.max(130, nameWidth + 52, badgeWidth + 52), height: Math.max(52, textHeight + 30) }
    case 'note':
      return { width: Math.max(120, widest(lines, MEMBER_FONT) + 28), height: lines.length * MEMBER_LINE + 20 }
    case 'initial':
      return { width: 24, height: 24 }
    case 'final':
      return { width: 28, height: 28 }
    case 'choice':
      return { width: 36, height: 36 }
    case 'bar':
      return { width: 120, height: 10 }
    case 'port':
      return { width: 16, height: 16 }
    case 'lollipop':
      return { width: Math.max(60, nameWidth + 10), height: 50 }
    case 'database':
    case 'queue':
    case 'storage':
    case 'artifact':
    case 'cloud':
    case 'node3d':
    case 'component':
    case 'archimate':
    case 'rect':
    case 'round':
      return { width: Math.max(spec.shape === 'round' ? 110 : 130, nameWidth + 40, badgeWidth + 32), height: Math.max(spec.shape === 'database' ? 70 : 50, textHeight + (spec.shape === 'database' ? 40 : 24)) }
    default: {
      // Cajas con compartimentos: clases, entidades, objetos, requisitos…
      const members = [...(node.attributes ?? []), ...(spec.members === 'class' ? node.methods ?? [] : [])]
      const width = Math.max(150, widest(lines, NAME_FONT, true) + 32, badgeWidth + 32, widest(members, MEMBER_FONT) + 24)
      const height =
        classHeaderHeight(node, spec) +
        (spec.members ? compartmentHeight(node.attributes) : 0) +
        (spec.members === 'class' ? compartmentHeight(node.methods) : 0)
      return { width: Math.ceil(width), height: spec.members ? height : Math.max(height, 40) }
    }
  }
}

export function nodeRect(kind: string, node: GraphNode): Rect {
  return { x: node.x, y: node.y, ...nodeSize(kind, node) }
}

export const center = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })

const contains = (outer: Rect, point: Point) =>
  point.x > outer.x && point.x < outer.x + outer.width && point.y > outer.y && point.y < outer.y + outer.height

/**
 * Contenedor directo de cada elemento: el contenedor más pequeño que encierra
 * su centro. Arrastrar un elemento dentro de un contenedor lo agrupa.
 */
export function containerMap(kind: string, nodes: GraphNode[]): Map<string, string | null> {
  const containers = nodes.filter((node) => nodeSpec(kind, node.type).container).map((node) => ({ node, rect: nodeRect(kind, node) }))
  const result = new Map<string, string | null>()
  for (const node of nodes) {
    const rect = nodeRect(kind, node)
    const point = center(rect)
    const area = rect.width * rect.height
    const isContainer = Boolean(nodeSpec(kind, node.type).container)
    let best: { id: string; area: number } | null = null
    for (const container of containers) {
      if (container.node.id === node.id) continue
      const containerArea = container.rect.width * container.rect.height
      // Un contenedor solo puede estar dentro de otro más grande (evita ciclos).
      if (isContainer && containerArea <= area) continue
      if (contains(container.rect, point) && (!best || containerArea < best.area)) best = { id: container.node.id, area: containerArea }
    }
    result.set(node.id, best?.id ?? null)
  }
  return result
}

/** Punto del borde de un elemento en dirección a `toward` (elipse, rombo o rectángulo). */
export function anchorPoint(kind: string, node: GraphNode, toward: Point): Point {
  const rect = nodeRect(kind, node)
  const c = center(rect)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) return c
  const shape = nodeSpec(kind, node.type).shape
  if (shape === 'ellipse' || shape === 'initial' || shape === 'final' || shape === 'lollipop') {
    const rx = shape === 'lollipop' ? 10 : rect.width / 2
    const ry = shape === 'lollipop' ? 10 : rect.height / 2
    const cy = shape === 'lollipop' ? rect.y + 12 : c.y
    const t = 1 / Math.sqrt((dx * dx) / (rx * rx) + ((toward.y - cy) ** 2) / (ry * ry))
    return { x: c.x + dx * t, y: cy + (toward.y - cy) * t }
  }
  if (shape === 'choice') {
    const t = 1 / (Math.abs(dx) / (rect.width / 2) + Math.abs(dy) / (rect.height / 2))
    return { x: c.x + dx * t, y: c.y + dy * t }
  }
  const scale = Math.min(
    dx !== 0 ? rect.width / 2 / Math.abs(dx) : Infinity,
    dy !== 0 ? rect.height / 2 / Math.abs(dy) : Infinity,
  )
  return { x: c.x + dx * scale, y: c.y + dy * scale }
}

/**
 * Recorrido de una relación: desde el borde del origen, por los puntos de
 * quiebre, hasta el borde del destino.
 */
export function edgeRoute(kind: string, edge: GraphEdge, source: GraphNode, target: GraphNode): Point[] {
  const points = edge.points ?? []
  const sourceCenter = center(nodeRect(kind, source))
  const targetCenter = center(nodeRect(kind, target))
  const first = points[0] ?? targetCenter
  const last = points[points.length - 1] ?? sourceCenter
  return [anchorPoint(kind, source, first), ...points, anchorPoint(kind, target, last)]
}

/** Rectángulo que abarca todos los elementos y codos (para encuadrar y exportar). */
export function contentBounds(kind: string, nodes: GraphNode[], edges: GraphEdge[] = [], padding = 40): Rect {
  if (nodes.length === 0) return { x: 0, y: 0, width: 800, height: 500 }
  const rects = nodes.map((node) => nodeRect(kind, node))
  const bends = edges.flatMap((edge) => edge.points ?? []).map((point) => ({ x: point.x, y: point.y, width: 0, height: 0 }))
  const all = [...rects, ...bends]
  const minX = Math.min(...all.map((rect) => rect.x))
  const minY = Math.min(...all.map((rect) => rect.y))
  const maxX = Math.max(...all.map((rect) => rect.x + rect.width))
  const maxY = Math.max(...all.map((rect) => rect.y + rect.height))
  return { x: minX - padding, y: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 }
}

export const snap = (value: number, grid = 10) => Math.round(value / grid) * grid

/** Distancia de un punto a un segmento (para insertar codos donde se hace doble clic). */
export function distanceToSegment(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

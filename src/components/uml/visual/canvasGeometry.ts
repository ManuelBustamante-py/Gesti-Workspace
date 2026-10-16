import { edgeRoute, nodeRect, type Point } from '../../../domain/uml/geometry'
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


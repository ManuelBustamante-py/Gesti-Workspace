import { isContainer, type GraphNode } from './visualModel'

export type Rect = { x: number; y: number; width: number; height: number }
export type Point = { x: number; y: number }

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

/** Estereotipo que se muestra sobre el nombre («interface», «enumeration», o el del usuario). */
export function stereotypeOf(node: GraphNode) {
  if (node.stereotype?.trim()) return node.stereotype.trim()
  if (node.type === 'interface') return 'interface'
  if (node.type === 'enum') return 'enumeration'
  if (node.type === 'abstract') return 'abstract'
  return null
}

export const isClassLike = (node: GraphNode) => ['class', 'abstract', 'interface', 'enum'].includes(node.type)

/** Alto de la cabecera de una clase (estereotipo + nombre). */
export function classHeaderHeight(node: GraphNode) {
  return (stereotypeOf(node) ? 16 : 0) + nameLines(node.name).length * 17 + 14
}

/** Alto de un compartimento de atributos o métodos; vacío queda como franja delgada. */
export function compartmentHeight(lines: string[] | undefined) {
  const count = lines?.length ?? 0
  return count > 0 ? count * MEMBER_LINE + 8 : 10
}

export function nodeSize(node: GraphNode): { width: number; height: number } {
  const lines = nameLines(node.name)
  switch (node.type) {
    case 'actor':
      return { width: Math.max(64, widest(lines, NAME_FONT) + 12), height: 70 + lines.length * 17 }
    case 'usecase':
      return { width: Math.max(130, widest(lines, NAME_FONT) + 52), height: Math.max(52, lines.length * 17 + 30) }
    case 'boundary':
    case 'package':
      return { width: node.width ?? 320, height: node.height ?? 220 }
    case 'note':
      return { width: Math.max(120, widest(lines, MEMBER_FONT) + 28), height: lines.length * MEMBER_LINE + 20 }
    default: {
      const stereotype = stereotypeOf(node)
      const members = [...(node.attributes ?? []), ...(node.type === 'enum' ? [] : node.methods ?? [])]
      const width = Math.max(
        150,
        widest(lines, NAME_FONT, true) + 32,
        stereotype ? textWidth(`«${stereotype}»`, 11) + 32 : 0,
        widest(members, MEMBER_FONT) + 24,
      )
      const height = classHeaderHeight(node) + compartmentHeight(node.attributes) + (node.type === 'enum' ? 0 : compartmentHeight(node.methods))
      return { width: Math.ceil(width), height }
    }
  }
}

export function nodeRect(node: GraphNode): Rect {
  return { x: node.x, y: node.y, ...nodeSize(node) }
}

export const center = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })

const contains = (outer: Rect, point: Point) =>
  point.x > outer.x && point.x < outer.x + outer.width && point.y > outer.y && point.y < outer.y + outer.height

/**
 * Contenedor directo de cada elemento: el contenedor más pequeño que encierra
 * su centro. Así, arrastrar un caso de uso dentro del límite del sistema (o una
 * clase dentro de un paquete) lo agrupa, igual que en PlantUML.
 */
export function containerMap(nodes: GraphNode[]): Map<string, string | null> {
  const containers = nodes.filter((node) => isContainer(node.type)).map((node) => ({ node, rect: nodeRect(node) }))
  const result = new Map<string, string | null>()
  for (const node of nodes) {
    const rect = nodeRect(node)
    const point = center(rect)
    const area = rect.width * rect.height
    let best: { id: string; area: number } | null = null
    for (const container of containers) {
      if (container.node.id === node.id) continue
      const containerArea = container.rect.width * container.rect.height
      // Un contenedor solo puede estar dentro de otro más grande (evita ciclos).
      if (isContainer(node.type) && containerArea <= area) continue
      if (contains(container.rect, point) && (!best || containerArea < best.area)) best = { id: container.node.id, area: containerArea }
    }
    result.set(node.id, best?.id ?? null)
  }
  return result
}

/** Punto del borde de un elemento en dirección a `toward` (elipse para casos de uso). */
export function anchorPoint(node: GraphNode, toward: Point): Point {
  const rect = nodeRect(node)
  const c = center(rect)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) return c
  if (node.type === 'usecase') {
    const rx = rect.width / 2
    const ry = rect.height / 2
    const t = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry))
    return { x: c.x + dx * t, y: c.y + dy * t }
  }
  const scale = Math.min(
    dx !== 0 ? rect.width / 2 / Math.abs(dx) : Infinity,
    dy !== 0 ? rect.height / 2 / Math.abs(dy) : Infinity,
  )
  return { x: c.x + dx * scale, y: c.y + dy * scale }
}

/** Línea entre dos elementos, recortada en sus bordes. */
export function edgeLine(source: GraphNode, target: GraphNode): { start: Point; end: Point } {
  const sourceCenter = center(nodeRect(source))
  const targetCenter = center(nodeRect(target))
  return { start: anchorPoint(source, targetCenter), end: anchorPoint(target, sourceCenter) }
}

/** Rectángulo que abarca todos los elementos (para ajustar la vista y exportar). */
export function contentBounds(nodes: GraphNode[], padding = 40): Rect {
  if (nodes.length === 0) return { x: 0, y: 0, width: 800, height: 500 }
  const rects = nodes.map(nodeRect)
  const minX = Math.min(...rects.map((rect) => rect.x))
  const minY = Math.min(...rects.map((rect) => rect.y))
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width))
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: minX - padding, y: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 }
}

export const snap = (value: number, grid = 10) => Math.round(value / grid) * grid

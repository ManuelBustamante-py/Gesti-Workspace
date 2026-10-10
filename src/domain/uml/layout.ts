import { nodeSize, snap } from './geometry'
import { nodeSpec } from './kinds'
import type { GraphModel, GraphNode } from './visualModel'

const RANK_GAP = 90
const NODE_GAP = 50
const CONTAINER_PADDING = 30
const CONTAINER_HEADER = 34

/** Contenedor directo declarado en el código (no por geometría: aún no hay posiciones). */
export type Parents = Map<string, string | null>

/**
 * Distribución automática por capas para diagramas sin posiciones (al pasar de
 * código a visual): niveles por camino más largo, orden dentro del nivel por
 * baricentro (menos cruces), contenedores ajustados a su contenido y notas
 * junto al elemento que comentan.
 */
export function autoLayout(input: GraphModel, parents: Parents, onlyIds?: Set<string>): GraphModel {
  const kind = input.kind
  // Los contenedores vacíos sin tamaño elegido toman uno compacto.
  const model = {
    ...input,
    nodes: input.nodes.map((node) =>
      nodeSpec(kind, node.type).container && node.width === undefined && !input.nodes.some((other) => parents.get(other.id) === node.id)
        ? { ...node, width: 200, height: 110 }
        : node),
  }
  const isContainer = (node: GraphNode) => Boolean(nodeSpec(kind, node.type).container)
  const movable = (node: GraphNode) => !onlyIds || onlyIds.has(node.id)
  // Un contenedor vacío se ubica como un elemento más (si no, quedaría en el origen).
  const hasChildren = (node: GraphNode) => model.nodes.some((other) => parents.get(other.id) === node.id)
  const leaves = model.nodes.filter((node) => (!isContainer(node) || !hasChildren(node)) && node.type !== 'note' && movable(node))
  const leafIds = new Set(leaves.map((node) => node.id))
  const edges = model.edges.filter((edge) => leafIds.has(edge.source) && leafIds.has(edge.target) && edge.source !== edge.target)

  // Niveles: camino más largo desde las fuentes, ignorando las aristas que cierran ciclos.
  const outgoing = new Map(leaves.map((node) => [node.id, [] as string[]]))
  for (const edge of edges) outgoing.get(edge.source)!.push(edge.target)
  const state = new Map<string, 'visiting' | 'done'>()
  const back = new Set<string>()
  const visit = (id: string) => {
    state.set(id, 'visiting')
    for (const next of outgoing.get(id) ?? []) {
      if (state.get(next) === 'visiting') back.add(`${id}>${next}`)
      else if (!state.has(next)) visit(next)
    }
    state.set(id, 'done')
  }
  leaves.forEach((node) => !state.has(node.id) && visit(node.id))
  const forward = edges.filter((edge) => !back.has(`${edge.source}>${edge.target}`))
  const rank = new Map(leaves.map((node) => [node.id, 0]))
  for (let pass = 0; pass < leaves.length; pass += 1) {
    let changed = false
    for (const edge of forward) {
      const next = rank.get(edge.source)! + 1
      if (next > rank.get(edge.target)!) {
        rank.set(edge.target, next)
        changed = true
      }
    }
    if (!changed) break
  }

  // Orden dentro de cada nivel: agrupado por contenedor y luego por baricentro.
  const groupOf = (id: string) => parents.get(id) ?? ''
  const ranks: string[][] = []
  for (const node of leaves) (ranks[rank.get(node.id)!] ??= []).push(node.id)
  const position = new Map<string, number>()
  const refreshPositions = () => ranks.forEach((ids) => ids.forEach((id, index) => position.set(id, index)))
  refreshPositions()
  const neighbors = (id: string) => [
    ...forward.filter((edge) => edge.target === id).map((edge) => edge.source),
    ...forward.filter((edge) => edge.source === id).map((edge) => edge.target),
  ]
  for (let sweep = 0; sweep < 4; sweep += 1) {
    for (const ids of ranks) {
      if (!ids) continue
      const barycenter = new Map(ids.map((id) => {
        const around = neighbors(id).map((other) => position.get(other) ?? 0)
        return [id, around.length ? around.reduce((sum, value) => sum + value, 0) / around.length : position.get(id)!] as const
      }))
      ids.sort((a, b) => groupOf(a).localeCompare(groupOf(b)) || barycenter.get(a)! - barycenter.get(b)!)
    }
    refreshPositions()
  }

  // Coordenadas (de arriba hacia abajo; para izquierda a derecha se trasponen).
  // Cada contenedor de primer nivel (carril, paquete…) recibe su propia franja
  // a lo ancho, así dos contenedores hermanos nunca se superponen.
  const horizontal = model.direction === 'left-to-right'
  const sizes = new Map(model.nodes.map((node) => [node.id, nodeSize(kind, node)]))
  const topGroup = (id: string): string => {
    let current = parents.get(id) ?? null
    let top = ''
    while (current) {
      top = current
      current = parents.get(current) ?? null
    }
    return top
  }
  const across = (id: string) => (horizontal ? sizes.get(id)!.height : sizes.get(id)!.width)
  const groupOrder = [...new Set(leaves.map((node) => topGroup(node.id)))].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : 0))
  const slot = new Map(groupOrder.map((group) => [group, 0]))
  for (const ids of ranks) {
    if (!ids) continue
    for (const group of groupOrder) {
      const members = ids.filter((id) => topGroup(id) === group)
      const total = members.reduce((sum, id) => sum + across(id), 0) + NODE_GAP * Math.max(0, members.length - 1)
      slot.set(group, Math.max(slot.get(group)!, total))
    }
  }
  const slotStart = new Map<string, number>()
  let cursorSlot = 0
  for (const group of groupOrder) {
    slotStart.set(group, cursorSlot)
    cursorSlot += slot.get(group)! + (group ? CONTAINER_PADDING * 2 + NODE_GAP : NODE_GAP)
  }
  const placed = new Map<string, { x: number; y: number }>()
  let offset = 0
  ranks.forEach((ids) => {
    if (!ids) return
    const thickness = Math.max(...ids.map((id) => (horizontal ? sizes.get(id)!.width : sizes.get(id)!.height)))
    for (const group of groupOrder) {
      const members = ids.filter((id) => topGroup(id) === group)
      const total = members.reduce((sum, id) => sum + across(id), 0) + NODE_GAP * Math.max(0, members.length - 1)
      // Centrado dentro de la franja de su grupo.
      let cursor = slotStart.get(group)! + (group ? CONTAINER_PADDING : 0) + (slot.get(group)! - total) / 2
      for (const id of members) {
        placed.set(id, horizontal ? { x: offset, y: cursor } : { x: cursor, y: offset })
        cursor += across(id) + NODE_GAP
      }
    }
    offset += thickness + RANK_GAP
  })

  const nodes = model.nodes.map((node) => {
    const point = placed.get(node.id)
    return point ? { ...node, x: snap(point.x + 80), y: snap(point.y + 80) } : node
  })
  const byId = new Map(nodes.map((node) => [node.id, node]))

  // Contenedores: del más profundo al más externo, abarcando su contenido.
  const depth = (id: string): number => {
    const parent = parents.get(id)
    return parent ? 1 + depth(parent) : 0
  }
  const containers = nodes.filter((node) => isContainer(node) && movable(node) && hasChildren(node)).sort((a, b) => depth(b.id) - depth(a.id))
  for (const container of containers) {
    const children = nodes.filter((node) => parents.get(node.id) === container.id)
    const boxes = children.map((child) => {
      const current = byId.get(child.id)!
      const size = isContainer(current) ? { width: current.width ?? 240, height: current.height ?? 140 } : sizes.get(child.id)!
      return { x: current.x, y: current.y, ...size }
    })
    const minX = Math.min(...boxes.map((box) => box.x)) - CONTAINER_PADDING
    const minY = Math.min(...boxes.map((box) => box.y)) - CONTAINER_PADDING - CONTAINER_HEADER
    const maxX = Math.max(...boxes.map((box) => box.x + box.width)) + CONTAINER_PADDING
    const maxY = Math.max(...boxes.map((box) => box.y + box.height)) + CONTAINER_PADDING
    byId.set(container.id, { ...container, x: snap(minX), y: snap(minY), width: snap(maxX - minX), height: snap(maxY - minY) })
  }

  // Notas: a la derecha del elemento que comentan; las sueltas, al final.
  let looseY = 60
  const right = Math.max(400, ...[...byId.values()].map((node) => node.x + (sizes.get(node.id)?.width ?? 0)))
  for (const node of nodes) {
    if (node.type !== 'note' || !movable(node)) continue
    const link = model.edges.find((edge) => edge.source === node.id || edge.target === node.id)
    const other = link ? byId.get(link.source === node.id ? link.target : link.source) : undefined
    if (other) {
      const otherSize = isContainer(other) ? { width: other.width ?? 240 } : sizes.get(other.id)!
      byId.set(node.id, { ...node, x: snap(other.x + otherSize.width + 40), y: snap(other.y) })
    } else {
      byId.set(node.id, { ...node, x: snap(right + 60), y: snap(looseY) })
      looseY += (sizes.get(node.id)?.height ?? 60) + 30
    }
  }

  return { ...model, nodes: model.nodes.map((node) => byId.get(node.id)!) }
}

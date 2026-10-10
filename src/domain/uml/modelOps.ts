import { containerMap, distanceToSegment, edgeRoute, nodeRect, nodeSize, snap, type Point } from './geometry'
import { kindSpec, nodeSpec } from './kinds'
import {
  PARTICIPANT_LABELS,
  isContainer,
  nextId,
  type GraphEdge,
  type GraphModel,
  type GraphNode,
  type MessageType,
  type ParticipantType,
  type SequenceModel,
} from './visualModel'

// --- Grafo ----------------------------------------------------------------------------

/** Nombre por defecto sin repetir: «Clase», «Clase 2»… */
function defaultName(base: string, taken: string[]) {
  if (!taken.includes(base)) return base
  let index = 2
  while (taken.includes(`${base} ${index}`)) index += 1
  return `${base} ${index}`
}

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/**
 * Agrega un elemento centrado en `point`. Con `avoidOverlap` busca el hueco
 * libre más cercano (agregar con clic); al soltarlo con el mouse se respeta el punto.
 */
export function addNode(model: GraphModel, type: string, point: Point, avoidOverlap = false): { model: GraphModel; id: string } {
  const spec = nodeSpec(model.kind, type)
  const id = nextId('n', model.nodes.map((node) => node.id))
  const draft: GraphNode = {
    id,
    type,
    name: spec.pseudo ? spec.defaultName : defaultName(spec.defaultName, model.nodes.map((node) => node.name)),
    x: 0,
    y: 0,
    ...(spec.container ? { width: 360, height: 260 } : {}),
    ...(spec.defaultMembers?.attributes ? { attributes: [...spec.defaultMembers.attributes] } : {}),
    ...(spec.defaultMembers?.methods ? { methods: [...spec.defaultMembers.methods] } : {}),
  }
  const size = nodeSize(model.kind, draft)
  let node = { ...draft, x: snap(point.x - size.width / 2), y: snap(point.y - size.height / 2) }
  if (avoidOverlap && !spec.container) {
    const others = model.nodes.filter((item) => !isContainer(model.kind, item.type)).map((item) => nodeRect(model.kind, item))
    const margin = 20
    const free = (x: number, y: number) =>
      !others.some((rect) => overlaps({ x: x - margin, y: y - margin, width: size.width + margin * 2, height: size.height + margin * 2 }, rect))
    // Espiral de búsqueda alrededor del punto pedido.
    search: for (let ring = 1; ring <= 12 && !free(node.x, node.y); ring += 1) {
      for (let step = 0; step < 8; step += 1) {
        const angle = (step / 8) * Math.PI * 2
        const x = snap(point.x - size.width / 2 + Math.cos(angle) * ring * 60)
        const y = snap(point.y - size.height / 2 + Math.sin(angle) * ring * 60)
        if (free(x, y)) {
          node = { ...node, x, y }
          break search
        }
      }
    }
  }
  // Los contenedores van primero: se dibujan detrás del resto.
  const nodes = spec.container ? [node, ...model.nodes] : [...model.nodes, node]
  return { model: { ...model, nodes }, id }
}

/** Ids de lo que está dentro de un contenedor (a cualquier profundidad). */
export function descendantsOf(model: GraphModel, id: string): string[] {
  const parents = containerMap(model.kind, model.nodes)
  const result: string[] = []
  const visit = (parent: string) => {
    for (const node of model.nodes) {
      if (parents.get(node.id) === parent) {
        result.push(node.id)
        visit(node.id)
      }
    }
  }
  visit(id)
  return result
}

/**
 * Mueve elementos desde sus posiciones originales (arrastre), ajustando a la
 * grilla. Los codos de las relaciones cuyos dos extremos se mueven, se mueven con ellos.
 */
export function moveNodes(model: GraphModel, origins: Map<string, Point>, dx: number, dy: number, bendOrigins?: Map<string, Point[]>): GraphModel {
  const sdx = snap(dx)
  const sdy = snap(dy)
  return {
    ...model,
    nodes: model.nodes.map((node) => {
      const origin = origins.get(node.id)
      return origin ? { ...node, x: snap(origin.x + dx), y: snap(origin.y + dy) } : node
    }),
    edges: bendOrigins
      ? model.edges.map((edge) => {
        const points = bendOrigins.get(edge.id)
        return points ? { ...edge, points: points.map((point) => ({ x: point.x + sdx, y: point.y + sdy })) } : edge
      })
      : model.edges,
  }
}

/** Codos de las relaciones internas a un grupo de elementos (para moverlos juntos). */
export function bendsWithin(model: GraphModel, ids: Set<string>): Map<string, Point[]> {
  return new Map(
    model.edges
      .filter((edge) => edge.points?.length && ids.has(edge.source) && ids.has(edge.target))
      .map((edge) => [edge.id, edge.points!.map((point) => ({ ...point }))]),
  )
}

export function updateNode(model: GraphModel, id: string, patch: Partial<GraphNode>): GraphModel {
  return { ...model, nodes: model.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)) }
}

/** Elimina el elemento y sus relaciones. Lo que estaba dentro de un contenedor se conserva. */
export function deleteNode(model: GraphModel, id: string): GraphModel {
  return {
    ...model,
    nodes: model.nodes.filter((node) => node.id !== id),
    edges: model.edges.filter((edge) => edge.source !== id && edge.target !== id),
  }
}

/**
 * Conecta dos elementos. Con una nota siempre es un enlace de nota; los
 * contenedores no se conectan; no se duplica la misma relación; inicio solo
 * sale y fin solo recibe.
 */
export function addEdge(model: GraphModel, type: string, source: string, target: string): { model: GraphModel; id: string | null } {
  const from = model.nodes.find((node) => node.id === source)
  const to = model.nodes.find((node) => node.id === target)
  if (!from || !to || isContainer(model.kind, from.type) || isContainer(model.kind, to.type)) return { model, id: null }
  if (nodeSpec(model.kind, from.type).pseudo === 'final' || nodeSpec(model.kind, to.type).pseudo === 'initial') return { model, id: null }
  const resolved = from.type === 'note' || to.type === 'note' ? 'note-link' : type
  // Relaciones consigo mismo: asociación recursiva (clases) o transición propia (estados).
  const syntax = kindSpec(model.kind)?.syntax
  if (source === target && (resolved === 'note-link' || syntax === 'description')) return { model, id: null }
  const duplicate = model.edges.some((edge) => edge.type === resolved && edge.source === source && edge.target === target)
  if (duplicate) return { model, id: null }
  const id = nextId('e', model.edges.map((edge) => edge.id))
  return { model: { ...model, edges: [...model.edges, { id, type: resolved, source, target }] }, id }
}

export function updateEdge(model: GraphModel, id: string, patch: Partial<GraphEdge>): GraphModel {
  return { ...model, edges: model.edges.map((edge) => (edge.id === id ? { ...edge, ...patch } : edge)) }
}

export function reverseEdge(model: GraphModel, id: string): GraphModel {
  return {
    ...model,
    edges: model.edges.map((edge) =>
      edge.id === id
        ? { ...edge, source: edge.target, target: edge.source, sourceLabel: edge.targetLabel, targetLabel: edge.sourceLabel, points: edge.points ? [...edge.points].reverse() : undefined }
        : edge,
    ),
  }
}

export function deleteEdge(model: GraphModel, id: string): GraphModel {
  return { ...model, edges: model.edges.filter((edge) => edge.id !== id) }
}

/** Inserta un codo en el tramo de la relación más cercano a `point`. Devuelve su índice. */
export function addBend(model: GraphModel, edgeId: string, point: Point): { model: GraphModel; index: number } {
  const edge = model.edges.find((item) => item.id === edgeId)
  const source = model.nodes.find((node) => node.id === edge?.source)
  const target = model.nodes.find((node) => node.id === edge?.target)
  if (!edge || !source || !target || source.id === target.id) return { model, index: -1 }
  const route = edgeRoute(model.kind, edge, source, target)
  let best = 0
  let bestDistance = Infinity
  for (let segment = 0; segment < route.length - 1; segment += 1) {
    const distance = distanceToSegment(point, route[segment], route[segment + 1])
    if (distance < bestDistance) {
      bestDistance = distance
      best = segment
    }
  }
  const points = [...(edge.points ?? [])]
  points.splice(best, 0, { x: snap(point.x), y: snap(point.y) })
  return { model: updateEdge(model, edgeId, { points }), index: best }
}

export function moveBend(model: GraphModel, edgeId: string, index: number, point: Point): GraphModel {
  const edge = model.edges.find((item) => item.id === edgeId)
  if (!edge?.points?.[index]) return model
  const points = edge.points.map((item, position) => (position === index ? { x: snap(point.x), y: snap(point.y) } : item))
  return updateEdge(model, edgeId, { points })
}

export function removeBend(model: GraphModel, edgeId: string, index: number): GraphModel {
  const edge = model.edges.find((item) => item.id === edgeId)
  if (!edge?.points) return model
  const points = edge.points.filter((_, position) => position !== index)
  return updateEdge(model, edgeId, { points: points.length ? points : undefined })
}

// --- Secuencia ----------------------------------------------------------------------

export function addParticipant(model: SequenceModel, type: ParticipantType, index = model.participants.length): { model: SequenceModel; id: string } {
  const id = nextId('p', model.participants.map((participant) => participant.id))
  const name = defaultName(PARTICIPANT_LABELS[type].split(' ')[0], model.participants.map((participant) => participant.name))
  const participants = [...model.participants]
  participants.splice(Math.max(0, Math.min(index, participants.length)), 0, { id, type, name })
  return { model: { ...model, participants }, id }
}

function moveItem<T>(items: T[], from: number, to: number) {
  const result = [...items]
  const [item] = result.splice(from, 1)
  result.splice(Math.max(0, Math.min(to, result.length)), 0, item)
  return result
}

export function moveParticipant(model: SequenceModel, id: string, toIndex: number): SequenceModel {
  const from = model.participants.findIndex((participant) => participant.id === id)
  return from < 0 ? model : { ...model, participants: moveItem(model.participants, from, toIndex) }
}

export function deleteParticipant(model: SequenceModel, id: string): SequenceModel {
  return {
    ...model,
    participants: model.participants.filter((participant) => participant.id !== id),
    messages: model.messages.filter((message) => message.from !== id && message.to !== id),
  }
}

export function addMessage(
  model: SequenceModel,
  from: string,
  to: string,
  type: MessageType,
  index = model.messages.length,
): { model: SequenceModel; id: string } {
  const id = nextId('m', model.messages.map((message) => message.id))
  const messages = [...model.messages]
  messages.splice(Math.max(0, Math.min(index, messages.length)), 0, { id, from, to, type, label: type === 'reply' ? 'respuesta' : 'mensaje' })
  return { model: { ...model, messages }, id }
}

/** Fila de PlantUML libre (alt, loop, nota, división…) en la posición indicada. */
export function addRawRow(model: SequenceModel, text: string, index = model.messages.length): { model: SequenceModel; id: string } {
  const id = nextId('m', model.messages.map((message) => message.id))
  const messages = [...model.messages]
  messages.splice(Math.max(0, Math.min(index, messages.length)), 0, { id, from: '', to: '', type: 'sync', label: '', raw: text })
  return { model: { ...model, messages }, id }
}

export function moveMessage(model: SequenceModel, id: string, toIndex: number): SequenceModel {
  const from = model.messages.findIndex((message) => message.id === id)
  return from < 0 ? model : { ...model, messages: moveItem(model.messages, from, toIndex) }
}

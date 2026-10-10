import { containerMap, nodeRect, nodeSize, snap, type Point } from './geometry'
import {
  NODE_LABELS,
  PARTICIPANT_LABELS,
  isContainer,
  nextId,
  type EdgeType,
  type GraphEdge,
  type GraphModel,
  type GraphNode,
  type MessageType,
  type NodeType,
  type ParticipantType,
  type SequenceModel,
} from './visualModel'

// --- Grafo (casos de uso y clases) -------------------------------------------

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
 * Agrega un elemento centrado en `point` (coordenadas del lienzo). Con
 * `avoidOverlap` busca el hueco libre más cercano (agregar con clic en la
 * paleta); al soltarlo con el mouse se respeta el punto exacto.
 */
export function addNode(model: GraphModel, type: NodeType, point: Point, avoidOverlap = false): { model: GraphModel; id: string } {
  const id = nextId('n', model.nodes.map((node) => node.id))
  const draft: GraphNode = {
    id,
    type,
    name: defaultName(type === 'note' ? 'Nota' : NODE_LABELS[type], model.nodes.map((node) => node.name)),
    x: 0,
    y: 0,
    ...(isContainer(type) ? { width: type === 'boundary' ? 360 : 340, height: 260 } : {}),
    ...(type === 'enum' ? { attributes: ['VALOR_1', 'VALOR_2'] } : {}),
    ...(['class', 'abstract'].includes(type) ? { attributes: ['- atributo: Tipo'], methods: ['+ operacion(): void'] } : {}),
    ...(type === 'interface' ? { methods: ['+ operacion(): void'] } : {}),
  }
  const size = nodeSize(draft)
  let node = { ...draft, x: snap(point.x - size.width / 2), y: snap(point.y - size.height / 2) }
  if (avoidOverlap && !isContainer(type)) {
    const others = model.nodes.filter((item) => !isContainer(item.type)).map(nodeRect)
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
  const nodes = isContainer(type) ? [node, ...model.nodes] : [...model.nodes, node]
  return { model: { ...model, nodes }, id }
}

/** Ids de lo que está dentro de un contenedor (a cualquier profundidad). */
export function descendantsOf(model: GraphModel, id: string): string[] {
  const parents = containerMap(model.nodes)
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

/** Mueve elementos desde sus posiciones originales (arrastre), ajustando a la grilla. */
export function moveNodes(model: GraphModel, origins: Map<string, Point>, dx: number, dy: number): GraphModel {
  return {
    ...model,
    nodes: model.nodes.map((node) => {
      const origin = origins.get(node.id)
      return origin ? { ...node, x: snap(origin.x + dx), y: snap(origin.y + dy) } : node
    }),
  }
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
 * contenedores no se conectan; no se duplica la misma relación.
 */
export function addEdge(model: GraphModel, type: EdgeType, source: string, target: string): { model: GraphModel; id: string | null } {
  const from = model.nodes.find((node) => node.id === source)
  const to = model.nodes.find((node) => node.id === target)
  if (!from || !to || isContainer(from.type) || isContainer(to.type)) return { model, id: null }
  const resolved: EdgeType = from.type === 'note' || to.type === 'note' ? 'note-link' : type
  if (resolved === 'note-link' && source === target) return { model, id: null }
  // Solo las clases admiten relaciones consigo mismas (asociación recursiva).
  if (source === target && model.kind !== 'class') return { model, id: null }
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
        ? { ...edge, source: edge.target, target: edge.source, sourceLabel: edge.targetLabel, targetLabel: edge.sourceLabel }
        : edge,
    ),
  }
}

export function deleteEdge(model: GraphModel, id: string): GraphModel {
  return { ...model, edges: model.edges.filter((edge) => edge.id !== id) }
}

// --- Secuencia -----------------------------------------------------------------

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

export function moveMessage(model: SequenceModel, id: string, toIndex: number): SequenceModel {
  const from = model.messages.findIndex((message) => message.id === id)
  return from < 0 ? model : { ...model, messages: moveItem(model.messages, from, toIndex) }
}

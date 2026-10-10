/**
 * Modelo de los diagramas visuales (arrastrar y soltar). Es la fuente de
 * verdad: el PlantUML se genera a partir de él (ver generatePlantUml).
 * Se guarda tal cual en board_diagrams.model.
 */
export type VisualKind = 'usecase' | 'class' | 'sequence'

// --- Diagramas de grafo: casos de uso y clases --------------------------------

export type NodeType =
  | 'actor'
  | 'usecase'
  | 'boundary'
  | 'class'
  | 'abstract'
  | 'interface'
  | 'enum'
  | 'package'
  | 'note'

export type GraphNode = {
  id: string
  type: NodeType
  name: string
  x: number
  y: number
  /** Solo contenedores (límite del sistema, paquete): tamaño elegido por el usuario. */
  width?: number
  height?: number
  stereotype?: string
  /** Atributos (en enum: sus valores), una línea cada uno, p. ej. «- id: UUID». */
  attributes?: string[]
  /** Métodos, p. ej. «+ login(clave: String): boolean». */
  methods?: string[]
}

export type EdgeType =
  | 'association'
  | 'directed'
  | 'include'
  | 'extend'
  | 'generalization'
  | 'realization'
  | 'dependency'
  | 'aggregation'
  | 'composition'
  | 'note-link'

export type GraphEdge = {
  id: string
  type: EdgeType
  /** Generalización/realización: source es el hijo; agregación/composición: source es el todo. */
  source: string
  target: string
  label?: string
  /** Multiplicidad o rol en cada extremo (clases). */
  sourceLabel?: string
  targetLabel?: string
}

export type GraphModel = {
  kind: 'usecase' | 'class'
  version: 1
  direction: 'top-to-bottom' | 'left-to-right'
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// --- Diagrama de secuencia ----------------------------------------------------

export type ParticipantType = 'actor' | 'participant' | 'boundary' | 'control' | 'entity' | 'database'

export type Participant = { id: string; type: ParticipantType; name: string }

export type MessageType = 'sync' | 'async' | 'reply'

export type Message = { id: string; from: string; to: string; label: string; type: MessageType }

export type SequenceModel = {
  kind: 'sequence'
  version: 1
  autonumber: boolean
  /** El orden del arreglo es el orden de izquierda a derecha. */
  participants: Participant[]
  /** El orden del arreglo es el orden en el tiempo (de arriba hacia abajo). */
  messages: Message[]
}

export type VisualModel = GraphModel | SequenceModel

// --- Catálogos por tipo de diagrama -------------------------------------------

export const NODE_LABELS: Record<NodeType, string> = {
  actor: 'Actor',
  usecase: 'Caso de uso',
  boundary: 'Límite del sistema',
  class: 'Clase',
  abstract: 'Clase abstracta',
  interface: 'Interfaz',
  enum: 'Enumeración',
  package: 'Paquete',
  note: 'Nota',
}

export const EDGE_LABELS: Record<EdgeType, string> = {
  association: 'Asociación',
  directed: 'Asociación dirigida',
  include: 'Include',
  extend: 'Extend',
  generalization: 'Generalización (herencia)',
  realization: 'Realización (implementa)',
  dependency: 'Dependencia',
  aggregation: 'Agregación',
  composition: 'Composición',
  'note-link': 'Enlace de nota',
}

export const PARTICIPANT_LABELS: Record<ParticipantType, string> = {
  actor: 'Actor',
  participant: 'Participante',
  boundary: 'Boundary (interfaz)',
  control: 'Control',
  entity: 'Entity',
  database: 'Base de datos',
}

export const MESSAGE_LABELS: Record<MessageType, string> = {
  sync: 'Síncrono',
  async: 'Asíncrono',
  reply: 'Respuesta',
}

export const PALETTE: Record<'usecase' | 'class', { nodes: NodeType[]; edges: EdgeType[] }> = {
  usecase: { nodes: ['actor', 'usecase', 'boundary', 'note'], edges: ['association', 'include', 'extend', 'generalization'] },
  class: {
    nodes: ['class', 'abstract', 'interface', 'enum', 'package', 'note'],
    edges: ['association', 'directed', 'generalization', 'realization', 'dependency', 'aggregation', 'composition'],
  },
}

export const CONTAINER_TYPES: NodeType[] = ['boundary', 'package']
export const isContainer = (type: NodeType) => CONTAINER_TYPES.includes(type)

/** Nuevo id corto y único dentro del modelo (sirve también como alias en PlantUML). */
export function nextId(prefix: 'n' | 'e' | 'p' | 'm', usedIds: Iterable<string>) {
  let max = 0
  for (const id of usedIds) {
    const match = new RegExp(`^${prefix}(\\d+)$`).exec(id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `${prefix}${max + 1}`
}

export function isVisualKind(kind: string): kind is VisualKind {
  return kind === 'usecase' || kind === 'class' || kind === 'sequence'
}

/** Modelo vacío o con un ejemplo pequeño para empezar. */
export function initialModel(kind: VisualKind, withExample: boolean): VisualModel {
  if (kind === 'sequence') {
    if (!withExample) return { kind, version: 1, autonumber: false, participants: [], messages: [] }
    return {
      kind,
      version: 1,
      autonumber: false,
      participants: [
        { id: 'p1', type: 'actor', name: 'Usuario' },
        { id: 'p2', type: 'boundary', name: 'Aplicación' },
        { id: 'p3', type: 'control', name: 'API' },
        { id: 'p4', type: 'database', name: 'Base de datos' },
      ],
      messages: [
        { id: 'm1', from: 'p1', to: 'p2', label: 'Ingresa credenciales', type: 'sync' },
        { id: 'm2', from: 'p2', to: 'p3', label: 'POST /login', type: 'sync' },
        { id: 'm3', from: 'p3', to: 'p4', label: 'Buscar usuario', type: 'sync' },
        { id: 'm4', from: 'p4', to: 'p3', label: 'Usuario', type: 'reply' },
        { id: 'm5', from: 'p3', to: 'p2', label: '200 + token', type: 'reply' },
        { id: 'm6', from: 'p2', to: 'p1', label: 'Muestra el tablero', type: 'reply' },
      ],
    }
  }
  if (!withExample) return { kind, version: 1, direction: kind === 'usecase' ? 'left-to-right' : 'top-to-bottom', nodes: [], edges: [] }
  if (kind === 'usecase') {
    return {
      kind,
      version: 1,
      direction: 'left-to-right',
      nodes: [
        { id: 'n1', type: 'actor', name: 'Cliente', x: 60, y: 120 },
        { id: 'n2', type: 'actor', name: 'Administrador', x: 60, y: 300 },
        { id: 'n3', type: 'boundary', name: 'Tienda en línea', x: 220, y: 60, width: 420, height: 340 },
        { id: 'n4', type: 'usecase', name: 'Buscar producto', x: 270, y: 110 },
        { id: 'n5', type: 'usecase', name: 'Comprar', x: 270, y: 200 },
        { id: 'n6', type: 'usecase', name: 'Pagar', x: 470, y: 200 },
        { id: 'n7', type: 'usecase', name: 'Gestionar catálogo', x: 270, y: 310 },
      ],
      edges: [
        { id: 'e1', type: 'association', source: 'n1', target: 'n4' },
        { id: 'e2', type: 'association', source: 'n1', target: 'n5' },
        { id: 'e3', type: 'include', source: 'n5', target: 'n6' },
        { id: 'e4', type: 'association', source: 'n2', target: 'n7' },
      ],
    }
  }
  return {
    kind,
    version: 1,
    direction: 'top-to-bottom',
    nodes: [
      { id: 'n1', type: 'class', name: 'Usuario', x: 80, y: 60, attributes: ['- id: UUID', '- email: String'], methods: ['+ iniciarSesion(clave: String): boolean'] },
      { id: 'n2', type: 'class', name: 'Tablero', x: 420, y: 60, attributes: ['- nombre: String'], methods: ['+ agregarTarea(t: Tarea)'] },
      { id: 'n3', type: 'class', name: 'Tarea', x: 420, y: 260, attributes: ['- titulo: String', '- prioridad: Prioridad'] },
      { id: 'n4', type: 'enum', name: 'Prioridad', x: 120, y: 280, attributes: ['ALTA', 'MEDIA', 'BAJA'] },
    ],
    edges: [
      { id: 'e1', type: 'association', source: 'n1', target: 'n2', label: 'posee', sourceLabel: '1', targetLabel: '*' },
      { id: 'e2', type: 'composition', source: 'n2', target: 'n3', sourceLabel: '1', targetLabel: '*' },
      { id: 'e3', type: 'directed', source: 'n3', target: 'n4' },
    ],
  }
}

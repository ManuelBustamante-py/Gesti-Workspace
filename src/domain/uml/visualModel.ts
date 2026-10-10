/**
 * Modelo de los diagramas visuales. Es la fuente de verdad del lienzo: el
 * PlantUML se genera a partir de él (generatePlantUml) y se puede volver a
 * construir desde PlantUML (parsePlantUml). Se guarda en board_diagrams.model,
 * también cuando el diagrama está en modo código (así se conservan posiciones).
 */
import { nextId } from './ids'
import { isGraphKind, kindSpec, nodeSpec } from './kinds'
import { emptyStructured, isStructuredKind, structuredFromRaw, type StructuredModel } from './structured'

export { nextId }
export type { StructuredModel }

export type Point = { x: number; y: number }

// --- Diagramas de grafo (casos de uso, clases, componentes, estados…) ----------

export type GraphNode = {
  id: string
  /** Tipo según el registro del diagrama (kinds.ts): class, actor, state… */
  type: string
  name: string
  x: number
  y: number
  /** Solo contenedores: tamaño elegido por el usuario. */
  width?: number
  height?: number
  stereotype?: string
  /** Atributos, campos o valores (una línea cada uno). */
  attributes?: string[]
  /** Métodos (solo en clases). */
  methods?: string[]
}

export type GraphEdge = {
  id: string
  type: string
  /** Generalización/realización: source es el hijo; agregación/composición: source es el todo. */
  source: string
  target: string
  label?: string
  /** Multiplicidad (clases) o cardinalidad (1, 0..1, 1..*, 0..*) en cada extremo. */
  sourceLabel?: string
  targetLabel?: string
  /** Puntos de quiebre (codos) de la línea, en coordenadas del lienzo. */
  points?: Point[]
}

export type GraphModel = {
  kind: string
  version: 1
  direction: 'top-to-bottom' | 'left-to-right'
  /** auto: PlantUML distribuye solo · canvas: se le indican direcciones según el lienzo. */
  layout?: 'auto' | 'canvas'
  title?: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Líneas de PlantUML que el editor no interpreta (skinparam, etc.): se conservan tal cual. */
  extra?: string[]
}

// --- Diagrama de secuencia -------------------------------------------------------

export type ParticipantType = 'actor' | 'participant' | 'boundary' | 'control' | 'entity' | 'database' | 'collections' | 'queue'

export type Participant = { id: string; type: ParticipantType; name: string }

export type MessageType = 'sync' | 'async' | 'reply'

export type Message = {
  id: string
  from: string
  to: string
  label: string
  type: MessageType
  /**
   * Fila de PlantUML que no es un mensaje (alt/else/end, loop, notas, activate,
   * divisores…): se conserva en su posición y se edita como texto.
   */
  raw?: string
}

export type SequenceModel = {
  kind: 'sequence'
  version: 1
  autonumber: boolean
  title?: string
  /** El orden del arreglo es el orden de izquierda a derecha. */
  participants: Participant[]
  /** El orden del arreglo es el orden en el tiempo (de arriba hacia abajo). */
  messages: Message[]
  extra?: string[]
}

/** Modelos con lienzo de arrastrar y soltar. */
export type CanvasModel = GraphModel | SequenceModel
/** Todos los modelos visuales: lienzo o editor estructurado (mapa mental, Gantt, red, tiempos, wireframe). */
export type VisualModel = CanvasModel | StructuredModel

export const PARTICIPANT_LABELS: Record<ParticipantType, string> = {
  actor: 'Actor',
  participant: 'Participante',
  boundary: 'Boundary (interfaz)',
  control: 'Control',
  entity: 'Entity',
  database: 'Base de datos',
  collections: 'Colección',
  queue: 'Cola',
}

export const MESSAGE_LABELS: Record<MessageType, string> = {
  sync: 'Síncrono',
  async: 'Asíncrono',
  reply: 'Respuesta',
}

export const isGraphModel = (model: VisualModel): model is GraphModel => model.kind !== 'sequence' && !isStructuredKind(model.kind)
export const isCanvasModel = (model: VisualModel): model is CanvasModel => !isStructuredKind(model.kind)

export function isContainer(kind: string, type: string) {
  return Boolean(nodeSpec(kind, type).container)
}

/** Tipos con editor visual: lienzo (grafo o secuencia) o editor estructurado. */
export function isVisualKind(kind: string) {
  return kind === 'sequence' || isGraphKind(kind) || isStructuredKind(kind)
}

/** Modelo guardado de un diagrama, o uno vacío si no corresponde al tipo (datos dañados o de otra versión). */
export function modelFromDiagram(kind: string, raw: unknown): VisualModel {
  if (isStructuredKind(kind)) return structuredFromRaw(kind, raw) ?? emptyStructured(kind)
  const value = raw as Partial<CanvasModel> | null
  if (value && value.kind === kind) {
    if (kind === 'sequence' && Array.isArray((value as SequenceModel).participants) && Array.isArray((value as SequenceModel).messages)) return value as VisualModel
    if (kind !== 'sequence' && Array.isArray((value as GraphModel).nodes) && Array.isArray((value as GraphModel).edges)) return value as VisualModel
  }
  return emptyModel(kind)
}

export function emptyModel(kind: string): VisualModel {
  if (isStructuredKind(kind)) return emptyStructured(kind)
  if (kind === 'sequence') return { kind, version: 1, autonumber: false, participants: [], messages: [] }
  return { kind, version: 1, direction: kindSpec(kind)?.defaultDirection ?? 'top-to-bottom', layout: 'canvas', nodes: [], edges: [] }
}

/** Ejemplos dibujados a mano para los tipos más usados (el resto se arma desde su plantilla). */
export function handmadeExample(kind: string): VisualModel | null {
  if (kind === 'sequence') {
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
  if (kind === 'usecase') {
    return {
      kind,
      version: 1,
      direction: 'left-to-right',
      layout: 'canvas',
      nodes: [
        { id: 'n3', type: 'boundary', name: 'Tienda en línea', x: 220, y: 60, width: 420, height: 340 },
        { id: 'n1', type: 'actor', name: 'Cliente', x: 60, y: 120 },
        { id: 'n2', type: 'actor', name: 'Administrador', x: 60, y: 300 },
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
  if (kind === 'class') {
    return {
      kind,
      version: 1,
      direction: 'top-to-bottom',
      layout: 'canvas',
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
  return null
}

/**
 * Registro de los diagramas de grafo con editor visual. Cada tipo declara sus
 * elementos (figura en el lienzo, palabra clave de PlantUML, si contiene a
 * otros, si tiene atributos) y sus relaciones (flecha de PlantUML, trazo y
 * puntas en el lienzo). El lienzo, el generador, el parser y el panel de
 * propiedades leen este registro: agregar un tipo es, sobre todo, configurarlo.
 */

export type ShapeKind =
  | 'actor'
  | 'ellipse'
  | 'rect'
  | 'round'
  | 'classbox'
  | 'note'
  | 'database'
  | 'cloud'
  | 'node3d'
  | 'component'
  | 'lollipop'
  | 'artifact'
  | 'queue'
  | 'storage'
  | 'initial'
  | 'final'
  | 'choice'
  | 'bar'
  | 'port'
  | 'archimate'
  | 'container-rect'
  | 'container-folder'
  | 'container-node'
  | 'container-cloud'
  | 'container-frame'
  | 'container-round'
  | 'container-component'

/** Qué tipo de diagrama de PlantUML genera el tipo: decide reglas de sintaxis. */
export type Syntax = 'description' | 'class' | 'state'

export type NodeSpec = {
  type: string
  label: string
  icon: string
  shape: ShapeKind
  /** Palabra clave de PlantUML (class, component, state…). */
  keyword: string
  container?: boolean
  /** class: atributos y métodos · fields: una sola lista (campos, valores, slots). */
  members?: 'class' | 'fields'
  /** Estereotipo fijo con el que se declara (C4, SysML, nube…). */
  stereotype?: string
  /** Estereotipo que se muestra dentro de la figura del lienzo. */
  badge?: string
  /** Pseudoestados: no llevan nombre visible. */
  pseudo?: 'initial' | 'final' | 'choice' | 'fork' | 'join'
  /** Color de relleno en el lienzo y en PlantUML (ArchiMate, BPMN). */
  color?: string
  /** Elementos intercambiables entre sí en el panel de propiedades. */
  group?: string
  defaultName: string
  defaultMembers?: { attributes?: string[]; methods?: string[] }
}

export type EdgeSpec = {
  type: string
  label: string
  /** Flecha de PlantUML entre los dos extremos (sin dirección). */
  arrow: string
  dashed?: boolean
  start?: 'diamond' | 'diamond-filled'
  end?: 'open' | 'triangle' | 'filled'
  /** Texto fijo de la relación («include», «satisfy»…). */
  fixedText?: string
  /** Extremos con multiplicidad (clases) o cardinalidad (entidad-relación). */
  ends?: 'multiplicity' | 'cardinality'
}

export type KindSpec = {
  kind: string
  syntax: Syntax
  /** Directivas obligatorias tras @startuml (allowmixing, hide empty members…). */
  directives?: string[]
  defaultDirection: 'top-to-bottom' | 'left-to-right'
  nodes: NodeSpec[]
  edges: EdgeSpec[]
  /** Relación por defecto al conectar. */
  defaultEdge: string
  /** Nombre del contenedor en las ayudas («límite del sistema», «paquete»…). */
  containerHint?: string
}

// --- Relaciones reutilizables -------------------------------------------------

const E = {
  association: { type: 'association', label: 'Asociación', arrow: '--' },
  directed: { type: 'directed', label: 'Asociación dirigida', arrow: '-->', end: 'open' },
  include: { type: 'include', label: 'Include', arrow: '..>', dashed: true, end: 'open', fixedText: 'include' },
  extend: { type: 'extend', label: 'Extend', arrow: '..>', dashed: true, end: 'open', fixedText: 'extend' },
  generalization: { type: 'generalization', label: 'Generalización (herencia)', arrow: '--|>', end: 'triangle' },
  realization: { type: 'realization', label: 'Realización (implementa)', arrow: '..|>', dashed: true, end: 'triangle' },
  dependency: { type: 'dependency', label: 'Dependencia', arrow: '..>', dashed: true, end: 'open' },
  aggregation: { type: 'aggregation', label: 'Agregación', arrow: 'o--', start: 'diamond' },
  composition: { type: 'composition', label: 'Composición', arrow: '*--', start: 'diamond-filled' },
  flow: { type: 'flow', label: 'Flujo / transición', arrow: '-->', end: 'open' },
  link: { type: 'link', label: 'Conexión', arrow: '--' },
  message: { type: 'message', label: 'Mensaje (con número)', arrow: '--' },
  er: { type: 'er', label: 'Relación', arrow: '--', ends: 'cardinality' },
} satisfies Record<string, EdgeSpec>

const withMultiplicity = (spec: EdgeSpec): EdgeSpec => ({ ...spec, ends: 'multiplicity' })
const fixed = (type: string, text: string): EdgeSpec => ({ type, label: `«${text}»`, arrow: '..>', dashed: true, end: 'open', fixedText: text })

// --- Elementos reutilizables --------------------------------------------------

const note: NodeSpec = { type: 'note', label: 'Nota', icon: '✎', shape: 'note', keyword: 'note', defaultName: 'Nota' }
const actor: NodeSpec = { type: 'actor', label: 'Actor', icon: '웃', shape: 'actor', keyword: 'actor', defaultName: 'Actor' }
const database: NodeSpec = { type: 'database', label: 'Base de datos', icon: '⛁', shape: 'database', keyword: 'database', defaultName: 'Base de datos' }
const packageContainer: NodeSpec = { type: 'package', label: 'Paquete', icon: '▱', shape: 'container-folder', keyword: 'package', container: true, defaultName: 'Paquete' }

const pseudo = (kindLabel: 'Inicio' | 'Fin'): NodeSpec =>
  kindLabel === 'Inicio'
    ? { type: 'initial', label: 'Inicio', icon: '●', shape: 'initial', keyword: '[*]', pseudo: 'initial', defaultName: 'Inicio' }
    : { type: 'final', label: 'Fin', icon: '◉', shape: 'final', keyword: '[*]', pseudo: 'final', defaultName: 'Fin' }
const choice = (label: string): NodeSpec => ({ type: 'choice', label, icon: '◇', shape: 'choice', keyword: 'state', pseudo: 'choice', defaultName: label })
const fork: NodeSpec = { type: 'fork', label: 'Bifurcación (fork)', icon: '┳', shape: 'bar', keyword: 'state', pseudo: 'fork', group: 'bar', defaultName: 'fork' }
const join: NodeSpec = { type: 'join', label: 'Unión (join)', icon: '┻', shape: 'bar', keyword: 'state', pseudo: 'join', group: 'bar', defaultName: 'join' }
const action = (label: string, defaultName: string): NodeSpec => ({ type: 'action', label, icon: '▢', shape: 'round', keyword: 'state', defaultName })
const lane = (label: string): NodeSpec => ({ type: 'lane', label, icon: '▥', shape: 'container-round', keyword: 'state', container: true, defaultName: label })

const archimate = (type: string, label: string, layer: 'Business' | 'Application' | 'Technology', stereotype: string, color: string): NodeSpec => ({
  type, label, icon: layer[0], shape: 'archimate', keyword: `archimate #${layer}`, stereotype, badge: label, color, group: 'archimate', defaultName: label,
})

// --- Tipos de diagrama -----------------------------------------------------------

export const KIND_SPECS: KindSpec[] = [
  {
    kind: 'usecase', syntax: 'description', defaultDirection: 'left-to-right', defaultEdge: 'association', containerHint: 'límite del sistema',
    nodes: [
      { ...actor, group: 'usecase' },
      { type: 'usecase', label: 'Caso de uso', icon: '◯', shape: 'ellipse', keyword: 'usecase', group: 'usecase', defaultName: 'Caso de uso' },
      { type: 'boundary', label: 'Límite del sistema', icon: '▭', shape: 'container-rect', keyword: 'rectangle', container: true, defaultName: 'Sistema' },
      note,
    ],
    edges: [E.association, E.include, E.extend, E.generalization, E.directed],
  },
  {
    kind: 'class', syntax: 'class', directives: ['hide empty members'], defaultDirection: 'top-to-bottom', defaultEdge: 'association', containerHint: 'paquete',
    nodes: [
      { type: 'class', label: 'Clase', icon: '▤', shape: 'classbox', keyword: 'class', members: 'class', group: 'class', defaultName: 'Clase', defaultMembers: { attributes: ['- atributo: Tipo'], methods: ['+ operacion(): void'] } },
      { type: 'abstract', label: 'Clase abstracta', icon: '▤', shape: 'classbox', keyword: 'abstract class', badge: 'abstract', members: 'class', group: 'class', defaultName: 'ClaseAbstracta', defaultMembers: { methods: ['+ {abstract} operacion(): void'] } },
      { type: 'interface', label: 'Interfaz', icon: '◌', shape: 'classbox', keyword: 'interface', badge: 'interface', members: 'class', group: 'class', defaultName: 'Interfaz', defaultMembers: { methods: ['+ operacion(): void'] } },
      { type: 'enum', label: 'Enumeración', icon: '≡', shape: 'classbox', keyword: 'enum', badge: 'enumeration', members: 'fields', group: 'class', defaultName: 'Enumeracion', defaultMembers: { attributes: ['VALOR_1', 'VALOR_2'] } },
      packageContainer,
      note,
    ],
    edges: [withMultiplicity(E.association), withMultiplicity(E.directed), E.generalization, E.realization, E.dependency, withMultiplicity(E.aggregation), withMultiplicity(E.composition)],
  },
  {
    kind: 'object', syntax: 'class', defaultDirection: 'top-to-bottom', defaultEdge: 'association', containerHint: 'paquete',
    nodes: [
      { type: 'object', label: 'Objeto', icon: '▣', shape: 'classbox', keyword: 'object', members: 'fields', defaultName: 'objeto : Clase', defaultMembers: { attributes: ['atributo = valor'] } },
      packageContainer,
      note,
    ],
    edges: [E.association, E.directed, withMultiplicity(E.aggregation), withMultiplicity(E.composition), E.dependency],
  },
  {
    kind: 'component', syntax: 'description', defaultDirection: 'top-to-bottom', defaultEdge: 'directed', containerHint: 'paquete o nodo',
    nodes: [
      { type: 'component', label: 'Componente', icon: '⧉', shape: 'component', keyword: 'component', defaultName: 'Componente' },
      { type: 'interface', label: 'Interfaz', icon: '○', shape: 'lollipop', keyword: 'interface', defaultName: 'Interfaz' },
      { ...database },
      { type: 'queue', label: 'Cola', icon: '⇶', shape: 'queue', keyword: 'queue', defaultName: 'Cola' },
      packageContainer,
      { type: 'node', label: 'Nodo', icon: '⬚', shape: 'container-node', keyword: 'node', container: true, defaultName: 'Nodo' },
      { type: 'cloud', label: 'Nube', icon: '☁', shape: 'container-cloud', keyword: 'cloud', container: true, defaultName: 'Nube' },
      note,
    ],
    edges: [E.directed, E.dependency, E.link, E.realization],
  },
  {
    kind: 'deployment', syntax: 'description', defaultDirection: 'top-to-bottom', defaultEdge: 'link', containerHint: 'nodo o nube',
    nodes: [
      { type: 'node', label: 'Nodo', icon: '⬚', shape: 'container-node', keyword: 'node', container: true, defaultName: 'Servidor' },
      { type: 'device', label: 'Dispositivo', icon: '▭', shape: 'container-node', keyword: 'node', stereotype: 'device', container: true, defaultName: 'Dispositivo' },
      { type: 'cloud', label: 'Nube', icon: '☁', shape: 'container-cloud', keyword: 'cloud', container: true, defaultName: 'Nube' },
      { type: 'artifact', label: 'Artefacto', icon: '🗎', shape: 'artifact', keyword: 'artifact', defaultName: 'app.jar' },
      { type: 'component', label: 'Componente', icon: '⧉', shape: 'component', keyword: 'component', defaultName: 'Componente' },
      { ...database },
      actor,
      note,
    ],
    edges: [E.link, E.directed, E.dependency],
  },
  {
    kind: 'package', syntax: 'class', defaultDirection: 'top-to-bottom', defaultEdge: 'dependency', containerHint: 'paquete',
    nodes: [
      packageContainer,
      { type: 'class', label: 'Clase', icon: '▤', shape: 'classbox', keyword: 'class', members: 'class', defaultName: 'Clase' },
      { type: 'interface', label: 'Interfaz', icon: '◌', shape: 'classbox', keyword: 'interface', badge: 'interface', members: 'class', defaultName: 'Interfaz' },
      note,
    ],
    edges: [E.dependency, fixed('use', 'use'), fixed('import', 'import'), fixed('access', 'access'), E.generalization],
  },
  {
    kind: 'composite', syntax: 'description', defaultDirection: 'left-to-right', defaultEdge: 'directed', containerHint: 'componente contenedor',
    nodes: [
      { type: 'structure', label: 'Clasificador (contenedor)', icon: '⧉', shape: 'container-component', keyword: 'component', container: true, defaultName: 'Sistema' },
      { type: 'part', label: 'Parte', icon: '▭', shape: 'component', keyword: 'component', defaultName: 'parte : Tipo' },
      { type: 'portin', label: 'Puerto de entrada', icon: '▫', shape: 'port', keyword: 'portin', group: 'port', defaultName: 'entrada' },
      { type: 'portout', label: 'Puerto de salida', icon: '▪', shape: 'port', keyword: 'portout', group: 'port', defaultName: 'salida' },
      note,
    ],
    edges: [E.directed, E.link],
  },
  {
    kind: 'profile', syntax: 'class', defaultDirection: 'top-to-bottom', defaultEdge: 'extension', containerHint: 'perfil',
    nodes: [
      { type: 'profile', label: 'Perfil', icon: '▱', shape: 'container-folder', keyword: 'package', stereotype: 'profile', container: true, defaultName: 'Perfil' },
      { type: 'metaclass', label: 'Metaclase', icon: 'M', shape: 'classbox', keyword: 'metaclass', badge: 'metaclass', members: 'class', defaultName: 'Class' },
      { type: 'stereotype', label: 'Estereotipo', icon: 'S', shape: 'classbox', keyword: 'stereotype', badge: 'stereotype', members: 'fields', defaultName: 'Estereotipo', defaultMembers: { attributes: ['etiqueta: String'] } },
      note,
    ],
    edges: [{ type: 'extension', label: 'Extensión', arrow: '--|>', end: 'triangle', fixedText: 'extension' }, E.generalization, E.dependency],
  },
  {
    kind: 'communication', syntax: 'description', defaultDirection: 'left-to-right', defaultEdge: 'message',
    nodes: [
      { type: 'lifeline', label: 'Objeto', icon: '▭', shape: 'rect', keyword: 'rectangle', defaultName: ':Objeto' },
      actor,
      note,
    ],
    edges: [E.message],
  },
  {
    kind: 'state', syntax: 'state', defaultDirection: 'top-to-bottom', defaultEdge: 'flow', containerHint: 'estado compuesto',
    nodes: [
      pseudo('Inicio'),
      { type: 'state', label: 'Estado', icon: '▢', shape: 'round', keyword: 'state', defaultName: 'Estado' },
      { type: 'composite', label: 'Estado compuesto', icon: '▣', shape: 'container-round', keyword: 'state', container: true, defaultName: 'Compuesto' },
      choice('Decisión'),
      fork,
      join,
      pseudo('Fin'),
      note,
    ],
    edges: [E.flow],
  },
  {
    kind: 'activity', syntax: 'state', defaultDirection: 'top-to-bottom', defaultEdge: 'flow', containerHint: 'carril',
    nodes: [pseudo('Inicio'), action('Acción', 'Acción'), choice('Decisión'), fork, join, lane('Carril (partición)'), pseudo('Fin'), note],
    edges: [E.flow],
  },
  {
    kind: 'flowchart', syntax: 'state', defaultDirection: 'top-to-bottom', defaultEdge: 'flow', containerHint: 'grupo',
    nodes: [pseudo('Inicio'), action('Proceso', 'Proceso'), choice('Decisión'), lane('Grupo'), pseudo('Fin'), note],
    edges: [E.flow],
  },
  {
    kind: 'interaction-overview', syntax: 'state', defaultDirection: 'top-to-bottom', defaultEdge: 'flow',
    nodes: [pseudo('Inicio'), action('Interacción (ref)', 'ref: Interacción'), choice('Decisión'), fork, join, pseudo('Fin'), note],
    edges: [E.flow],
  },
  {
    kind: 'bpmn', syntax: 'state', defaultDirection: 'left-to-right', defaultEdge: 'flow', containerHint: 'carril',
    nodes: [
      { ...pseudo('Inicio'), label: 'Evento de inicio' },
      { ...action('Tarea', 'Tarea'), color: '#e8f1fb' },
      { ...choice('Compuerta exclusiva') },
      { ...fork, label: 'Compuerta paralela (abre)' },
      { ...join, label: 'Compuerta paralela (cierra)' },
      lane('Carril (participante)'),
      { ...pseudo('Fin'), label: 'Evento de fin' },
      note,
    ],
    edges: [E.flow],
  },
  {
    kind: 'dfd', syntax: 'description', defaultDirection: 'left-to-right', defaultEdge: 'directed', containerHint: 'límite',
    nodes: [
      { type: 'external', label: 'Entidad externa', icon: '▭', shape: 'rect', keyword: 'rectangle', defaultName: 'Entidad' },
      { type: 'process', label: 'Proceso', icon: '◯', shape: 'ellipse', keyword: 'usecase', defaultName: '1.0 Proceso' },
      { type: 'store', label: 'Almacén de datos', icon: '⛁', shape: 'database', keyword: 'database', defaultName: 'D1 Almacén' },
      { type: 'boundary', label: 'Límite', icon: '▭', shape: 'container-rect', keyword: 'rectangle', container: true, defaultName: 'Sistema' },
      note,
    ],
    edges: [{ ...E.directed, label: 'Flujo de datos' }],
  },
  {
    kind: 'er', syntax: 'class', directives: ['hide circle', 'skinparam linetype ortho'], defaultDirection: 'top-to-bottom', defaultEdge: 'er',
    nodes: [
      { type: 'entity', label: 'Entidad (tabla)', icon: '▤', shape: 'classbox', keyword: 'entity', members: 'fields', defaultName: 'tabla', defaultMembers: { attributes: ['* id : uuid <<PK>>', '--', 'nombre : text'] } },
      note,
    ],
    edges: [E.er],
  },
  {
    kind: 'c4', syntax: 'description', defaultDirection: 'top-to-bottom', defaultEdge: 'directed', containerHint: 'límite del sistema',
    nodes: [
      { ...actor, type: 'person', label: 'Persona', stereotype: 'Persona', badge: 'Persona', defaultName: 'Usuario' },
      { type: 'system', label: 'Sistema', icon: '▭', shape: 'rect', keyword: 'rectangle', stereotype: 'Sistema', badge: 'Sistema', group: 'c4', color: '#dbe7f6', defaultName: 'Sistema' },
      { type: 'container', label: 'Contenedor', icon: '▭', shape: 'rect', keyword: 'rectangle', stereotype: 'Contenedor', badge: 'Contenedor', group: 'c4', color: '#e3f1ef', defaultName: 'Aplicación\n[Tecnología]' },
      { type: 'c4database', label: 'Base de datos', icon: '⛁', shape: 'database', keyword: 'database', stereotype: 'Contenedor', badge: 'Contenedor', defaultName: 'Base de datos\n[PostgreSQL]' },
      { type: 'external', label: 'Sistema externo', icon: '▭', shape: 'rect', keyword: 'rectangle', stereotype: 'Sistema externo', badge: 'Sistema externo', group: 'c4', color: '#eceff1', defaultName: 'Sistema externo' },
      { type: 'boundary', label: 'Límite del sistema', icon: '▭', shape: 'container-rect', keyword: 'rectangle', stereotype: 'Sistema', container: true, defaultName: 'Sistema' },
      note,
    ],
    edges: [{ ...E.directed, label: 'Relación (usa)' }, E.link],
  },
  ...(['aws', 'gcp'] as const).map((kind): KindSpec => ({
    kind, syntax: 'description', defaultDirection: 'top-to-bottom', defaultEdge: 'directed', containerHint: kind === 'aws' ? 'nube / VPC' : 'proyecto / red',
    nodes: [
      actor,
      { type: 'cloud', label: kind === 'aws' ? 'Nube / región' : 'Proyecto de Google Cloud', icon: '☁', shape: 'container-cloud', keyword: 'cloud', container: true, defaultName: kind === 'aws' ? 'AWS' : 'Google Cloud' },
      { type: 'network', label: kind === 'aws' ? 'VPC / subred' : 'Red VPC', icon: '▭', shape: 'container-frame', keyword: 'frame', container: true, defaultName: 'VPC' },
      { type: 'compute', label: 'Cómputo', icon: '⬚', shape: 'node3d', keyword: 'node', stereotype: 'Cómputo', badge: kind === 'aws' ? 'EC2 / Lambda' : 'Compute / Run', defaultName: kind === 'aws' ? 'Lambda' : 'Cloud Run' },
      { type: 'storage', label: 'Almacenamiento', icon: '▤', shape: 'storage', keyword: 'storage', stereotype: 'Almacenamiento', badge: kind === 'aws' ? 'S3' : 'Cloud Storage', defaultName: kind === 'aws' ? 'S3' : 'Cloud Storage' },
      { ...database, stereotype: 'Base de datos', badge: kind === 'aws' ? 'RDS / DynamoDB' : 'Cloud SQL', defaultName: kind === 'aws' ? 'RDS' : 'Cloud SQL' },
      { type: 'queue', label: 'Mensajería', icon: '⇶', shape: 'queue', keyword: 'queue', stereotype: 'Mensajería', badge: kind === 'aws' ? 'SQS / SNS' : 'Pub/Sub', defaultName: kind === 'aws' ? 'SQS' : 'Pub/Sub' },
      { type: 'edge', label: 'Red / CDN / API', icon: '⇄', shape: 'rect', keyword: 'rectangle', stereotype: 'Red', badge: kind === 'aws' ? 'CloudFront / API GW' : 'Load Balancing', defaultName: kind === 'aws' ? 'API Gateway' : 'Load Balancer' },
      note,
    ],
    edges: [E.directed, E.link, E.dependency],
  })),
  {
    kind: 'requirement', syntax: 'class', defaultDirection: 'top-to-bottom', defaultEdge: 'satisfy',
    nodes: [
      { type: 'requirement', label: 'Requisito', icon: 'R', shape: 'classbox', keyword: 'class', stereotype: 'requirement', badge: 'requirement', members: 'fields', defaultName: 'REQ-01 Requisito', defaultMembers: { attributes: ['id = "REQ-01"', 'texto = "El sistema debe…"'] } },
      { type: 'block', label: 'Bloque', icon: 'B', shape: 'classbox', keyword: 'class', stereotype: 'block', badge: 'block', members: 'fields', defaultName: 'Bloque' },
      { type: 'testcase', label: 'Caso de prueba', icon: 'T', shape: 'classbox', keyword: 'class', stereotype: 'testCase', badge: 'testCase', members: 'fields', defaultName: 'Prueba' },
      note,
    ],
    edges: [fixed('satisfy', 'satisfy'), fixed('derive', 'deriveReqt'), fixed('verify', 'verify'), fixed('refine', 'refine'), fixed('trace', 'trace'), { ...E.composition, label: 'Contención' }],
  },
  {
    kind: 'block', syntax: 'class', defaultDirection: 'top-to-bottom', defaultEdge: 'composition',
    nodes: [
      { type: 'block', label: 'Bloque', icon: 'B', shape: 'classbox', keyword: 'class', stereotype: 'block', badge: 'block', members: 'fields', defaultName: 'Bloque', defaultMembers: { attributes: ['valor: Unidad'] } },
      { type: 'valuetype', label: 'Tipo de valor', icon: 'V', shape: 'classbox', keyword: 'class', stereotype: 'valueType', badge: 'valueType', members: 'fields', defaultName: 'Unidad' },
      note,
    ],
    edges: [withMultiplicity(E.composition), withMultiplicity(E.aggregation), withMultiplicity(E.association), E.generalization, E.dependency],
  },
  {
    kind: 'archimate', syntax: 'description', defaultDirection: 'top-to-bottom', defaultEdge: 'serving',
    nodes: [
      archimate('business-actor', 'Actor de negocio', 'Business', 'business-actor', '#fff8c4'),
      archimate('business-process', 'Proceso de negocio', 'Business', 'business-process', '#fff8c4'),
      archimate('business-service', 'Servicio de negocio', 'Business', 'business-service', '#fff8c4'),
      archimate('business-object', 'Objeto de negocio', 'Business', 'business-object', '#fff8c4'),
      archimate('application-component', 'Componente de aplicación', 'Application', 'application-component', '#d6f1f7'),
      archimate('application-service', 'Servicio de aplicación', 'Application', 'application-service', '#d6f1f7'),
      archimate('data-object', 'Objeto de datos', 'Application', 'application-data-object', '#d6f1f7'),
      archimate('node', 'Nodo', 'Technology', 'technology-node', '#d9f5d0'),
      archimate('system-software', 'Software de sistema', 'Technology', 'technology-system-software', '#d9f5d0'),
      note,
    ],
    edges: [
      { type: 'serving', label: 'Sirve a', arrow: '-->', end: 'open' },
      { type: 'realization', label: 'Realiza', arrow: '..|>', dashed: true, end: 'triangle' },
      { type: 'assignment', label: 'Asignación', arrow: '--', start: 'diamond-filled' },
      { type: 'triggering', label: 'Desencadena', arrow: '-->', end: 'filled' },
      { type: 'access', label: 'Accede', arrow: '..>', dashed: true, end: 'open' },
      E.composition,
      E.aggregation,
    ],
  },
]

export function kindSpec(kind: string): KindSpec | null {
  return KIND_SPECS.find((spec) => spec.kind === kind) ?? null
}

export function nodeSpec(kind: string, type: string): NodeSpec {
  const spec = kindSpec(kind)
  return (
    spec?.nodes.find((node) => node.type === type) ??
    // Tipo desconocido (datos de otra versión): se dibuja como rectángulo.
    { type, label: type, icon: '▭', shape: 'rect', keyword: 'rectangle', defaultName: type }
  )
}

export function edgeSpec(kind: string, type: string): EdgeSpec {
  if (type === 'note-link') return { type, label: 'Enlace de nota', arrow: '..', dashed: true }
  return kindSpec(kind)?.edges.find((edge) => edge.type === type) ?? { type, label: type, arrow: '-->', end: 'open' }
}

export const isGraphKind = (kind: string) => kindSpec(kind) !== null

/**
 * Modelo arquitectónico común y modelo de resultados de la evaluación de
 * coherencia entre diagramas.
 *
 * Cada diagrama del tablero se normaliza a elementos, relaciones y mensajes
 * con referencia a su origen (diagrama + id del elemento). Los elementos de
 * distintos diagramas nunca se fusionan: se enlazan mediante correspondencias
 * con evidencia y confianza (matching.ts), y las reglas razonan sobre esos
 * enlaces.
 */

// --- Diagramas y vistas ---------------------------------------------------------------

/** Tipos de diagrama que el motor sabe normalizar. */
export type AnalyzedKind = 'usecase' | 'sequence' | 'class' | 'package' | 'component' | 'deployment' | 'er'

/** Vistas del modelo 4+1, más la vista de datos (MER). */
export type ArchitectureView = 'scenarios' | 'logical' | 'process' | 'development' | 'physical' | 'data'

/** Entrada del motor: lo que guarda board_diagrams (sin depender del servicio). */
export type DiagramInput = {
  id: string
  name: string
  kind: string
  mode: 'code' | 'visual'
  source: string
  model: unknown
}

export type Extraction = {
  /** 0..1: qué tan seguro es que el modelo normalizado refleja el diagrama. */
  confidence: number
  /** Problemas de lectura (líneas no interpretadas, conversiones, errores). */
  issues: string[]
  /** true si no se pudo leer en absoluto. */
  failed: boolean
}

export type ArchDiagram = {
  id: string
  name: string
  kind: AnalyzedKind
  view: ArchitectureView
  mode: 'code' | 'visual'
  title?: string
  extraction: Extraction
}

// --- Elementos ----------------------------------------------------------------------

export type ElementKind =
  | 'actor'
  | 'usecase'
  | 'system'
  | 'class'
  | 'interface'
  | 'enum'
  | 'package'
  | 'participant'
  | 'component'
  | 'datastore'
  | 'queue'
  | 'node'
  | 'artifact'
  | 'entity'

export type Parameter = { name: string; type?: string }

export type Operation = {
  name: string
  params: Parameter[]
  returnType?: string
  visibility?: '+' | '-' | '#' | '~'
  abstract?: boolean
  /** Línea original del diagrama. */
  raw: string
}

export type Attribute = { name: string; type?: string; raw: string }

export type ArchElement = {
  /** `${diagramId}:${elementId}`: único en la evaluación. */
  key: string
  diagramId: string
  /** Id del elemento dentro de su diagrama (para navegar hasta él). */
  elementId: string
  kind: ElementKind
  /** Detalle del tipo original: abstract, device, cloud, boundary, control… */
  subtype?: string
  name: string
  stereotypes: string[]
  attributes: Attribute[]
  operations: Operation[]
  /** Clave del contenedor directo (paquete, nodo, límite del sistema). */
  parent?: string
}

// --- Relaciones y mensajes ------------------------------------------------------------

export type RelationType =
  | 'association'
  | 'directed'
  | 'dependency'
  | 'generalization'
  | 'realization'
  | 'composition'
  | 'aggregation'
  | 'include'
  | 'extend'
  | 'link'
  | 'er'

export type ArchRelation = {
  key: string
  diagramId: string
  elementId: string
  type: RelationType
  /** Generalización/realización: source es el hijo; composición/agregación: source es el todo. */
  source: string
  target: string
  /** true cuando la notación fija un sentido (dependencia, asociación dirigida, herencia…). */
  directed: boolean
  label?: string
  sourceMultiplicity?: string
  targetMultiplicity?: string
}

export type CallSignature = { name: string; args: Array<{ text: string; type?: string }> }

export type ArchMessage = {
  key: string
  diagramId: string
  elementId: string
  /** Orden temporal dentro del diagrama (0, 1, 2…). */
  order: number
  from: string
  to: string
  label: string
  type: 'sync' | 'async' | 'reply'
  /** Llamada a operación reconocible en el texto (`agregarTarea(t)`). */
  call?: CallSignature
  /** Fragmentos que lo envuelven, del más externo al más interno (alt, opt, loop…). */
  fragments: string[]
}

export type ArchitectureModel = {
  diagrams: ArchDiagram[]
  elements: ArchElement[]
  relations: ArchRelation[]
  messages: ArchMessage[]
  /** Diagramas del tablero que el motor no analiza (con el motivo). */
  ignored: Array<{ id: string; name: string; kind: string; reason: string }>
}

// --- Correspondencias ---------------------------------------------------------------

export type MatchBasis = 'same-name' | 'equivalent-terms' | 'role-variant' | 'partial' | 'user'

export type Correspondence = {
  a: string
  b: string
  basis: MatchBasis
  confidence: number
  /** Explicación legible de por qué se proponen como el mismo concepto. */
  evidence: string
  /** confirmed: la persona la validó · auto: se usa en las reglas · hypothesis: pendiente, no se usa. */
  status: 'confirmed' | 'auto' | 'hypothesis' | 'rejected'
  /** Hay más de un candidato con la misma confianza en el otro diagrama. */
  ambiguous?: boolean
}

export type Concept = {
  id: string
  label: string
  members: string[]
  diagramIds: string[]
  /** Confianza mínima de los enlaces que lo forman (1 si tiene un solo miembro). */
  confidence: number
  /** Une dos elementos distintos de un mismo diagrama: las reglas no lo usan para concluir. */
  ambiguous: boolean
}

// --- Configuración (por tablero) ----------------------------------------------------

export type MvcLayer = 'view' | 'controller' | 'model' | 'data'

export type ArchitectureSettings = {
  version: 1
  /** Estilo arquitectónico declarado por el proyecto. */
  style: 'none' | 'mvc'
  mvc: {
    /** classic: la vista puede leer el modelo · passive: la vista solo habla con el controlador. */
    variant: 'classic' | 'passive'
    /** Dependencias prohibidas entre capas (origen → destino). */
    forbidden: Array<{ from: MvcLayer; to: MvcLayer }>
    /** Más operaciones que esto en un controlador se señala como posible concentración. */
    controllerMaxOperations: number
  }
  /** Diagramas de clases cuyo contrato se declara completo (una operación ausente es una contradicción). */
  completeContracts: string[]
  /** Componentes lógicos que no se despliegan por separado (por nombre normalizado). */
  logicalComponents: string[]
  disabledRules: string[]
  /** Decisiones de la persona sobre equivalencias (por clave estable de elemento). */
  equivalences: Array<{ a: string; b: string; status: 'confirmed' | 'rejected' }>
  exceptions: ArchitectureException[]
}

export type ArchitectureException = {
  fingerprint: string
  ruleId: string
  title: string
  justification: string
  author?: string
  createdAt?: string
}

// --- Resultados ---------------------------------------------------------------------

export type FindingCategory = 'contradiction' | 'possible' | 'omission' | 'coherent' | 'unverifiable'
export type Severity = 'high' | 'medium' | 'low'
/** deterministic: comprobado sobre datos explícitos · heuristic: depende de correspondencias o heurísticas · exception: aceptado. */
export type ValidationStatus = 'deterministic' | 'heuristic' | 'exception'

export type ElementRef = { diagramId: string; elementId: string; name: string; kind: string }

export type Evidence = {
  diagramId: string
  diagramName: string
  /** Lo que el diagrama afirma, citado desde su modelo. */
  text: string
  elements: ElementRef[]
}

export type ComparisonId = 'uc-seq' | 'seq-cls' | 'cls-cmp' | 'cmp-dep' | 'seq-cmp' | 'uc-cls' | 'mvc' | 'structure'

export type CoherenceFinding = {
  /** Identificador legible y estable dentro del informe (C-001…). */
  id: string
  /** Identifica el hallazgo entre ejecuciones (para excepciones). */
  fingerprint: string
  ruleId: string
  ruleTitle: string
  comparison: ComparisonId
  category: FindingCategory
  /** Tipo de inconsistencia (operation-missing, dependency-reversed…). */
  type: string
  severity: Severity
  /** 0..1, independiente de la severidad. */
  confidence: number
  title: string
  description: string
  diagrams: string[]
  elements: ElementRef[]
  evidence: Evidence[]
  explanation: string
  impact: string
  recommendation: string
  validation: ValidationStatus
  exception?: ArchitectureException
}

export type ComparisonCoverage = {
  id: ComparisonId
  title: string
  status: 'executed' | 'skipped' | 'no-correspondence'
  reason?: string
  /** Qué artefacto permitiría ejecutarla o ampliarla. */
  enable?: string
  rules: Array<{ id: string; title: string; status: 'executed' | 'skipped' | 'disabled'; reason?: string; checks: number }>
}

export type ViewCoverage = {
  view: ArchitectureView
  label: string
  diagrams: Array<{ id: string; name: string; kind: string; confidence: number }>
  /** Qué se puede evaluar con lo que hay (o por qué no). */
  aspects: string[]
  missing?: string
}

export type Coverage = {
  views: ViewCoverage[]
  comparisons: ComparisonCoverage[]
  suggestions: string[]
}

export type InterpretationItem = { text: string; findings?: string[]; concepts?: string[] }
export type GlobalInterpretation = {
  architecture: InterpretationItem[]
  crossCutting: InterpretationItem[]
  scenarios: InterpretationItem[]
  contradictions: InterpretationItem[]
  unmatched: InterpretationItem[]
  unverifiable: InterpretationItem[]
  conclusion: InterpretationItem[]
}

export type CoherenceIndex = {
  /** Comprobaciones con resultado concluyente (coherente, contradicción o posible inconsistencia). */
  conclusive: number
  consistent: number
  contradictions: number
  possible: number
  /** consistent / conclusive, o null si no hubo comprobaciones concluyentes. */
  value: number | null
}

export type CoherenceStatus = 'contradictions' | 'possible-issues' | 'consistent-so-far' | 'not-evaluable'

export type ArchitectureReport = {
  status: CoherenceStatus
  statusLabel: string
  index: CoherenceIndex
  findings: CoherenceFinding[]
  correspondences: Correspondence[]
  concepts: Concept[]
  coverage: Coverage
  interpretation: GlobalInterpretation
  model: ArchitectureModel
}

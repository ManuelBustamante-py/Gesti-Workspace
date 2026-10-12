/**
 * Contexto de evaluación: consultas sobre el modelo normalizado y los
 * conceptos que usan las reglas. Aquí vive la navegación entre vistas
 * (clase → componente → nodo); las reglas solo deciden qué es coherente.
 */
import { quote } from './names'
import type {
  AnalyzedKind,
  ArchDiagram,
  ArchElement,
  ArchMessage,
  ArchRelation,
  ArchitectureModel,
  ArchitectureSettings,
  ComparisonId,
  Concept,
  Correspondence,
  ElementKind,
  ElementRef,
  Evidence,
  FindingCategory,
  Operation,
  Severity,
} from './types'

/** Lo que una regla reporta; el motor lo numera, le suma la confianza de extracción y lo marca si hay excepción. */
export type FindingDraft = {
  category: Exclude<FindingCategory, 'coherent'>
  type: string
  severity: Severity
  /** Confianza propia de la regla y de las correspondencias usadas (sin la de extracción). */
  confidence: number
  title: string
  description: string
  /** Claves de elementos involucrados (también relaciones y mensajes). */
  elements: string[]
  evidence: Evidence[]
  explanation: string
  impact: string
  recommendation: string
  /** true si la conclusión depende de heurísticas (nombres, clasificación por sufijos…). */
  heuristic?: boolean
  /** Identidad estable del hallazgo (para excepciones): se combina con el id de la regla. */
  subject: string[]
}

export type RuleOutcome = {
  findings: FindingDraft[]
  /** Comprobaciones que resultaron coherentes (texto breve + elementos). */
  passed: Array<{ text: string; elements: string[] }>
  /** La regla se ejecutó, pero no encontró correspondencias que comparar. */
  noCorrespondence?: string
  /** Decisiones de alcance que conviene mostrar (p. ej. componentes considerados lógicos). */
  notes?: string[]
}

/**
 * Regla de coherencia. Agregar una regla es declararla y registrarla en
 * rules/index.ts: el motor resuelve si aplica, la ejecuta y arma la cobertura.
 */
export type RuleSpec = {
  id: string
  comparison: ComparisonId
  title: string
  /** Qué comprueba y por qué es una exigencia razonable. */
  description: string
  /** Grupos de tipos de diagrama necesarios: debe haber al menos uno de cada grupo. */
  requires: AnalyzedKind[][]
  /** Condición adicional; devuelve el motivo si la regla no aplica. */
  precondition?: (ctx: RuleContext) => string | null
  run: (ctx: RuleContext) => RuleOutcome
}

export const emptyOutcome = (): RuleOutcome => ({ findings: [], passed: [] })

const CLASS_KINDS: AnalyzedKind[] = ['class', 'package']

export function createContext(model: ArchitectureModel, concepts: Concept[], correspondences: Correspondence[], settings: ArchitectureSettings) {
  const diagrams = new Map(model.diagrams.map((diagram) => [diagram.id, diagram]))
  const elements = new Map(model.elements.map((element) => [element.key, element]))
  const relationsByKey = new Map(model.relations.map((relation) => [relation.key, relation]))
  const messagesByKey = new Map(model.messages.map((message) => [message.key, message]))
  const conceptOfKey = new Map<string, Concept>()
  for (const concept of concepts) for (const member of concept.members) conceptOfKey.set(member, concept)

  const diagramOf = (key: string) => diagrams.get(key.split(':')[0])!
  const kindOf = (key: string) => diagramOf(key).kind
  const diagramsOfKind = (...kinds: AnalyzedKind[]) => model.diagrams.filter((diagram) => kinds.includes(diagram.kind) && !diagram.extraction.failed)
  /** Elementos de los diagramas de ciertos tipos, opcionalmente filtrados por tipo de elemento. */
  const elementsIn = (diagramKinds: AnalyzedKind[], ...kinds: ElementKind[]) =>
    model.elements.filter((element) => diagramKinds.includes(diagrams.get(element.diagramId)!.kind) && (!kinds.length || kinds.includes(element.kind)))

  const concept = (key: string) => conceptOfKey.get(key)!
  /** Otros miembros del concepto (excluye conceptos ambiguos). */
  const counterparts = (key: string, filter: (element: ArchElement) => boolean = () => true) => {
    const found = conceptOfKey.get(key)
    if (!found || found.ambiguous) return []
    return found.members.filter((member) => member !== key).map((member) => elements.get(member)!).filter(filter)
  }
  const inDiagramKind = (...kinds: AnalyzedKind[]) => (element: ArchElement) => kinds.includes(diagrams.get(element.diagramId)!.kind)
  const membersOf = (conceptId: string) => concepts.find((item) => item.id === conceptId)?.members.map((member) => elements.get(member)!) ?? []

  const ref = (key: string): ElementRef => {
    const element = elements.get(key)
    if (element) return { diagramId: element.diagramId, elementId: element.elementId, name: element.name, kind: element.kind }
    const relation = relationsByKey.get(key)
    if (relation) return { diagramId: relation.diagramId, elementId: relation.elementId, name: `${elements.get(relation.source)?.name} → ${elements.get(relation.target)?.name}`, kind: `relation:${relation.type}` }
    const message = messagesByKey.get(key)
    if (message) return { diagramId: message.diagramId, elementId: message.elementId, name: message.label || 'mensaje', kind: 'message' }
    const [diagramId, elementId] = key.split(':')
    return { diagramId, elementId: elementId ?? '', name: key, kind: 'unknown' }
  }
  const evidence = (diagramId: string, text: string, keys: string[]): Evidence => ({
    diagramId,
    diagramName: diagrams.get(diagramId)?.name ?? diagramId,
    text,
    elements: keys.map(ref),
  })
  const label = (key: string) => quote(elements.get(key)?.name ?? '?')
  const where = (key: string) => `${label(key)} (${diagramOf(key).name})`

  // --- Estructura (clases) ------------------------------------------------------------

  const classRelations = model.relations.filter((relation) => CLASS_KINDS.includes(kindOf(relation.source)) || kindOf(relation.source) === 'er')

  /** Conceptos ancestros (herencia o realización) de un concepto, en cualquier diagrama de clases. */
  const ancestors = (conceptId: string): string[] => {
    const result: string[] = []
    const queue = [conceptId]
    while (queue.length) {
      const current = queue.shift()!
      for (const relation of classRelations) {
        if (relation.type !== 'generalization' && relation.type !== 'realization') continue
        const from = conceptOfKey.get(relation.source)
        const to = conceptOfKey.get(relation.target)
        if (from?.id === current && to && !result.includes(to.id) && to.id !== conceptId) {
          result.push(to.id)
          queue.push(to.id)
        }
      }
    }
    return result
  }

  /** Operaciones declaradas para un concepto (y sus ancestros) en los diagramas de clases. */
  const operationsOf = (conceptId: string) => {
    const result: Array<{ operation: Operation; owner: ArchElement }> = []
    for (const id of [conceptId, ...ancestors(conceptId)]) {
      for (const member of membersOf(id)) {
        if (!CLASS_KINDS.includes(diagrams.get(member.diagramId)!.kind)) continue
        for (const operation of member.operations) result.push({ operation, owner: member })
      }
    }
    return result
  }

  /** Relaciones estructurales entre dos conceptos (en cualquier diagrama de clases o ER). */
  const relationsBetween = (a: string, b: string) =>
    classRelations.filter((relation) => {
      const from = conceptOfKey.get(relation.source)?.id
      const to = conceptOfKey.get(relation.target)?.id
      return (from === a && to === b) || (from === b && to === a)
    })

  // --- Componentes ----------------------------------------------------------------------

  const componentDiagrams = diagramsOfKind('component')
  const componentKinds: ElementKind[] = ['component', 'datastore', 'queue']
  const isComponentElement = (element: ArchElement) => diagrams.get(element.diagramId)!.kind === 'component' && componentKinds.includes(element.kind)

  /** Componente (concepto) al que pertenece un elemento: por identidad o por el paquete que lo contiene. */
  const componentOf = (key: string): { conceptId: string; via: string; confidence: number } | null => {
    const element = elements.get(key)
    if (!element) return null
    const own = conceptOfKey.get(key)
    if (own && !own.ambiguous) {
      if (isComponentElement(element)) return { conceptId: own.id, via: `${where(key)} es un componente`, confidence: 1 }
      const direct = own.members.map((member) => elements.get(member)!).find(isComponentElement)
      if (direct) return { conceptId: own.id, via: `${where(key)} corresponde al componente ${where(direct.key)}`, confidence: own.confidence }
      // Participante → clase → paquete → componente.
      if (element.kind === 'participant' || element.kind === 'datastore' || element.kind === 'queue') {
        for (const member of own.members) {
          const other = elements.get(member)!
          if (other.kind === 'class' || other.kind === 'interface') {
            const viaClass = componentOf(member)
            if (viaClass) return { ...viaClass, via: `${where(key)} es la clase ${label(member)}; ${viaClass.via}`, confidence: Math.min(viaClass.confidence, own.confidence) }
          }
        }
      }
    }
    let parent = element.parent
    while (parent) {
      const container = elements.get(parent)!
      const group = conceptOfKey.get(parent)
      const component = group && !group.ambiguous ? group.members.map((member) => elements.get(member)!).find(isComponentElement) : undefined
      if (component) return { conceptId: group!.id, via: `${where(key)} está en el paquete ${label(parent)}, que corresponde al componente ${where(component.key)}`, confidence: group!.confidence * 0.9 }
      parent = container.parent
    }
    return null
  }

  /** Grafo de dependencias entre conceptos de componentes (incluye interfaces provistas). */
  const componentEdges = (() => {
    const edges = new Map<string, Array<{ to: string; relation: ArchRelation }>>()
    const add = (from: string, to: string, relation: ArchRelation) => {
      if (from === to) return
      edges.set(from, [...(edges.get(from) ?? []), { to, relation }])
    }
    for (const relation of model.relations) {
      if (kindOf(relation.source) !== 'component') continue
      const from = conceptOfKey.get(relation.source)!.id
      const to = conceptOfKey.get(relation.target)!.id
      const sourceIsInterface = elements.get(relation.source)!.kind === 'interface'
      const targetIsInterface = elements.get(relation.target)!.kind === 'interface'
      if (relation.type === 'realization' || (relation.type === 'link' && (sourceIsInterface || targetIsInterface))) {
        // Proveer una interfaz: quien usa la interfaz llega al proveedor.
        if (targetIsInterface) add(to, from, relation)
        else if (sourceIsInterface) add(from, to, relation)
      } else if (relation.directed) add(from, to, relation)
      else {
        add(from, to, relation)
        add(to, from, relation)
      }
    }
    return edges
  })()

  const componentPath = (from: string, to: string): ArchRelation[] | null => {
    const previous = new Map<string, { node: string; relation: ArchRelation } | null>([[from, null]])
    const queue = [from]
    while (queue.length) {
      const current = queue.shift()!
      if (current === to) {
        const path: ArchRelation[] = []
        let step = previous.get(current)
        let node = current
        while (step) {
          path.unshift(step.relation)
          node = step.node
          step = previous.get(node)
        }
        return path
      }
      for (const edge of componentEdges.get(current) ?? []) {
        if (previous.has(edge.to)) continue
        previous.set(edge.to, { node: current, relation: edge.relation })
        queue.push(edge.to)
      }
    }
    return null
  }

  // --- Despliegue -----------------------------------------------------------------------

  const hostNode = (key: string): string | null => {
    let current: string | undefined = key
    while (current) {
      const element = elements.get(current)
      if (!element) return null
      if (element.kind === 'node' && current !== key) return current
      current = element.parent
    }
    return null
  }

  /** Ubicaciones de un concepto de componente en los diagramas de despliegue. */
  const placementsOf = (conceptId: string) =>
    membersOf(conceptId)
      .filter((member) => diagrams.get(member.diagramId)!.kind === 'deployment' && ['component', 'artifact', 'datastore', 'queue'].includes(member.kind))
      .map((member) => ({ element: member, node: hostNode(member.key) }))

  /** ¿Hay una conexión física (directa o encadenada) entre dos nodos del mismo diagrama de despliegue? */
  const nodesConnected = (a: string, b: string) => {
    const diagramId = elements.get(a)!.diagramId
    if (diagramId !== elements.get(b)!.diagramId) return null
    const adjacency = new Map<string, Set<string>>()
    const link = (x: string | null, y: string | null) => {
      if (!x || !y || x === y) return
      adjacency.set(x, (adjacency.get(x) ?? new Set()).add(y))
      adjacency.set(y, (adjacency.get(y) ?? new Set()).add(x))
    }
    const hostOrSelf = (key: string) => (elements.get(key)?.kind === 'node' ? key : hostNode(key))
    for (const relation of model.relations) if (relation.diagramId === diagramId) link(hostOrSelf(relation.source), hostOrSelf(relation.target))
    // Un entorno de ejecución anidado se comunica con el nodo que lo contiene.
    for (const element of model.elements) if (element.diagramId === diagramId && element.kind === 'node') link(element.key, hostNode(element.key))
    const seen = new Set([a])
    const queue = [a]
    while (queue.length) {
      const current = queue.shift()!
      if (current === b) return true
      for (const next of adjacency.get(current) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    return false
  }

  return {
    model,
    settings,
    concepts,
    correspondences,
    diagrams,
    elements,
    relationsByKey,
    messagesByKey,
    diagramOf,
    kindOf,
    diagramsOfKind,
    elementsIn,
    concept,
    counterparts,
    inDiagramKind,
    membersOf,
    ref,
    evidence,
    label,
    where,
    ancestors,
    operationsOf,
    relationsBetween,
    componentDiagrams,
    componentOf,
    componentPath,
    hostNode,
    placementsOf,
    nodesConnected,
    messagesOf: (diagram: ArchDiagram): ArchMessage[] => model.messages.filter((message) => message.diagramId === diagram.id),
  }
}

export type RuleContext = ReturnType<typeof createContext>

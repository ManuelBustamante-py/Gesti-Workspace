/**
 * Reglas de módulos y distribución: clases ↔ componentes (C), componentes ↔
 * despliegue (D) y secuencia ↔ componentes (E).
 *
 * Una clase se asigna a un componente por identidad (mismo concepto) o porque
 * su paquete corresponde al componente; no se exige que todas las clases
 * aparezcan en el diagrama de componentes.
 */
import { listText, normalizeName, operationKey, quote, terms } from '../names'
import { emptyOutcome, type RuleContext, type RuleSpec } from '../context'
import type { ArchElement, ArchMessage, ArchRelation } from '../types'

const LOGICAL_STEREOTYPES = /^(library|biblioteca|libreria|logical|logico|lógico|module|modulo|módulo|subsystem|subsistema|framework|layer|capa)$/

const conceptLabel = (ctx: RuleContext, conceptId: string) => quote(ctx.concepts.find((concept) => concept.id === conceptId)?.label ?? '?')

/** Elemento del diagrama de componentes que representa a un concepto (para citarlo como evidencia). */
const componentElement = (ctx: RuleContext, conceptId: string) =>
  ctx.membersOf(conceptId).find((member) => ctx.diagrams.get(member.diagramId)!.kind === 'component')

function pathText(ctx: RuleContext, path: ArchRelation[]) {
  return path.map((relation) => `${ctx.label(relation.source)} → ${ctx.label(relation.target)}`).join(', ')
}

/** Dirección de dependencia que implica una relación entre clases (o null si no fija sentido). */
function classDependency(relation: ArchRelation): [string, string] | null {
  if (relation.type === 'composition' || relation.type === 'aggregation') return [relation.source, relation.target]
  if (relation.type === 'association' || relation.type === 'er' || relation.type === 'link') return null
  return relation.directed ? [relation.source, relation.target] : null
}

const classComponentDependencies: RuleSpec = {
  id: 'cls-cmp.dependencies',
  comparison: 'cls-cmp',
  title: 'Dependencias entre clases compatibles con las de sus componentes',
  description: 'Si una clase de un componente depende de una clase de otro, el diagrama de componentes debería declarar esa dependencia (directa, encadenada o por una interfaz provista) y no la contraria.',
  requires: [['class', 'package'], ['component']],
  run(ctx) {
    const outcome = emptyOutcome()
    const classes = ctx.elementsIn(['class', 'package'], 'class', 'interface', 'enum')
    const allocation = new Map(classes.map((item) => [item.key, ctx.componentOf(item.key)]))
    const allocated = classes.filter((item) => allocation.get(item.key))
    if (!allocated.length) return { ...outcome, noCorrespondence: 'Ninguna clase se pudo asignar a un componente (usa el nombre del componente en la clase o en su paquete).' }
    outcome.notes = [`${allocated.length} de ${classes.length} clase(s) asignadas a un componente.`]
    const pairs = new Map<string, { from: string; to: string; relations: ArchRelation[]; confidence: number }>()
    for (const relation of ctx.model.relations) {
      if (!['class', 'package'].includes(ctx.kindOf(relation.source))) continue
      const direction = classDependency(relation)
      if (!direction) continue
      const from = allocation.get(direction[0])
      const to = allocation.get(direction[1])
      if (!from || !to || from.conceptId === to.conceptId) continue
      const id = `${from.conceptId}>${to.conceptId}`
      const entry = pairs.get(id) ?? { from: from.conceptId, to: to.conceptId, relations: [], confidence: Math.min(from.confidence, to.confidence) }
      entry.relations.push(relation)
      pairs.set(id, entry)
    }
    let betweenTables = 0
    for (const pair of pairs.values()) {
      const relationText = listText(pair.relations.map((relation) => `${ctx.label(relation.source)} → ${ctx.label(relation.target)} (${relation.type})`))
      const fromElement = componentElement(ctx, pair.from)
      const toElement = componentElement(ctx, pair.to)
      // Dos tablas de la misma base de datos: la relación es una clave foránea, no una
      // dependencia entre componentes; se contrasta con el MER (regla structure.relations).
      if (fromElement && toElement && isDataElement(ctx, fromElement) && isDataElement(ctx, toElement)) {
        betweenTables += 1
        continue
      }
      const componentKeys = [fromElement?.key, toElement?.key].filter((key): key is string => Boolean(key))
      const forward = ctx.componentPath(pair.from, pair.to)
      if (forward) {
        outcome.passed.push({ text: `${relationText} es coherente con la dependencia ${conceptLabel(ctx, pair.from)} → ${conceptLabel(ctx, pair.to)} (${pathText(ctx, forward)}).`, elements: [...pair.relations.map((relation) => relation.key), ...componentKeys] })
        continue
      }
      const backward = ctx.componentPath(pair.to, pair.from)
      const classEvidence = [...new Set(pair.relations.map((relation) => relation.diagramId))].map((id) =>
        ctx.evidence(id, `Relaciones entre clases: ${relationText}.`, pair.relations.filter((relation) => relation.diagramId === id).map((relation) => relation.key)))
      if (backward) {
        outcome.findings.push({
          category: 'possible', type: 'dependency-reversed', severity: 'high', confidence: pair.confidence * 0.9,
          title: `Las clases dependen de ${conceptLabel(ctx, pair.from)} → ${conceptLabel(ctx, pair.to)}, pero los componentes declaran lo contrario`,
          description: `${relationText}; en el diagrama de componentes la dependencia va de ${conceptLabel(ctx, pair.to)} hacia ${conceptLabel(ctx, pair.from)} (${pathText(ctx, backward)}).`,
          elements: [...pair.relations.map((relation) => relation.key), ...componentKeys, ...backward.map((relation) => relation.key)],
          evidence: [...classEvidence, ctx.evidence(backward[0].diagramId, `Dependencias declaradas: ${pathText(ctx, backward)}.`, backward.map((relation) => relation.key))],
          explanation: 'Una dependencia en ambos sentidos entre componentes crea un ciclo; si el diagrama de componentes fija un sentido, las clases no deberían invertirlo.',
          impact: 'Acoplamiento cíclico entre módulos: dificulta desplegar, probar o reemplazar cada componente por separado.',
          recommendation: 'Invierte la dependencia de las clases (p. ej. con una interfaz en el componente que depende) o corrige el diagrama de componentes.',
          subject: [componentKeys.join('>') || `${pair.from}>${pair.to}`, ...pair.relations.map((relation) => relation.key)],
        })
      } else {
        outcome.findings.push({
          category: 'omission', type: 'dependency-undeclared', severity: 'medium', confidence: pair.confidence * 0.85,
          title: `Falta la dependencia ${conceptLabel(ctx, pair.from)} → ${conceptLabel(ctx, pair.to)} en el diagrama de componentes`,
          description: `${relationText} cruza de ${conceptLabel(ctx, pair.from)} a ${conceptLabel(ctx, pair.to)}, pero los componentes no están conectados.`,
          elements: [...pair.relations.map((relation) => relation.key), ...componentKeys],
          evidence: [...classEvidence, ...(fromElement ? [ctx.evidence(fromElement.diagramId, `${ctx.label(fromElement.key)} no tiene camino de dependencia hacia ${conceptLabel(ctx, pair.to)}.`, componentKeys)] : [])],
          explanation: 'El diagrama de componentes puede estar simplificado; por eso es una omisión y no una contradicción.',
          impact: 'Una dependencia real entre módulos no está documentada en la vista de desarrollo.',
          recommendation: `Agrega la dependencia ${conceptLabel(ctx, pair.from)} → ${conceptLabel(ctx, pair.to)} (o la interfaz que la canaliza).`,
          subject: [componentKeys.join('>') || `${pair.from}>${pair.to}`],
        })
      }
    }
    if (betweenTables) outcome.notes = [...(outcome.notes ?? []), `${betweenTables} relación(es) entre tablas de la base de datos se contrastan con el MER, no con dependencias entre componentes.`]
    return outcome
  },
}

const DATA_CONTAINER = /^(basedatos|bd|database|db|schema|esquema|postgresql|postgres|mysql|mariadb|oracle|sqlite|mongodb|sqlserver)$/

/** Elemento de datos: un almacén, o algo contenido en un contenedor que representa una base de datos. */
function isDataElement(ctx: RuleContext, element: ArchElement) {
  if (element.kind === 'datastore') return true
  let parent = element.parent
  while (parent) {
    const container = ctx.elements.get(parent)!
    if (container.kind === 'datastore' || terms(container.name).some((term) => DATA_CONTAINER.test(term))) return true
    parent = container.parent
  }
  return false
}

const interfaceKinds: RuleSpec = {
  id: 'cls-cmp.interfaces',
  comparison: 'cls-cmp',
  title: 'Interfaces de componentes compatibles con el modelo de clases',
  description: 'Una interfaz del diagrama de componentes que aparece en el de clases debería ser una interfaz (o clase abstracta) allí también.',
  requires: [['class', 'package'], ['component']],
  run(ctx) {
    const outcome = emptyOutcome()
    for (const iface of ctx.elementsIn(['component'], 'interface')) {
      for (const other of ctx.counterparts(iface.key, (element) => ctx.inDiagramKind('class', 'package')(element))) {
        if (other.kind === 'interface' || other.subtype === 'abstract') {
          outcome.passed.push({ text: `La interfaz ${ctx.label(iface.key)} también es interfaz en ${ctx.diagramOf(other.key).name}.`, elements: [iface.key, other.key] })
          continue
        }
        outcome.findings.push({
          category: 'possible', type: 'interface-kind', severity: 'low', confidence: ctx.concept(iface.key).confidence,
          title: `${ctx.label(iface.key)} es interfaz en componentes y ${other.kind === 'enum' ? 'enumeración' : 'clase concreta'} en clases`,
          description: `En ${ctx.diagramOf(iface.key).name} ${ctx.label(iface.key)} es una interfaz provista o requerida; en ${ctx.diagramOf(other.key).name} se declara como ${other.kind}.`,
          elements: [iface.key, other.key],
          evidence: [ctx.evidence(iface.diagramId, `${ctx.label(iface.key)}: interfaz.`, [iface.key]), ctx.evidence(other.diagramId, `${ctx.label(other.key)}: ${other.kind}.`, [other.key])],
          explanation: 'Un contrato entre componentes suele modelarse como interfaz para que el proveedor sea reemplazable.',
          impact: 'Los consumidores quedarían acoplados a una implementación concreta.',
          recommendation: 'Declara el elemento como interfaz en el diagrama de clases, o confirma que se trata de otro concepto.',
          subject: [iface.key, other.key],
        })
      }
    }
    return outcome
  },
}

function isLogical(ctx: RuleContext, element: ArchElement) {
  return element.stereotypes.some((stereotype) => LOGICAL_STEREOTYPES.test(stereotype)) || ctx.settings.logicalComponents.includes(normalizeName(element.name))
}

/** Nodos donde está desplegado un concepto de componente (por el despliegue o por un nodo del diagrama de componentes). */
function hostsOf(ctx: RuleContext, conceptId: string) {
  const placements = ctx.placementsOf(conceptId)
  const hosts = placements.filter((placement) => placement.node).map((placement) => placement.node!)
  for (const member of ctx.membersOf(conceptId)) {
    if (ctx.diagrams.get(member.diagramId)!.kind !== 'component') continue
    const node = ctx.hostNode(member.key)
    if (!node) continue
    for (const deployed of ctx.counterparts(node, (element) => ctx.diagrams.get(element.diagramId)!.kind === 'deployment' && element.kind === 'node')) hosts.push(deployed.key)
  }
  return { placements, hosts: [...new Set(hosts)] }
}

const placementRule: RuleSpec = {
  id: 'cmp-dep.placement',
  comparison: 'cmp-dep',
  title: 'Componentes con ubicación de despliegue identificable',
  description: 'Cada componente desplegable debería corresponder a un componente o artefacto ubicado en un nodo. Los componentes lógicos («library», «module»… o los marcados en la configuración) no se exigen.',
  requires: [['component'], ['deployment']],
  run(ctx) {
    const outcome = emptyOutcome()
    const deployments = ctx.diagramsOfKind('deployment')
    const detailed = ctx.elementsIn(['deployment'], 'component', 'artifact', 'datastore', 'queue').length > 0
    const logical: string[] = []
    const seen = new Set<string>()
    for (const component of ctx.elementsIn(['component'], 'component', 'datastore', 'queue')) {
      const concept = ctx.concept(component.key)
      if (seen.has(concept.id)) continue
      seen.add(concept.id)
      if (isLogical(ctx, component)) {
        logical.push(component.name)
        continue
      }
      const { placements, hosts } = hostsOf(ctx, concept.id)
      if (hosts.length) {
        outcome.passed.push({ text: `${ctx.label(component.key)} se despliega en ${listText(hosts.map(ctx.label))}.`, elements: [component.key, ...hosts] })
        continue
      }
      if (placements.length) {
        outcome.findings.push({
          category: 'omission', type: 'artifact-without-node', severity: 'low', confidence: concept.confidence,
          title: `${ctx.label(component.key)} aparece en el despliegue fuera de todo nodo`,
          description: `${listText(placements.map((placement) => ctx.where(placement.element.key)))} no está dentro de un nodo, dispositivo o nube.`,
          elements: [component.key, ...placements.map((placement) => placement.element.key)],
          evidence: placements.map((placement) => ctx.evidence(placement.element.diagramId, `${ctx.label(placement.element.key)} sin nodo contenedor.`, [placement.element.key])),
          explanation: 'Sin nodo no se sabe en qué entorno se ejecuta.',
          impact: 'No se pueden verificar las comunicaciones físicas de este componente.',
          recommendation: 'Arrastra el artefacto dentro del nodo donde se ejecuta.',
          subject: [component.key],
        })
        continue
      }
      if (!detailed) continue
      outcome.findings.push({
        category: 'omission', type: 'component-unplaced', severity: 'medium', confidence: 0.8,
        title: `${ctx.label(component.key)} no tiene ubicación en el despliegue`,
        description: `Ningún componente ni artefacto de ${listText(deployments.map((item) => quote(item.name)))} corresponde a ${ctx.label(component.key)}.`,
        elements: [component.key],
        evidence: [ctx.evidence(component.diagramId, `${ctx.label(component.key)} declarado como componente.`, [component.key])],
        explanation: 'Puede desplegarse dentro de otro artefacto (con otro nombre) o ser un componente lógico; por eso no se considera contradicción.',
        impact: 'No se sabe dónde se ejecuta ni si sus comunicaciones tienen soporte físico.',
        recommendation: 'Agrega el artefacto que lo contiene al nodo correspondiente, confirma una equivalencia de nombres o márcalo como componente lógico en la configuración.',
        subject: [component.key],
      })
    }
    if (!detailed) outcome.noCorrespondence = 'El despliegue no detalla componentes ni artefactos: solo se pueden comparar nodos.'
    if (logical.length) outcome.notes = [`Considerados lógicos (no se exige despliegue): ${listText(logical.map(quote))}.`]
    return outcome
  },
}

/** Dependencias directas entre conceptos de componentes (por interfaz provista se llega al proveedor). */
function directDependencies(ctx: RuleContext) {
  const result = new Map<string, { from: string; to: string; relations: ArchRelation[] }>()
  for (const relation of ctx.model.relations) {
    if (ctx.kindOf(relation.source) !== 'component' || !relation.directed) continue
    const source = ctx.elements.get(relation.source)!
    const target = ctx.elements.get(relation.target)!
    if (source.kind === 'interface' || relation.type === 'realization') continue
    const providers =
      target.kind === 'interface'
        ? ctx.model.relations
            .filter((other) => other.diagramId === relation.diagramId && (other.type === 'realization' || other.type === 'link') && (other.target === target.key || other.source === target.key))
            .map((other) => (other.target === target.key ? other.source : other.target))
            .filter((key) => key !== source.key)
        : [target.key]
    for (const provider of providers) {
      const from = ctx.concept(source.key).id
      const to = ctx.concept(provider).id
      if (from === to) continue
      const id = `${from}>${to}`
      const entry = result.get(id) ?? { from, to, relations: [] }
      entry.relations.push(relation)
      result.set(id, entry)
    }
  }
  return [...result.values()]
}

const connectivityRule: RuleSpec = {
  id: 'cmp-dep.connectivity',
  comparison: 'cmp-dep',
  title: 'Comunicaciones respaldadas por conexiones físicas',
  description: 'Si un componente depende de otro desplegado en un nodo distinto, el despliegue debería conectar ambos nodos (directamente o a través de otros).',
  requires: [['component'], ['deployment']],
  run(ctx) {
    const outcome = emptyOutcome()
    let compared = 0
    for (const dependency of directDependencies(ctx)) {
      const from = hostsOf(ctx, dependency.from).hosts
      const to = hostsOf(ctx, dependency.to).hosts
      if (!from.length || !to.length) continue
      compared += 1
      const dependencyText = listText(dependency.relations.map((relation) => `${ctx.label(relation.source)} → ${ctx.label(relation.target)}`))
      const pairs = from.flatMap((a) => to.map((b) => ({ a, b, connected: a === b ? true : ctx.nodesConnected(a, b) })))
      const local = pairs.find((pair) => pair.a === pair.b)
      const linked = pairs.find((pair) => pair.connected)
      if (local || linked) {
        const pair = local ?? linked!
        outcome.passed.push({
          text: local ? `${dependencyText}: ambos se ejecutan en ${ctx.label(pair.a)}.` : `${dependencyText} tiene soporte físico entre ${ctx.label(pair.a)} y ${ctx.label(pair.b)}.`,
          elements: [...dependency.relations.map((relation) => relation.key), pair.a, pair.b],
        })
        continue
      }
      const sameDiagram = pairs.filter((pair) => pair.connected === false)
      const confidence = Math.min(ctx.concepts.find((item) => item.id === dependency.from)!.confidence, ctx.concepts.find((item) => item.id === dependency.to)!.confidence)
      const pair = sameDiagram[0] ?? pairs[0]
      const deploymentId = ctx.elements.get(pair.a)!.diagramId
      const modelsLinks = ctx.model.relations.some((relation) => relation.diagramId === deploymentId)
      const subject = [`${dependency.from}>${dependency.to}`, ...dependency.relations.map((relation) => relation.key)]
      if (!sameDiagram.length || !modelsLinks) {
        outcome.findings.push({
          category: 'unverifiable', type: 'communication-path-unknown', severity: 'low', confidence,
          title: `No se puede verificar el canal físico de ${dependencyText}`,
          description: !sameDiagram.length ? 'Los nodos de origen y destino están en diagramas de despliegue distintos.' : 'El diagrama de despliegue no modela conexiones entre nodos.',
          elements: [...dependency.relations.map((relation) => relation.key), pair.a, pair.b],
          evidence: [ctx.evidence(dependency.relations[0].diagramId, `Dependencia ${dependencyText}.`, dependency.relations.map((relation) => relation.key))],
          explanation: 'Sin conexiones modeladas no se puede afirmar ni negar que exista el canal.',
          impact: 'La viabilidad de la comunicación entre nodos queda sin verificar.',
          recommendation: 'Dibuja las conexiones (protocolo) entre los nodos en el diagrama de despliegue.',
          subject,
        })
        continue
      }
      outcome.findings.push({
        category: 'contradiction', type: 'no-communication-path', severity: 'high', confidence,
        title: `${conceptLabel(ctx, dependency.from)} depende de ${conceptLabel(ctx, dependency.to)}, pero sus nodos no están conectados`,
        description: `${dependencyText} en el diagrama de componentes; en el despliegue ${conceptLabel(ctx, dependency.from)} está en ${ctx.label(pair.a)} y ${conceptLabel(ctx, dependency.to)} en ${ctx.label(pair.b)}, sin ninguna conexión (directa ni indirecta) entre ellos.`,
        elements: [...dependency.relations.map((relation) => relation.key), pair.a, pair.b],
        evidence: [
          ctx.evidence(dependency.relations[0].diagramId, `Dependencia ${dependencyText}.`, dependency.relations.map((relation) => relation.key)),
          ctx.evidence(deploymentId, `${ctx.label(pair.a)} y ${ctx.label(pair.b)} no tienen camino de conexión; el diagrama sí modela otras conexiones.`, [pair.a, pair.b]),
        ],
        explanation: 'El despliegue modela conexiones entre nodos, pero ninguna permite que estos dos se comuniquen: la dependencia lógica no tiene soporte físico.',
        impact: 'La comunicación no podría realizarse tal como está desplegado el sistema.',
        recommendation: `Agrega la conexión entre ${ctx.label(pair.a)} y ${ctx.label(pair.b)} (con su protocolo) o reubica uno de los componentes.`,
        subject,
      })
    }
    if (!compared) outcome.noCorrespondence = 'No hay dependencias entre componentes que estén ubicados en el despliegue.'
    return outcome
  },
}

const SERVER_SIDE: ArchElement['kind'][] = ['datastore', 'queue']

const environmentRule: RuleSpec = {
  id: 'cmp-dep.environment',
  comparison: 'cmp-dep',
  title: 'Entornos compatibles con lo desplegado',
  description: 'Bases de datos y colas de mensajes compartidas no deberían ubicarse en un dispositivo cliente («device»).',
  requires: [['component'], ['deployment']],
  run(ctx) {
    const outcome = emptyOutcome()
    const seen = new Set<string>()
    for (const element of [...ctx.elementsIn(['component'], ...SERVER_SIDE), ...ctx.elementsIn(['deployment'], ...SERVER_SIDE)]) {
      const concept = ctx.concept(element.key)
      if (seen.has(concept.id)) continue
      seen.add(concept.id)
      for (const host of hostsOf(ctx, concept.id).hosts) {
        const node = ctx.elements.get(host)!
        if (node.subtype !== 'device') {
          outcome.passed.push({ text: `${ctx.label(element.key)} se ubica en ${ctx.label(host)}, un entorno de servidor.`, elements: [element.key, host] })
          continue
        }
        outcome.findings.push({
          category: 'possible', type: 'server-component-on-device', severity: 'medium', confidence: concept.confidence * 0.8,
          title: `${ctx.label(element.key)} se despliega en el dispositivo ${ctx.label(host)}`,
          description: `${ctx.label(element.key)} es ${element.kind === 'datastore' ? 'una base de datos' : 'una cola de mensajes'} y está dentro de un nodo «device».`,
          elements: [element.key, host],
          evidence: [ctx.evidence(node.diagramId, `${ctx.label(host)} es un dispositivo y contiene ${ctx.label(element.key)}.`, [host])],
          explanation: 'Los almacenes compartidos suelen ejecutarse en servidores; en un dispositivo solo tiene sentido si es un almacenamiento local (caché, base embebida).',
          impact: 'Los datos no serían compartidos entre usuarios ni estarían protegidos en el servidor.',
          recommendation: 'Si es almacenamiento local, indícalo con un estereotipo y registra una excepción; si no, muévelo a un nodo servidor.',
          heuristic: true,
          subject: [element.key, host],
        })
      }
    }
    return outcome
  },
}

const sequenceComponents: RuleSpec = {
  id: 'seq-cmp.dependencies',
  comparison: 'seq-cmp',
  title: 'Comunicaciones del escenario compatibles con las dependencias entre componentes',
  description: 'Cuando un participante de un componente envía un mensaje a uno de otro componente, debe existir una dependencia en ese sentido; un mensaje en sentido contrario a la dependencia declarada atraviesa el límite de forma incompatible.',
  requires: [['sequence'], ['component']],
  run(ctx) {
    const outcome = emptyOutcome()
    const pairs = new Map<string, { from: string; to: string; messages: ArchMessage[]; confidence: number }>()
    for (const message of ctx.model.messages) {
      if (message.type === 'reply' || message.from === message.to) continue
      if (ctx.elements.get(message.from)!.kind === 'actor' || ctx.elements.get(message.to)!.kind === 'actor') continue
      const from = ctx.componentOf(message.from)
      const to = ctx.componentOf(message.to)
      if (!from || !to || from.conceptId === to.conceptId) continue
      const id = `${from.conceptId}>${to.conceptId}`
      const entry = pairs.get(id) ?? { from: from.conceptId, to: to.conceptId, messages: [], confidence: Math.min(from.confidence, to.confidence) }
      entry.messages.push(message)
      pairs.set(id, entry)
    }
    if (!pairs.size) return { ...outcome, noCorrespondence: 'Ningún mensaje une participantes asignables a componentes distintos.' }
    for (const pair of pairs.values()) {
      const messageText = listText(pair.messages.slice(0, 4).map((message) => quote(message.label)))
      const messageEvidence = [...new Set(pair.messages.map((message) => message.diagramId))].map((id) =>
        ctx.evidence(id, `Mensajes ${messageText}.`, pair.messages.filter((message) => message.diagramId === id).map((message) => message.key)))
      const keys = [componentElement(ctx, pair.from)?.key, componentElement(ctx, pair.to)?.key].filter((key): key is string => Boolean(key))
      const forward = ctx.componentPath(pair.from, pair.to)
      if (forward) {
        outcome.passed.push({ text: `Los mensajes de ${conceptLabel(ctx, pair.from)} a ${conceptLabel(ctx, pair.to)} siguen la dependencia ${pathText(ctx, forward)}.`, elements: [...pair.messages.map((message) => message.key), ...keys] })
        checkContract(ctx, pair, forward, outcome)
        continue
      }
      const backward = ctx.componentPath(pair.to, pair.from)
      outcome.findings.push(
        backward
          ? {
              category: 'possible', type: 'communication-against-dependency', severity: 'high', confidence: pair.confidence * 0.9,
              title: `El escenario comunica ${conceptLabel(ctx, pair.from)} → ${conceptLabel(ctx, pair.to)} contra la dependencia declarada`,
              description: `Se envían ${messageText}; el diagrama de componentes solo declara ${pathText(ctx, backward)}.`,
              elements: [...pair.messages.map((message) => message.key), ...keys, ...backward.map((relation) => relation.key)],
              evidence: [...messageEvidence, ctx.evidence(backward[0].diagramId, `Dependencias declaradas: ${pathText(ctx, backward)}.`, backward.map((relation) => relation.key))],
              explanation: 'El emisor de un mensaje síncrono o asíncrono depende del receptor; el diagrama de componentes fija el sentido opuesto.',
              impact: 'La implementación del escenario crearía un ciclo entre módulos o violaría el contrato declarado.',
              recommendation: 'Invierte la interacción (eventos, callbacks) o corrige el sentido de la dependencia.',
              subject: [keys.join('>') || `${pair.from}>${pair.to}`],
            }
          : {
              category: 'omission', type: 'communication-undeclared', severity: 'medium', confidence: pair.confidence * 0.85,
              title: `El escenario comunica ${conceptLabel(ctx, pair.from)} con ${conceptLabel(ctx, pair.to)} sin dependencia declarada`,
              description: `Se envían ${messageText}, pero en el diagrama de componentes no hay camino de ${conceptLabel(ctx, pair.from)} a ${conceptLabel(ctx, pair.to)}.`,
              elements: [...pair.messages.map((message) => message.key), ...keys],
              evidence: messageEvidence,
              explanation: 'El diagrama de componentes puede omitir dependencias; por eso no se trata como contradicción.',
              impact: 'La vista de desarrollo no documenta un acoplamiento que el comportamiento necesita.',
              recommendation: `Agrega la dependencia ${conceptLabel(ctx, pair.from)} → ${conceptLabel(ctx, pair.to)} o la interfaz que la canaliza.`,
              subject: [keys.join('>') || `${pair.from}>${pair.to}`],
            },
      )
    }
    return outcome
  },
}

/** Si la comunicación pasa por una interfaz con operaciones declaradas, las llamadas deben estar en ella. */
function checkContract(ctx: RuleContext, pair: { messages: ArchMessage[]; confidence: number }, path: ArchRelation[], outcome: ReturnType<typeof emptyOutcome>) {
  const interfaces = [...new Set(path.flatMap((relation) => [relation.source, relation.target]))].filter((key) => ctx.elements.get(key)!.kind === 'interface')
  for (const iface of interfaces) {
    const declared = ctx.operationsOf(ctx.concept(iface).id)
    if (!declared.length) continue
    const complete = declared.some((item) => ctx.settings.completeContracts.includes(item.owner.diagramId))
    for (const message of pair.messages) {
      if (!message.call) continue
      if (declared.some((item) => operationKey(item.operation.name) === operationKey(message.call!.name))) continue
      outcome.findings.push({
        category: complete ? 'contradiction' : 'possible', type: 'call-outside-interface', severity: 'medium', confidence: pair.confidence * 0.85,
        title: `«${message.call.name}» cruza el límite por ${ctx.label(iface)} sin estar en su contrato`,
        description: `${quote(message.label)} atraviesa la interfaz ${ctx.label(iface)}, que declara ${listText([...new Set(declared.map((item) => quote(item.operation.name)))])}.`,
        elements: [message.key, iface, ...declared.map((item) => item.owner.key)],
        evidence: [ctx.evidence(message.diagramId, `Mensaje ${quote(message.label)}.`, [message.key]), ctx.evidence(declared[0].owner.diagramId, `Contrato de ${ctx.label(iface)}.`, [declared[0].owner.key])],
        explanation: 'Entre componentes, la comunicación debería limitarse a las operaciones de la interfaz que los une.',
        impact: 'El consumidor dependería de detalles internos del proveedor.',
        recommendation: `Agrega «${message.call.name}» a la interfaz o canaliza la llamada por una operación existente.`,
        subject: [iface, message.call.name],
      })
    }
  }
}

export const MODULE_RULES = [classComponentDependencies, interfaceKinds, placementRule, connectivityRule, environmentRule, sequenceComponents]

import { autoLayout, type Parents } from './layout'
import { containerMap, nodeSize, snap } from './geometry'
import { edgeSpec, kindSpec, type EdgeSpec, type KindSpec, type NodeSpec } from './kinds'
import { isStructuredKind, parseStructured } from './structured'
import {
  nextId,
  type GraphEdge,
  type GraphModel,
  type GraphNode,
  type Message,
  type MessageType,
  type Participant,
  type ParticipantType,
  type SequenceModel,
  type VisualModel,
} from './visualModel'

export type ParseResult = {
  model: VisualModel
  /** Líneas que el editor no interpreta: se conservan como PlantUML extra. */
  kept: string[]
  /** Avisos de conversión (p. ej. elementos de otro tipo convertidos). */
  warnings: string[]
}

// --- Utilidades de texto ---------------------------------------------------------

const unquote = (text: string) => text.trim().replace(/^"(.*)"$/s, '$1').replace(/\\n/g, '\n')

/** Quita comentarios ('… y /' … '/) y líneas vacías; une los bloques de nota. */
function cleanLines(source: string) {
  const lines: string[] = []
  let inComment = false
  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    let line = raw.trim()
    if (inComment) {
      if (line.includes("'/")) {
        inComment = false
        line = line.slice(line.indexOf("'/") + 2).trim()
      } else continue
    }
    if (line.startsWith("/'")) {
      if (!line.includes("'/", 2)) inComment = true
      continue
    }
    if (!line || line.startsWith("'")) continue
    lines.push(line)
  }
  return lines
}

/** Directivas de presentación que el modelo no representa: se conservan. */
const KEPT_PREFIXES = /^(skinparam|!theme|!pragma|!define|!include|scale|header|footer|caption|legend|endlegend|hide|show|remove|allow_mixing|set |sprite|mainframe|newpage|<style>|<\/style>)/i

type NameParts = { name: string; alias: string | null; stereotypes: string[]; color: string | null; opens: boolean }

/**
 * Nombre, alias, estereotipos y color de una declaración. Acepta:
 * "Nombre" as alias · alias as "Nombre" · Nombre as alias · Nombre · (Caso) · :Actor: · [Componente]
 */
function parseNameParts(rest: string): NameParts {
  let text = rest.trim()
  const opens = text.endsWith('{')
  if (opens) text = text.slice(0, -1).trim()
  const stereotypes: string[] = []
  text = text.replace(/<<\s*([^>]+?)\s*>>/g, (_, value: string) => {
    stereotypes.push(value.trim())
    return ''
  }).trim()
  let color: string | null = null
  text = text.replace(/\s(#[\w#;:.]+)\s*$/, (_, value: string) => {
    color = value
    return ''
  }).trim()

  let name = text
  let alias: string | null = null
  const quotedFirst = /^"([^"]*)"\s+as\s+([\w.]+)$/.exec(text)
  const aliasFirst = /^([\w.]+)\s+as\s+"([^"]*)"$/.exec(text)
  const plainAs = /^(\S+)\s+as\s+(\S+)$/.exec(text)
  if (quotedFirst) [, name, alias] = quotedFirst
  else if (aliasFirst) [, alias, name] = aliasFirst
  else if (plainAs) [, name, alias] = plainAs
  name = name.replace(/^\((.*)\)$/, '$1').replace(/^:(.*):$/, '$1').replace(/^\[(.*)\]$/, '$1')
  return { name: unquote(name), alias, stereotypes, color, opens }
}

// --- Flechas ----------------------------------------------------------------------

const OPERAND = String.raw`(\[\*\]|"[^"]+"|\([^)]+\)|:[^:]+:|\[[^\]]+\]|[\p{L}\p{N}_.$]+)`
const ARROW = String.raw`([<>|*o#x}{+^]{0,2}[-.=]+(?:\[[^\]]*\])?(?:(?:left|right|up|down|le|ri|do|l|r|u|d)[-.=]*)?[-.=]*[<>|*o#x}{+^]{0,2})`
const RELATION = new RegExp(String.raw`^${OPERAND}\s*(?:"([^"]*)"\s*)?${ARROW}\s*(?:"([^"]*)"\s*)?${OPERAND}\s*(?::\s*(.*))?$`, 'u')

type ParsedArrow = { dashed: boolean; left: string; right: string }

/** Separa la flecha en: trazo, punta izquierda y punta derecha (sin dirección ni estilo). */
function parseArrow(arrow: string): ParsedArrow {
  const clean = arrow.replace(/\[[^\]]*\]/g, '').replace(/(left|right|up|down|le|ri|do)/g, '').replace(/(?<=[-.])[lrud](?=[-.])/g, '')
  const body = /[-.=]+/.exec(clean)
  const start = body?.index ?? 0
  return {
    dashed: (body?.[0] ?? '').includes('.'),
    left: clean.slice(0, start),
    right: clean.slice(start + (body?.[0].length ?? 0)),
  }
}

const CARD_LEFT: Record<string, string> = { '||': '1', '|o': '0..1', 'o|': '0..1', '}|': '1..*', '|{': '1..*', '}o': '0..*', 'o{': '0..*' }

/** Tipo de relación del registro que corresponde a una flecha (y si hay que invertir los extremos). */
function classifyArrow(spec: KindSpec, arrow: ParsedArrow, text: string): { type: string; reversed: boolean; fixed: string | null; ends?: [string, string] } {
  const { dashed, left, right } = arrow
  const has = (type: string) => spec.edges.some((edge) => edge.type === type)
  const pick = (...types: string[]) => types.find(has) ?? spec.defaultEdge
  const stereo = /^<<\s*([^>]+?)\s*>>\s*(.*)$/.exec(text)
  const fixedEdge = stereo ? spec.edges.find((edge) => edge.fixedText === stereo[1]) : undefined

  if (spec.edges.some((edge) => edge.ends === 'cardinality') && (/[{}]/.test(left + right) || /\|\|/.test(left + right) || /[|o][|o]/.test(left + right))) {
    return { type: pick('er'), reversed: false, fixed: null, ends: [CARD_LEFT[left] ?? '1', CARD_LEFT[right] ?? '0..*'] }
  }
  if (right.includes('|>') || left.includes('<|')) {
    const reversed = left.includes('<|')
    if (fixedEdge) return { type: fixedEdge.type, reversed, fixed: stereo![2] }
    return { type: dashed ? pick('realization', 'generalization') : pick('generalization', 'extension'), reversed, fixed: null }
  }
  if (left.includes('*') || right.includes('*')) return { type: pick('composition', 'assignment', 'association'), reversed: right.includes('*'), fixed: null }
  if (left.includes('o') || right.includes('o')) return { type: pick('aggregation', 'association'), reversed: right.includes('o') && !left.includes('o'), fixed: null }
  const reversed = left.includes('<') && !right.includes('>')
  const headed = left.includes('<') || right.includes('>')
  if (fixedEdge) return { type: fixedEdge.type, reversed, fixed: stereo![2] }
  if (dashed) return { type: headed ? pick('dependency', 'access', 'flow') : 'dependency', reversed, fixed: null }
  if (headed) return { type: pick(spec.defaultEdge === 'flow' ? 'flow' : 'directed', 'flow', 'serving', 'directed', 'link'), reversed, fixed: null }
  return { type: pick('association', 'link', 'message', 'er', 'flow'), reversed, fixed: null }
}

// --- Diagramas de grafo -------------------------------------------------------------

/** Tipo del registro para una declaración. Con «{» se prefiere un contenedor. */
function specForDeclaration(spec: KindSpec, keyword: string, stereotypes: string[], opens: boolean): NodeSpec | null {
  const candidates = spec.nodes.filter((node) => node.keyword.split(' #')[0] === keyword)
  if (candidates.length === 0) return null
  const pseudo = candidates.find((node) => node.pseudo && stereotypes.includes(node.pseudo))
  if (pseudo) return pseudo
  const ordinary = candidates.filter((node) => !node.pseudo)
  const preferred = [...ordinary.filter((node) => Boolean(node.container) === opens), ...ordinary.filter((node) => Boolean(node.container) !== opens)]
  return (
    preferred.find((node) => node.stereotype && stereotypes.includes(node.stereotype)) ??
    preferred.find((node) => !node.stereotype) ??
    preferred[0] ??
    null
  )
}

const DECLARATION_KEYWORDS = [
  'abstract class', 'abstract', 'class', 'interface', 'enum', 'entity', 'object', 'map', 'metaclass', 'stereotype', 'annotation', 'protocol', 'struct',
  'actor', 'usecase', 'rectangle', 'component', 'node', 'database', 'cloud', 'artifact', 'queue', 'storage', 'package', 'folder', 'frame', 'card',
  'agent', 'boundary', 'control', 'collections', 'file', 'hexagon', 'person', 'stack', 'label', 'state', 'archimate', 'portin', 'portout', 'port',
]
const DECLARATION = new RegExp(`^(${DECLARATION_KEYWORDS.map((keyword) => keyword.replace(' ', '\\s+')).join('|')})\\b\\s*(.*)$`)

/** Tipo «ordinario» del diagrama para elementos usados sin declarar. */
function defaultNodeSpec(spec: KindSpec) {
  return spec.nodes.find((node) => !node.container && !node.pseudo && node.type !== 'note') ?? spec.nodes[0]
}

function parseGraph(source: string, kind: string, previous: GraphModel | null): ParseResult {
  const spec = kindSpec(kind)!
  const kept: string[] = []
  const warnings: string[] = []
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const parents: Parents = new Map()
  const byKey = new Map<string, string>()
  const stack: string[] = []
  let title: string | undefined
  let direction: GraphModel['direction'] = spec.defaultDirection
  let explicitDirection = false

  const ids = () => nodes.map((node) => node.id)
  const scope = () => stack[stack.length - 1] ?? null
  const addNode = (node: Omit<GraphNode, 'id' | 'x' | 'y'>, key: string | null, preferredId?: string | null) => {
    const id = preferredId && /^n\d+$/.test(preferredId) && !ids().includes(preferredId) ? preferredId : nextId('n', ids())
    nodes.push({ ...node, id, x: 0, y: 0 })
    parents.set(id, scope())
    if (key) byKey.set(key, id)
    byKey.set(id, id)
    return id
  }
  /** Busca un elemento por alias o nombre; si no existe lo crea (PlantUML lo permite). */
  const resolve = (operand: string, side: 'source' | 'target'): string => {
    if (operand === '[*]') {
      const type = side === 'source' ? 'initial' : 'final'
      const existing = nodes.find((node) => node.type === type && parents.get(node.id) === scope())
      return existing?.id ?? addNode({ type, name: type === 'initial' ? 'Inicio' : 'Fin' }, null)
    }
    const key = unquote(operand.replace(/^\((.*)\)$/, '$1').replace(/^:(.*):$/, '$1').replace(/^\[(.*)\]$/, '$1'))
    const found = byKey.get(operand) ?? byKey.get(key)
    if (found) return found
    let type = defaultNodeSpec(spec).type
    if (operand.startsWith('(') && spec.nodes.some((node) => node.type === 'usecase')) type = 'usecase'
    if (operand.startsWith(':') && spec.nodes.some((node) => node.type === 'actor')) type = 'actor'
    if (operand.startsWith('[') && spec.nodes.some((node) => node.type === 'component')) type = 'component'
    return addNode({ type, name: key }, key)
  }

  const lines = cleanLines(source)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^@(start|end)\w*/.test(line)) continue
    if (/^title\s+/.test(line)) {
      title = unquote(line.replace(/^title\s+/, ''))
      continue
    }
    if (/^left to right direction$/i.test(line)) {
      direction = 'left-to-right'
      explicitDirection = true
      continue
    }
    if (/^top to bottom direction$/i.test(line)) {
      direction = 'top-to-bottom'
      explicitDirection = true
      continue
    }
    if (spec.directives?.includes(line) || /^allowmixing$/i.test(line)) continue
    if (line === '}') {
      stack.pop()
      continue
    }
    if (KEPT_PREFIXES.test(line)) {
      // Bloques de skinparam o legend: se conservan completos.
      kept.push(line)
      if (line.endsWith('{') || /^legend/i.test(line)) {
        while (index + 1 < lines.length && !/^(}|endlegend)$/i.test(lines[index])) kept.push(lines[(index += 1)])
      }
      continue
    }

    // Notas: «note "x" as N», «note as N … end note», «note right of X : x», «note left of X … end note».
    const noteMatch = /^note\s+(.*)$/i.exec(line)
    if (noteMatch) {
      const rest = noteMatch[1]
      if (/^on link/i.test(rest)) {
        kept.push(line)
        if (!rest.includes(':')) while (index + 1 < lines.length && !/^end ?note$/i.test(lines[index])) kept.push(lines[(index += 1)])
        continue
      }
      const anchored = /^(?:left|right|top|bottom)(?:\s+of\s+(.+?))?\s*(?::\s*(.*))?$/i.exec(rest)
      const floating = /^(?:"(.*)"|(.*?))\s+as\s+(\w+)$/.exec(rest) ?? /^as\s+(\w+)$/.exec(rest)
      let text = ''
      let target: string | null = null
      let alias: string | null = null
      if (anchored) {
        target = anchored[1] ?? null
        text = anchored[2] ?? ''
      } else if (floating) {
        if (floating.length === 4) {
          text = floating[1] ?? floating[2] ?? ''
          alias = floating[3]
        } else alias = floating[1]
      } else {
        text = rest.replace(/^"|"$/g, '')
      }
      if (!text && !/:/.test(rest)) {
        const body: string[] = []
        while (index + 1 < lines.length && !/^end ?note$/i.test(lines[index + 1])) body.push(lines[(index += 1)])
        index += 1
        text = body.join('\n')
      }
      const noteId = addNode({ type: 'note', name: unquote(text) }, alias)
      if (target) edges.push({ id: nextId('e', edges.map((edge) => edge.id)), type: 'note-link', source: noteId, target: resolve(target, 'target') })
      continue
    }

    // Formas cortas: [Componente], (Caso de uso), :Actor:, () Interfaz → forma con palabra clave.
    const short = /^(\[[^\]]+\]|\([^)]+\)|:[^:]+:|\(\)\s*(?:"[^"]+"|[^\s<#]+))(.*)$/u.exec(line)
    const normalized = short && !RELATION.test(line)
      ? (() => {
        const [, token, rest] = short
        if (token.startsWith('()')) return `interface ${token.slice(2).trim()}${rest}`
        const keyword = token.startsWith('[') ? 'component' : token.startsWith('(') ? 'usecase' : 'actor'
        return `${keyword} "${token.slice(1, -1).trim()}"${rest}`
      })()
      : line

    // Declaraciones de elementos y contenedores.
    const declaration = DECLARATION.exec(normalized)
    if (declaration && !RELATION.test(normalized)) {
      let keyword = declaration[1].replace(/\s+/g, ' ')
      let rest = declaration[2]
      if (keyword === 'abstract') keyword = 'abstract class'
      if (keyword === 'abstract class' && /^class\b/.test(rest)) rest = rest.replace(/^class\s*/, '')
      // archimate #Business "x" as y <<tipo>>
      let layer = ''
      if (keyword === 'archimate') {
        const layerMatch = /^(#\w+)\s+(.*)$/.exec(rest)
        if (layerMatch) [, layer, rest] = layerMatch
      }
      const parts = parseNameParts(rest)
      let nodeSpecValue = specForDeclaration(spec, keyword, parts.stereotypes, parts.opens)
      if (keyword === 'archimate' && layer) {
        nodeSpecValue = spec.nodes.find((node) => node.keyword === `archimate ${layer}` && parts.stereotypes.includes(node.stereotype ?? '')) ?? nodeSpecValue
      }
      if (!nodeSpecValue) {
        nodeSpecValue = parts.opens && spec.nodes.some((node) => node.container) && !['class', 'abstract class', 'interface', 'enum', 'entity', 'object'].includes(keyword)
          ? spec.nodes.find((node) => node.container)!
          : defaultNodeSpec(spec)
        warnings.push(`«${keyword} ${parts.name}» no es un elemento de este diagrama: se convirtió en «${nodeSpecValue.label}».`)
      }
      const extraStereotypes = parts.stereotypes.filter((value) => value !== nodeSpecValue!.stereotype && value !== nodeSpecValue!.pseudo)
      // Un elemento usado antes en una relación y declarado después es el mismo
      // (p. ej. «A --> B» y luego «state B { … }»): se actualiza, no se duplica.
      const existingId = byKey.get(parts.alias ?? parts.name)
      const existing = existingId ? nodes.find((item) => item.id === existingId) : undefined
      let id: string
      if (existing) {
        existing.type = nodeSpecValue.type
        if (parts.alias) existing.name = parts.name
        if (extraStereotypes.length) existing.stereotype = extraStereotypes.join(', ')
        parents.set(existing.id, scope())
        id = existing.id
      } else {
        const node: Omit<GraphNode, 'id' | 'x' | 'y'> = { type: nodeSpecValue.type, name: parts.name }
        if (extraStereotypes.length) node.stereotype = extraStereotypes.join(', ')
        id = addNode(node, parts.alias ?? parts.name, parts.alias)
      }
      if (parts.alias) byKey.set(parts.name, id)

      if (parts.opens) {
        if (nodeSpecValue.container) {
          stack.push(id)
        } else {
          // Bloque de atributos y métodos hasta «}».
          const attributes: string[] = []
          const methods: string[] = []
          while (index + 1 < lines.length && lines[index + 1] !== '}') {
            const memberLine = lines[(index += 1)]
            const separator = /^(--|==|\.\.|__)/.test(memberLine)
            if (nodeSpecValue.members === 'class') {
              if (separator) continue
              ;(memberLine.includes('(') ? methods : attributes).push(memberLine)
            } else {
              attributes.push(memberLine)
            }
          }
          index += 1
          const created = nodes.find((item) => item.id === id)!
          if (attributes.length) created.attributes = attributes
          if (methods.length) created.methods = methods
        }
      }
      continue
    }

    // Relaciones.
    const relation = RELATION.exec(line)
    if (relation) {
      const [, left, leftLabel, arrowText, rightLabel, right, text = ''] = relation
      const arrow = parseArrow(arrowText)
      const classified = classifyArrow(spec, arrow, text.trim())
      let source = resolve(left, classified.reversed ? 'target' : 'source')
      let target = resolve(right, classified.reversed ? 'source' : 'target')
      let sourceLabel = leftLabel
      let targetLabel = rightLabel
      if (classified.reversed) {
        ;[source, target] = [target, source]
        ;[sourceLabel, targetLabel] = [targetLabel, sourceLabel]
      }
      const isNote = (id: string) => nodes.find((node) => node.id === id)?.type === 'note'
      const type = isNote(source) || isNote(target) ? 'note-link' : classified.type
      const edgeSpecValue: EdgeSpec = edgeSpec(kind, type)
      const edge: GraphEdge = { id: nextId('e', edges.map((item) => item.id)), type, source, target }
      const plain = edgeSpecValue.fixedText ? classified.fixed ?? text.replace(/^<<[^>]*>>\s*/, '') : text
      if (plain.trim() && type !== 'include' && type !== 'extend') edge.label = unquote(plain)
      if (classified.ends) [edge.sourceLabel, edge.targetLabel] = classified.reversed ? [classified.ends[1], classified.ends[0]] : classified.ends
      else {
        if (sourceLabel) edge.sourceLabel = sourceLabel
        if (targetLabel) edge.targetLabel = targetLabel
      }
      edges.push(edge)
      continue
    }

    // Descripción de estado («s1 : texto») u otra cosa: se conserva.
    kept.push(line)
  }

  let model: GraphModel = {
    kind,
    version: 1,
    direction,
    layout: explicitDirection && !previous ? 'auto' : previous?.layout ?? 'canvas',
    nodes,
    edges,
    ...(title ? { title } : {}),
    ...(kept.length ? { extra: kept } : {}),
  }
  model = placeNodes(model, parents, previous)
  return { model, kept, warnings }
}

/**
 * Posiciones: los elementos que ya estaban en el lienzo (mismo alias, o mismo
 * tipo y nombre) conservan su lugar y tamaño; el resto se distribuye solo.
 */
function placeNodes(input: GraphModel, inputParents: Parents, previous: GraphModel | null): GraphModel {
  if (!previous || previous.nodes.length === 0) return autoLayout(input, inputParents)
  const { model, parents } = adoptPreviousIds(input, inputParents, previous)
  const usedPrevious = new Set<string>()
  const matched = new Set<string>()
  const nodes = model.nodes.map((node) => {
    const old =
      previous.nodes.find((item) => item.id === node.id && item.type === node.type && !usedPrevious.has(item.id)) ??
      previous.nodes.find((item) => item.type === node.type && item.name === node.name && !usedPrevious.has(item.id))
    if (!old) return node
    usedPrevious.add(old.id)
    matched.add(node.id)
    return { ...node, x: old.x, y: old.y, ...(old.width ? { width: old.width, height: old.height } : {}) }
  })
  const pending = model.nodes.filter((node) => !matched.has(node.id))
  if (pending.length === 0) {
    // Los codos se conservan si la relación sigue uniendo los mismos elementos.
    return { ...model, nodes, edges: keepBends(model, previous) }
  }
  // Los nuevos se distribuyen entre sí y se ubican a la derecha de lo existente.
  const laid = autoLayout({ ...model, nodes }, parents, new Set(pending.map((node) => node.id)))
  const existingRight = Math.max(0, ...nodes.filter((node) => matched.has(node.id)).map((node) => node.x + nodeSize(model.kind, node).width))
  const newLeft = Math.min(...laid.nodes.filter((node) => !matched.has(node.id)).map((node) => node.x))
  const shift = existingRight + 80 - newLeft
  return {
    ...model,
    edges: keepBends(model, previous),
    nodes: laid.nodes.map((node) => (matched.has(node.id) ? node : { ...node, x: snap(node.x + shift) })),
  }
}

/**
 * Los elementos reconocidos (mismo tipo y nombre) toman el id que tenían en el
 * lienzo, si está libre: así sus relaciones, posiciones y codos siguen estables
 * aunque el código los cree de nuevo (p. ej. los [*] de inicio y fin).
 */
function adoptPreviousIds(model: GraphModel, parents: Parents, previous: GraphModel): { model: GraphModel; parents: Parents } {
  const currentIds = new Set(model.nodes.map((node) => node.id))
  const takenPrevious = new Set(model.nodes.filter((node) => previous.nodes.some((old) => old.id === node.id && old.type === node.type)).map((node) => node.id))
  const previousParents = containerMap(previous.kind, previous.nodes)
  const isPseudo = (node: GraphNode) => node.type === 'initial' || node.type === 'final'
  const rename = new Map<string, string>()
  // Primero los elementos con nombre propio; luego inicio y fin, que se reconocen
  // por su contenedor (puede haber un [*] por cada estado compuesto).
  for (const node of [...model.nodes.filter((item) => !isPseudo(item)), ...model.nodes.filter(isPseudo)]) {
    if (takenPrevious.has(node.id)) continue
    const parent = parents.get(node.id) ?? null
    const old = previous.nodes.find((item) =>
      item.type === node.type && item.name === node.name && !takenPrevious.has(item.id) && !currentIds.has(item.id) &&
      (!isPseudo(node) || (previousParents.get(item.id) ?? null) === (parent ? rename.get(parent) ?? parent : null)))
    if (old) {
      rename.set(node.id, old.id)
      takenPrevious.add(old.id)
    }
  }
  if (rename.size === 0) return { model, parents }
  const map = (id: string) => rename.get(id) ?? id
  const nextParents: Parents = new Map([...parents].map(([id, parent]) => [map(id), parent ? map(parent) : null]))
  return {
    parents: nextParents,
    model: {
      ...model,
      nodes: model.nodes.map((node) => ({ ...node, id: map(node.id) })),
      edges: model.edges.map((edge) => ({ ...edge, source: map(edge.source), target: map(edge.target) })),
    },
  }
}

function keepBends(model: GraphModel, previous: GraphModel): GraphEdge[] {
  return model.edges.map((edge) => {
    const old = previous.edges.find((item) => item.source === edge.source && item.target === edge.target && item.type === edge.type && item.points?.length)
    return old ? { ...edge, points: old.points } : edge
  })
}

// --- Actividades con sintaxis estructurada (start, :acción;, if, fork…) ------------------

type Exit = { from: string; label?: string }

/**
 * Convierte la sintaxis nueva de actividades en un grafo: cada bloque devuelve
 * las «salidas» pendientes que se conectan con lo siguiente.
 */
function parseActivity(source: string, kind: string, previous: GraphModel | null): ParseResult {
  const spec = kindSpec(kind)!
  const lines = cleanLines(source)
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const parents: Parents = new Map()
  const kept: string[] = []
  const warnings: string[] = []
  let title: string | undefined
  let lane: string | null = null
  const lanes = new Map<string, string>()
  const has = (type: string) => spec.nodes.some((node) => node.type === type)

  const add = (type: string, name: string) => {
    const resolved = has(type) ? type : type === 'fork' || type === 'join' ? 'action' : type
    const id = nextId('n', nodes.map((node) => node.id))
    nodes.push({ id, type: resolved, name, x: 0, y: 0 })
    parents.set(id, lane)
    return id
  }
  const connect = (exits: Exit[], to: string) => {
    for (const exit of exits) {
      const edge: GraphEdge = { id: nextId('e', edges.map((item) => item.id)), type: 'flow', source: exit.from, target: to }
      if (exit.label) edge.label = exit.label
      edges.push(edge)
    }
  }

  let index = 0
  const peek = () => lines[index]
  /** Bloque hasta una de las palabras de cierre; devuelve las salidas abiertas. */
  const block = (exits: Exit[], stop: RegExp): Exit[] => {
    let current = exits
    while (index < lines.length && !stop.test(peek())) {
      const line = lines[index]
      index += 1
      if (/^@(start|end)/.test(line)) continue
      if (/^title\s+/.test(line)) {
        title = unquote(line.replace(/^title\s+/, ''))
        continue
      }
      const laneMatch = /^\|(?:#\w+\|)?([^|]+)\|$/.exec(line)
      if (laneMatch) {
        const name = laneMatch[1].trim()
        if (!lanes.has(name)) {
          const saved = lane
          lane = null
          lanes.set(name, add('lane', name))
          lane = saved
        }
        lane = lanes.get(name)!
        continue
      }
      if (/^start$/.test(line)) {
        const id = add('initial', 'Inicio')
        connect(current, id)
        current = [{ from: id }]
        continue
      }
      if (/^(stop|end)$/.test(line)) {
        const id = add('final', 'Fin')
        connect(current, id)
        current = []
        continue
      }
      if (/^(kill|detach)$/.test(line)) {
        current = []
        continue
      }
      if (line.startsWith(':')) {
        // Acción: puede ocupar varias líneas hasta «;».
        let text = line.slice(1)
        while (!/[;|<>/\]}]$/.test(text) && index < lines.length) text += `\n${lines[(index += 1) - 1]}`
        const id = add('action', text.replace(/[;|<>/\]}]$/, '').trim())
        connect(current, id)
        current = [{ from: id }]
        continue
      }
      const ifMatch = /^if\s*\((.*?)\)\s*(?:then|is)?\s*(?:\((.*)\))?$/.exec(line)
      if (ifMatch) {
        const decision = add('choice', ifMatch[1].trim())
        connect(current, decision)
        const outs: Exit[] = []
        let branchLabel = ifMatch[2]?.trim()
        for (;;) {
          outs.push(...block([{ from: decision, label: branchLabel }], /^(else|elseif|endif|end if)\b/))
          const closing = lines[index] ?? 'endif'
          index += 1
          const elseIf = /^elseif\s*\((.*?)\)\s*(?:then)?\s*(?:\((.*)\))?$/.exec(closing)
          if (elseIf) {
            branchLabel = `${elseIf[1].trim()}${elseIf[2] ? ` (${elseIf[2].trim()})` : ''}`
            continue
          }
          const elseMatch = /^else\s*(?:\((.*)\))?$/.exec(closing)
          if (elseMatch) {
            outs.push(...block([{ from: decision, label: elseMatch[1]?.trim() }], /^(endif|end if)\b/))
            index += 1
          } else {
            outs.push({ from: decision, label: 'no' })
          }
          break
        }
        current = outs
        continue
      }
      const whileMatch = /^while\s*\((.*?)\)\s*(?:is\s*\((.*)\))?$/.exec(line)
      if (whileMatch) {
        const decision = add('choice', whileMatch[1].trim())
        connect(current, decision)
        const bodyExits = block([{ from: decision, label: whileMatch[2]?.trim() }], /^(endwhile|end while)\b/)
        connect(bodyExits, decision)
        const closing = /^end ?while\s*(?:\((.*)\))?$/.exec(lines[index] ?? '')
        index += 1
        current = [{ from: decision, label: closing?.[1]?.trim() }]
        continue
      }
      if (/^repeat$/.test(line)) {
        const startCount = nodes.length
        const bodyExits = block(current, /^repeat\s+while\b/)
        const closing = /^repeat\s+while\s*\((.*?)\)\s*(?:is\s*\((.*)\))?\s*(?:not\s*\((.*)\))?$/.exec(lines[index] ?? '')
        index += 1
        const decision = add('choice', closing?.[1]?.trim() ?? 'repetir')
        connect(bodyExits, decision)
        const firstInLoop = nodes[startCount]?.id
        if (firstInLoop) connect([{ from: decision, label: closing?.[2]?.trim() }], firstInLoop)
        current = [{ from: decision, label: closing?.[3]?.trim() }]
        continue
      }
      if (/^(fork|split)$/.test(line)) {
        const forkId = add('fork', 'fork')
        connect(current, forkId)
        const outs: Exit[] = []
        for (;;) {
          outs.push(...block([{ from: forkId }], /^(fork again|split again|end fork|end split|end merge)\b/))
          const closing = lines[index] ?? 'end fork'
          index += 1
          if (/again/.test(closing)) continue
          break
        }
        const joinId = add('join', 'join')
        connect(outs, joinId)
        current = [{ from: joinId }]
        continue
      }
      if (/^note\b/.test(line)) {
        let text = line.replace(/^note\s+(left|right)?\s*:?\s*/, '')
        if (!line.includes(':')) {
          const body: string[] = []
          while (index < lines.length && !/^end ?note$/.test(lines[index])) body.push(lines[(index += 1) - 1])
          index += 1
          text = body.join('\n')
        }
        const noteId = add('note', text)
        const last = current[current.length - 1]
        if (last) edges.push({ id: nextId('e', edges.map((item) => item.id)), type: 'note-link', source: noteId, target: last.from })
        continue
      }
      if (/^partition\s+/.test(line)) {
        warnings.push('Las particiones se convirtieron en carriles.')
        const name = unquote(line.replace(/^partition\s+/, '').replace(/\{$/, '').trim())
        lanes.set(name, lanes.get(name) ?? add('lane', name))
        lane = lanes.get(name)!
        continue
      }
      if (line === '}') {
        lane = null
        continue
      }
      kept.push(line)
    }
    return current
  }
  block([], /^\0$/)

  // Los carriles no existen en todos los tipos: sin ellos, los elementos quedan sueltos.
  if (!has('lane')) {
    for (const node of nodes) if (node.type === 'lane') warnings.push(`El carril «${node.name}» no existe en este tipo de diagrama y se quitó.`)
    const removed = new Set(nodes.filter((node) => node.type === 'lane').map((node) => node.id))
    for (const [id, parent] of parents) if (parent && removed.has(parent)) parents.set(id, null)
    nodes.splice(0, nodes.length, ...nodes.filter((node) => !removed.has(node.id)))
  }
  let model: GraphModel = { kind, version: 1, direction: spec.defaultDirection, layout: previous?.layout ?? 'canvas', nodes, edges, ...(title ? { title } : {}), ...(kept.length ? { extra: kept } : {}) }
  model = placeNodes(model, parents, previous)
  return { model, kept, warnings }
}

// --- Secuencia ------------------------------------------------------------------------

const PARTICIPANT_KEYWORDS: ParticipantType[] = ['actor', 'participant', 'boundary', 'control', 'entity', 'database', 'collections', 'queue']
const MESSAGE = /^([\p{L}\p{N}_.]+|"[^"]+")\s*([<]?-{1,2}[>x\\/]{0,2}(?:\[[^\]]*\])?[>]{0,2}|[<]{1,2}-{1,2})\s*([\p{L}\p{N}_.]+|"[^"]+")\s*(?::\s*(.*))?$/u

function parseSequence(source: string): ParseResult {
  const lines = cleanLines(source)
  const participants: Participant[] = []
  const messages: Message[] = []
  const kept: string[] = []
  const byKey = new Map<string, string>()
  let autonumber = false
  let title: string | undefined

  const participant = (type: ParticipantType, name: string, alias: string | null) => {
    const id = nextId('p', participants.map((item) => item.id))
    participants.push({ id, type, name })
    byKey.set(alias ?? name, id)
    byKey.set(name, id)
    return id
  }
  const resolve = (operand: string) => byKey.get(operand) ?? byKey.get(unquote(operand)) ?? participant('participant', unquote(operand), null)
  const raw = (text: string) => messages.push({ id: nextId('m', messages.map((item) => item.id)), from: '', to: '', label: '', type: 'sync', raw: text })

  for (const line of lines) {
    if (/^@(start|end)/.test(line)) continue
    if (/^title\s+/.test(line)) {
      title = unquote(line.replace(/^title\s+/, ''))
      continue
    }
    if (/^autonumber\b/.test(line)) {
      autonumber = true
      continue
    }
    if (KEPT_PREFIXES.test(line)) {
      kept.push(line)
      continue
    }
    const declaration = new RegExp(`^(${PARTICIPANT_KEYWORDS.join('|')})\\s+(.*)$`).exec(line)
    if (declaration) {
      const parts = parseNameParts(declaration[2])
      participant(declaration[1] as ParticipantType, parts.name, parts.alias)
      continue
    }
    const message = MESSAGE.exec(line)
    if (message) {
      const [, left, arrow, right, text = ''] = message
      const reversed = arrow.startsWith('<')
      const type: MessageType = arrow.includes('--') ? 'reply' : arrow.replace(/<|-/g, '').startsWith('>>') || /^-+>>/.test(arrow) || /<<-/.test(arrow) ? 'async' : 'sync'
      const from = resolve(reversed ? right : left)
      const to = resolve(reversed ? left : right)
      messages.push({ id: nextId('m', messages.map((item) => item.id)), from, to, label: unquote(text), type })
      continue
    }
    // alt/else/end, loop, notas, activaciones, divisores…: quedan en su lugar como filas propias.
    raw(line)
  }
  const model: SequenceModel = { kind: 'sequence', version: 1, autonumber, participants, messages, ...(title ? { title } : {}), ...(kept.length ? { extra: kept } : {}) }
  return { model, kept, warnings: [] }
}

// --- Entrada principal ---------------------------------------------------------------------

const STRUCTURED_ACTIVITY = /^\s*(start|stop|:[^\n]*|if\s*\(|while\s*\(|repeat\b|fork$|\|[^|]+\|)/m

/** Modelo visual a partir de PlantUML. `previous` aporta las posiciones ya conocidas. */
export function parsePlantUml(source: string, kind: string, previous: VisualModel | null = null): ParseResult {
  if (isStructuredKind(kind)) return parseStructured(source, kind)
  if (kind === 'sequence') return parseSequence(source)
  const graphPrevious = previous && previous.kind !== 'sequence' ? (previous as GraphModel) : null
  const spec = kindSpec(kind)
  if (!spec) throw new Error(`El tipo «${kind}» no tiene editor visual.`)
  if (spec.syntax === 'state' && kind !== 'state' && STRUCTURED_ACTIVITY.test(source)) return parseActivity(source, kind, graphPrevious)
  return parseGraph(source, kind, graphPrevious)
}

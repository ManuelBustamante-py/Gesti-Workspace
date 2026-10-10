import { center, containerMap, nodeRect } from './geometry'
import { edgeSpec, kindSpec, nodeSpec } from './kinds'
import { generateStructured, isStructuredKind, type StructuredModel } from './structured'
import type { GraphEdge, GraphModel, GraphNode, MessageType, SequenceModel, VisualModel } from './visualModel'

/** Texto entre comillas de PlantUML: sin comillas dobles y con saltos como \n. */
export function quoted(text: string) {
  const clean = (text.trim() || 'Sin nombre').replace(/"/g, "'").replace(/\r?\n/g, '\\n')
  return `"${clean}"`
}

/** Etiqueta tras «:» en relaciones y mensajes (una sola línea). */
function label(text: string | undefined) {
  const clean = (text ?? '').trim().replace(/\r?\n/g, '\\n')
  return clean ? ` : ${clean}` : ''
}

/** Estereotipo «...» sin caracteres que lo cierren antes de tiempo. */
function stereotype(text: string | undefined) {
  const clean = (text ?? '').trim().replace(/[<>]/g, '')
  return clean ? ` <<${clean}>>` : ''
}

/** Una línea de atributo o método; una «}» sola cerraría el bloque. */
function member(line: string) {
  const clean = line.replace(/\r?\n/g, ' ').trim()
  return clean === '}' || clean === '{' ? `"${clean}"` : clean
}

/** Cardinalidad (1, 0..1, 1..*, 0..*) → símbolo de pata de gallo en cada extremo. */
const CARDINALITY_LEFT: Record<string, string> = { '1': '||', '0..1': '|o', '1..*': '}|', '0..*': '}o', '*': '}o' }
const CARDINALITY_RIGHT: Record<string, string> = { '1': '||', '0..1': 'o|', '1..*': '|{', '0..*': 'o{', '*': 'o{' }

/** Inserta la dirección en la flecha («-->» → «-right->», «..|>» → «.right.|>»). */
export function directedArrow(arrow: string, direction: 'up' | 'down' | 'left' | 'right') {
  return arrow.replace(/([-.])\1/, (_, dash: string) => `${dash}${direction}${dash}`)
}

/** Dirección dominante de un elemento a otro según sus posiciones en el lienzo. */
function directionBetween(kind: string, source: GraphNode, target: GraphNode) {
  const a = center(nodeRect(kind, source))
  const b = center(nodeRect(kind, target))
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) > Math.abs(dy) * 1.2) return dx > 0 ? 'right' : 'left'
  return dy >= 0 ? 'down' : 'up'
}

// --- Diagramas de grafo -----------------------------------------------------------

/** En estados y actividades la nota se ancla a un elemento: «note right of X». */
function anchoredNote(model: GraphModel, note: GraphNode, target: GraphNode, indent: string): string[] {
  const a = center(nodeRect(model.kind, target))
  const b = center(nodeRect(model.kind, note))
  const side = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? (b.x < a.x ? 'left' : 'right') : b.y < a.y ? 'top' : 'bottom'
  const lines = note.name.trim().split(/\r?\n/)
  return lines.length === 1
    ? [`${indent}note ${side} of ${target.id} : ${lines[0]}`]
    : [`${indent}note ${side} of ${target.id}`, ...lines.map((line) => `${indent}  ${line}`), `${indent}end note`]
}

function declaration(model: GraphModel, node: GraphNode, indent: string, inContainer: boolean): string[] {
  const spec = nodeSpec(model.kind, node.type)
  const syntax = kindSpec(model.kind)?.syntax ?? 'description'
  const st = stereotype(node.stereotype || spec.stereotype)
  const color = spec.color && !spec.keyword.includes('#') ? ` ${spec.color}` : ''

  if (spec.pseudo === 'initial' || spec.pseudo === 'final') return []
  if (spec.pseudo) return [`${indent}state ${quoted(node.name)} as ${node.id} <<${spec.pseudo}>>`]
  if (node.type === 'note') {
    // En estados, las notas enlazadas se anclan a su elemento (los enlaces «..» no existen ahí).
    const link = syntax === 'state' ? model.edges.find((edge) => edge.type === 'note-link' && (edge.source === node.id || edge.target === node.id)) : undefined
    const target = link ? model.nodes.find((item) => item.id === (link.source === node.id ? link.target : link.source)) : undefined
    return target ? anchoredNote(model, node, target, indent) : [`${indent}note ${quoted(node.name)} as ${node.id}`]
  }
  // Un puerto solo existe dentro de un componente: fuera de él se declara como interfaz.
  const keyword = (spec.keyword === 'portin' || spec.keyword === 'portout') && !inContainer ? 'interface' : spec.keyword

  const head = `${indent}${keyword} ${quoted(node.name)} as ${node.id}${st}${color}`
  if (!spec.members || syntax !== 'class') return [head]
  const attributes = (node.attributes ?? []).map(member).filter(Boolean)
  const methods = spec.members === 'class' ? (node.methods ?? []).map(member).filter(Boolean) : []
  if (attributes.length === 0 && methods.length === 0) return [head]
  return [
    `${head} {`,
    ...attributes.map((line) => `${indent}  ${line}`),
    // «--» separa atributos de métodos aunque no haya atributos.
    ...(methods.length > 0 ? [`${indent}  --`, ...methods.map((line) => `${indent}  ${line}`)] : []),
    `${indent}}`,
  ]
}

function relation(model: GraphModel, edge: GraphEdge, nodes: Map<string, GraphNode>): string | null {
  const source = nodes.get(edge.source)
  const target = nodes.get(edge.target)
  if (!source || !target) return null
  const spec = edgeSpec(model.kind, edge.type)
  // Las notas ancladas de estados ya se declararon con «note … of»; no llevan enlace.
  if (edge.type === 'note-link' && kindSpec(model.kind)?.syntax === 'state') return null
  const sourcePseudo = nodeSpec(model.kind, source.type).pseudo
  const targetPseudo = nodeSpec(model.kind, target.type).pseudo
  // [*] solo puede ser origen (inicio) o destino (fin).
  if (sourcePseudo === 'final' || targetPseudo === 'initial') return null
  const from = sourcePseudo === 'initial' ? '[*]' : source.id
  const to = targetPseudo === 'final' ? '[*]' : target.id

  let arrow = spec.arrow
  let ends = { source: '', target: '' }
  if (spec.ends === 'cardinality') {
    arrow = `${CARDINALITY_LEFT[edge.sourceLabel?.trim() ?? ''] ?? '||'}--${CARDINALITY_RIGHT[edge.targetLabel?.trim() ?? ''] ?? 'o{'}`
  } else if (spec.ends === 'multiplicity') {
    ends = {
      source: edge.sourceLabel?.trim() ? ` ${quoted(edge.sourceLabel)}` : '',
      target: edge.targetLabel?.trim() ? ` ${quoted(edge.targetLabel)}` : '',
    }
  }
  if (model.layout === 'canvas' && source.id !== target.id && edge.type !== 'note-link') arrow = directedArrow(arrow, directionBetween(model.kind, source, target))
  const text = spec.fixedText ? ` : <<${spec.fixedText}>>${edge.label?.trim() ? ` ${edge.label.trim()}` : ''}` : label(edge.label)
  return `${from}${ends.source} ${arrow}${ends.target} ${to}${text}`
}

function generateGraph(model: GraphModel) {
  const spec = kindSpec(model.kind)
  const nodes = new Map(model.nodes.map((node) => [node.id, node]))
  const parents = containerMap(model.kind, model.nodes)
  const childrenOf = (parent: string | null) => model.nodes.filter((node) => (parents.get(node.id) ?? null) === parent)
  const pseudoParent = (id: string) => {
    const node = nodes.get(id)
    const pseudo = node ? nodeSpec(model.kind, node.type).pseudo : undefined
    return pseudo === 'initial' || pseudo === 'final' ? parents.get(id) ?? null : undefined
  }
  // Las transiciones con [*] van dentro del estado compuesto donde está ese inicio/fin.
  const scopeOf = (edge: GraphEdge) => pseudoParent(edge.source) ?? pseudoParent(edge.target) ?? null

  const lines: string[] = ['@startuml']
  if (model.title?.trim()) lines.push(`title ${model.title.trim().replace(/\r?\n/g, '\\n')}`)
  lines.push(...(spec?.directives ?? []))
  if (model.direction === 'left-to-right' && model.layout !== 'canvas') lines.push('left to right direction')
  lines.push(...(model.extra ?? []))

  const emitEdges = (scope: string | null, indent: string) => {
    for (const edge of model.edges) {
      if (scopeOf(edge) !== scope) continue
      const line = relation(model, edge, nodes)
      if (line) lines.push(`${indent}${line}`)
    }
  }

  const emit = (parent: string | null, depth: number) => {
    const indent = '  '.repeat(depth)
    for (const node of childrenOf(parent)) {
      const nodeSpecValue = nodeSpec(model.kind, node.type)
      if (nodeSpecValue.container) {
        const color = nodeSpecValue.color ? ` ${nodeSpecValue.color}` : ''
        lines.push(`${indent}${nodeSpecValue.keyword} ${quoted(node.name)} as ${node.id}${stereotype(node.stereotype || nodeSpecValue.stereotype)}${color} {`)
        emit(node.id, depth + 1)
        emitEdges(node.id, `${indent}  `)
        lines.push(`${indent}}`)
      } else {
        lines.push(...declaration(model, node, indent, parent !== null))
      }
    }
  }
  emit(null, 0)
  emitEdges(null, '')
  lines.push('@enduml')
  return lines.join('\n')
}

// --- Secuencia ----------------------------------------------------------------------

const MESSAGE_ARROWS: Record<MessageType, string> = { sync: '->', async: '->>', reply: '-->' }

function generateSequence(model: SequenceModel) {
  const ids = new Set(model.participants.map((participant) => participant.id))
  const lines = ['@startuml']
  if (model.title?.trim()) lines.push(`title ${model.title.trim().replace(/\r?\n/g, '\\n')}`)
  if (model.autonumber) lines.push('autonumber')
  lines.push(...(model.extra ?? []))
  for (const participant of model.participants) {
    lines.push(`${participant.type} ${quoted(participant.name)} as ${participant.id}`)
  }
  for (const message of model.messages) {
    if (message.raw !== undefined) {
      if (message.raw.trim()) lines.push(message.raw.trim())
      continue
    }
    if (!ids.has(message.from) || !ids.has(message.to)) continue
    lines.push(`${message.from} ${MESSAGE_ARROWS[message.type]} ${message.to}${label(message.label)}`)
  }
  lines.push('@enduml')
  return lines.join('\n')
}

/** PlantUML equivalente al modelo visual. */
export function generatePlantUml(model: VisualModel) {
  if (isStructuredKind(model.kind)) return generateStructured(model as StructuredModel)
  return model.kind === 'sequence' ? generateSequence(model as SequenceModel) : generateGraph(model as GraphModel)
}

import { containerMap } from './geometry'
import type { EdgeType, GraphEdge, GraphModel, GraphNode, MessageType, SequenceModel, VisualModel } from './visualModel'

/** Texto entre comillas de PlantUML: sin comillas dobles y con saltos como \n. */
function quoted(text: string) {
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

/** Una línea de atributo o método; una «}» sola cerraría el bloque de la clase. */
function member(line: string) {
  const clean = line.replace(/\r?\n/g, ' ').trim()
  return clean === '}' || clean === '{' ? `"${clean}"` : clean
}

// --- Casos de uso y clases ----------------------------------------------------

const ARROWS: Record<EdgeType, string> = {
  association: '--',
  directed: '-->',
  include: '..>',
  extend: '..>',
  generalization: '--|>',
  realization: '..|>',
  dependency: '..>',
  aggregation: 'o--',
  composition: '*--',
  'note-link': '..',
}

function declaration(node: GraphNode, kind: GraphModel['kind'], indent: string): string[] {
  const alias = `as ${node.id}`
  switch (node.type) {
    case 'actor':
      return [`${indent}actor ${quoted(node.name)} ${alias}${stereotype(node.stereotype)}`]
    case 'usecase':
      return [`${indent}usecase ${quoted(node.name)} ${alias}${stereotype(node.stereotype)}`]
    case 'note':
      return [`${indent}note ${quoted(node.name)} ${alias}`]
    default: {
      const keyword = node.type === 'abstract' ? 'abstract class' : node.type === 'interface' ? 'interface' : node.type === 'enum' ? 'enum' : 'class'
      const head = `${indent}${keyword} ${quoted(node.name)} ${alias}${stereotype(node.stereotype)}`
      const attributes = (node.attributes ?? []).map(member).filter(Boolean)
      const methods = node.type === 'enum' ? [] : (node.methods ?? []).map(member).filter(Boolean)
      if (kind === 'usecase' || (attributes.length === 0 && methods.length === 0)) return [head]
      return [
        `${head} {`,
        ...attributes.map((line) => `${indent}  ${line}`),
        // «--» separa atributos de métodos aunque no haya atributos.
        ...(methods.length > 0 ? [`${indent}  --`, ...methods.map((line) => `${indent}  ${line}`)] : []),
        `${indent}}`,
      ]
    }
  }
}

function relation(edge: GraphEdge, model: GraphModel) {
  const source = edge.sourceLabel?.trim() ? ` ${quoted(edge.sourceLabel)}` : ''
  const target = edge.targetLabel?.trim() ? ` ${quoted(edge.targetLabel)}` : ''
  const text =
    edge.type === 'include' ? ' : <<include>>' : edge.type === 'extend' ? ' : <<extend>>' : label(edge.label)
  const multiplicities = model.kind === 'class' ? { source, target } : { source: '', target: '' }
  return `${edge.source}${multiplicities.source} ${ARROWS[edge.type]}${multiplicities.target} ${edge.target}${text}`
}

function generateGraph(model: GraphModel) {
  const ids = new Set(model.nodes.map((node) => node.id))
  const parents = containerMap(model.nodes)
  const childrenOf = (parent: string | null) => model.nodes.filter((node) => (parents.get(node.id) ?? null) === parent)

  const lines: string[] = ['@startuml']
  if (model.direction === 'left-to-right') lines.push('left to right direction')
  if (model.kind === 'class') lines.push('hide empty members')

  const emit = (parent: string | null, depth: number) => {
    const indent = '  '.repeat(depth)
    for (const node of childrenOf(parent)) {
      if (node.type === 'boundary' || node.type === 'package') {
        const keyword = node.type === 'boundary' ? 'rectangle' : 'package'
        lines.push(`${indent}${keyword} ${quoted(node.name)} as ${node.id}${stereotype(node.stereotype)} {`)
        emit(node.id, depth + 1)
        lines.push(`${indent}}`)
      } else {
        lines.push(...declaration(node, model.kind, indent))
      }
    }
  }
  emit(null, 0)

  for (const edge of model.edges) {
    if (ids.has(edge.source) && ids.has(edge.target)) lines.push(relation(edge, model))
  }
  lines.push('@enduml')
  return lines.join('\n')
}

// --- Secuencia ------------------------------------------------------------------

const MESSAGE_ARROWS: Record<MessageType, string> = { sync: '->', async: '->>', reply: '-->' }

function generateSequence(model: SequenceModel) {
  const ids = new Set(model.participants.map((participant) => participant.id))
  const lines = ['@startuml']
  if (model.autonumber) lines.push('autonumber')
  for (const participant of model.participants) {
    lines.push(`${participant.type} ${quoted(participant.name)} as ${participant.id}`)
  }
  for (const message of model.messages) {
    if (!ids.has(message.from) || !ids.has(message.to)) continue
    lines.push(`${message.from} ${MESSAGE_ARROWS[message.type]} ${message.to}${label(message.label)}`)
  }
  lines.push('@enduml')
  return lines.join('\n')
}

/** PlantUML equivalente al modelo visual. */
export function generatePlantUml(model: VisualModel) {
  return model.kind === 'sequence' ? generateSequence(model) : generateGraph(model)
}

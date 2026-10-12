/**
 * Extracción: de cada diagrama guardado (modelo visual o código PlantUML) al
 * modelo arquitectónico común. Reutiliza el modelo y el parser del editor; no
 * hay otro lector de PlantUML. La confianza baja cuando el código tiene líneas
 * que el parser no entiende o cuando el modelo guardado no es válido.
 */
import { containerMap } from '../geometry'
import { parsePlantUml } from '../parsePlantUml'
import { modelFromDiagram, type GraphModel, type SequenceModel, type VisualModel } from '../visualModel'
import type {
  AnalyzedKind,
  ArchDiagram,
  ArchElement,
  ArchMessage,
  ArchRelation,
  ArchitectureModel,
  ArchitectureView,
  Attribute,
  CallSignature,
  DiagramInput,
  ElementKind,
  Extraction,
  Operation,
  Parameter,
  RelationType,
} from './types'

export const KIND_VIEW: Record<AnalyzedKind, ArchitectureView> = {
  usecase: 'scenarios',
  sequence: 'process',
  class: 'logical',
  package: 'development',
  component: 'development',
  deployment: 'physical',
  er: 'data',
}

export const isAnalyzedKind = (kind: string): kind is AnalyzedKind => kind in KIND_VIEW

/** Tipo de nodo del editor → tipo de elemento normalizado (por tipo de diagrama). */
const NODE_KINDS: Record<AnalyzedKind, Record<string, { kind: ElementKind; subtype?: string }>> = {
  usecase: { actor: { kind: 'actor' }, usecase: { kind: 'usecase' }, boundary: { kind: 'system' } },
  class: {
    class: { kind: 'class' }, abstract: { kind: 'class', subtype: 'abstract' }, interface: { kind: 'interface' },
    enum: { kind: 'enum' }, package: { kind: 'package' },
  },
  package: { package: { kind: 'package' }, class: { kind: 'class' }, interface: { kind: 'interface' } },
  component: {
    component: { kind: 'component' }, interface: { kind: 'interface' }, database: { kind: 'datastore' }, queue: { kind: 'queue' },
    package: { kind: 'package' }, node: { kind: 'node' }, cloud: { kind: 'node', subtype: 'cloud' },
  },
  deployment: {
    node: { kind: 'node' }, device: { kind: 'node', subtype: 'device' }, cloud: { kind: 'node', subtype: 'cloud' },
    artifact: { kind: 'artifact' }, component: { kind: 'component' }, database: { kind: 'datastore' }, actor: { kind: 'actor' },
  },
  er: { entity: { kind: 'entity' } },
  sequence: {},
}

const EDGE_TYPES: Record<string, { type: RelationType; directed: boolean }> = {
  association: { type: 'association', directed: false },
  directed: { type: 'directed', directed: true },
  dependency: { type: 'dependency', directed: true },
  use: { type: 'dependency', directed: true },
  import: { type: 'dependency', directed: true },
  access: { type: 'dependency', directed: true },
  generalization: { type: 'generalization', directed: true },
  realization: { type: 'realization', directed: true },
  composition: { type: 'composition', directed: false },
  aggregation: { type: 'aggregation', directed: false },
  include: { type: 'include', directed: true },
  extend: { type: 'extend', directed: true },
  link: { type: 'link', directed: false },
  er: { type: 'er', directed: false },
}

/** Líneas de presentación que el parser conserva sin interpretar: no restan confianza. */
const PRESENTATION = /^(skinparam|!|scale|header|footer|caption|legend|endlegend|hide|show|remove|allow_?mixing|set |sprite|mainframe|newpage|<\/?style>|left to right|top to bottom|title|autonumber|@)/i

// --- Miembros y firmas ----------------------------------------------------------------

/** Separa por comas fuera de <>, (), []. */
function splitTopLevel(text: string) {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if ('<([{'.includes(char)) depth += 1
    if ('>)]}'.includes(char)) depth = Math.max(0, depth - 1)
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else current += char
  }
  parts.push(current)
  return parts.map((part) => part.trim()).filter(Boolean)
}

function parseParameter(text: string): Parameter {
  const clean = text.replace(/=.*$/, '').trim()
  if (clean.includes(':')) {
    const [name, ...type] = clean.split(':')
    return { name: name.trim(), type: type.join(':').trim() || undefined }
  }
  const words = clean.split(/\s+/)
  // Estilo Java/C#: «String clave».
  if (words.length >= 2) return { name: words[words.length - 1], type: words.slice(0, -1).join(' ') }
  return { name: clean }
}

const OPERATION = /^([-+#~])?\s*((?:\{(?:abstract|static|classifier)\}\s*)*)(?:([\w<>[\],.\s]+?)\s+)?([A-Za-z_$À-ɏ][\w$À-ɏ]*)\s*\((.*)\)\s*(?::\s*(.+))?$/

export function parseOperation(line: string): Operation | null {
  const raw = line.trim()
  const match = OPERATION.exec(raw)
  if (!match) return null
  const [, visibility, modifiers, prefixType, name, params, suffixType] = match
  return {
    name,
    params: splitTopLevel(params).map(parseParameter),
    returnType: (suffixType ?? prefixType)?.trim() || undefined,
    visibility: visibility as Operation['visibility'],
    abstract: /abstract/.test(modifiers ?? '') || undefined,
    raw,
  }
}

function parseAttribute(line: string): Attribute | null {
  const raw = line.trim()
  if (!raw || /^(--|==|\.\.|__)/.test(raw)) return null
  const text = raw.replace(/^[-+#~*]\s*/, '').replace(/\{[^}]*\}\s*/g, '').replace(/<<[^>]*>>/g, '').trim()
  if (text.includes(':')) {
    const [name, ...type] = text.split(':')
    return { name: name.trim(), type: type.join(':').trim() || undefined, raw }
  }
  const words = text.split(/\s+/)
  if (words.length === 2) return { name: words[1], type: words[0], raw }
  return { name: text, raw }
}

function stereotypesOf(stereotype: string | undefined, name: string) {
  const fromName = [...name.matchAll(/<<([^>]*)>>|«([^»]*)»/g)].map((match) => match[1] ?? match[2])
  return [...(stereotype ? stereotype.split(/[,«»<>]+/) : []), ...fromName]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

/** Llamada reconocible en el texto de un mensaje: «1: agregarTarea(t: Tarea)» → agregarTarea, 1 argumento. */
export function parseCall(label: string): CallSignature | undefined {
  const text = label.replace(/^\s*\d+(\.\d+)*\s*[:.)-]?\s*/, '').trim()
  const match = /^(?:[\w$À-ɏ]+\.)*([A-Za-z_$À-ɏ][\w$À-ɏ]*)\s*\((.*)\)\s*(?::.*)?$/.exec(text)
  if (!match) return undefined
  return {
    name: match[1],
    args: splitTopLevel(match[2]).map((arg) => {
      const [value, ...type] = arg.split(':')
      return type.length ? { text: value.trim(), type: type.join(':').trim() } : { text: arg }
    }),
  }
}

// --- Lectura de cada diagrama -----------------------------------------------------------

function readModel(input: DiagramInput, kind: AnalyzedKind): { model: VisualModel | null; extraction: Extraction } {
  const issues: string[] = []
  if (input.mode === 'visual') {
    // modelFromDiagram devuelve el mismo objeto solo si es un modelo válido de ese tipo.
    const model = modelFromDiagram(kind, input.model)
    if (model === input.model) return { model, extraction: { confidence: 1, issues, failed: false } }
    issues.push('El modelo visual guardado no es válido; se leyó el código PlantUML generado.')
  }
  if (!input.source.trim()) {
    return { model: null, extraction: { confidence: 0, issues: [...issues, 'El diagrama no tiene contenido.'], failed: true } }
  }
  try {
    const parsed = parsePlantUml(input.source, kind, null)
    const unknown = parsed.kept.filter((line) => !PRESENTATION.test(line.trim()))
    const size = isSequence(parsed.model)
      ? parsed.model.participants.length + parsed.model.messages.length
      : (parsed.model as GraphModel).nodes.length + (parsed.model as GraphModel).edges.length
    let confidence = input.mode === 'visual' ? 0.85 : 0.95
    if (unknown.length) {
      confidence *= 1 - Math.min(0.6, unknown.length / (unknown.length + Math.max(1, size)))
      issues.push(`${unknown.length} línea(s) del código no se pudieron interpretar (p. ej. «${unknown[0]}»).`)
    }
    if (parsed.warnings.length) {
      confidence -= Math.min(0.3, 0.1 * parsed.warnings.length)
      issues.push(...parsed.warnings)
    }
    return { model: parsed.model, extraction: { confidence: Math.max(0.2, round(confidence)), issues, failed: false } }
  } catch (error) {
    issues.push(`No se pudo leer el código: ${error instanceof Error ? error.message : 'error desconocido'}.`)
    return { model: null, extraction: { confidence: 0, issues, failed: true } }
  }
}

const isSequence = (model: VisualModel): model is SequenceModel => model.kind === 'sequence'
const round = (value: number) => Math.round(value * 100) / 100

function extractGraph(diagram: ArchDiagram, model: GraphModel, out: ArchitectureModel) {
  const types = NODE_KINDS[diagram.kind]
  const key = (id: string) => `${diagram.id}:${id}`
  const parents = containerMap(model.kind, model.nodes)
  const known = new Set<string>()
  for (const node of model.nodes) {
    const mapped = types[node.type]
    if (!mapped) continue
    known.add(node.id)
  }
  const nearestKnownParent = (id: string) => {
    let parent = parents.get(id) ?? null
    while (parent && !known.has(parent)) parent = parents.get(parent) ?? null
    return parent
  }
  for (const node of model.nodes) {
    const mapped = types[node.type]
    if (!mapped) continue
    const lines = [...(node.attributes ?? []), ...(node.methods ?? [])]
    const operations: Operation[] = []
    const attributes: Attribute[] = []
    for (const line of lines) {
      const operation = mapped.kind !== 'enum' && /\(.*\)/.test(line) ? parseOperation(line) : null
      if (operation) operations.push(operation)
      else {
        const attribute = parseAttribute(line)
        if (attribute) attributes.push(attribute)
      }
    }
    const parent = nearestKnownParent(node.id)
    const element: ArchElement = {
      key: key(node.id),
      diagramId: diagram.id,
      elementId: node.id,
      kind: mapped.kind,
      ...(mapped.subtype ? { subtype: mapped.subtype } : {}),
      name: node.name.trim(),
      stereotypes: stereotypesOf(node.stereotype, node.name),
      attributes,
      operations,
      ...(parent ? { parent: key(parent) } : {}),
    }
    out.elements.push(element)
  }
  for (const edge of model.edges) {
    const mapped = EDGE_TYPES[edge.type]
    if (!mapped || !known.has(edge.source) || !known.has(edge.target)) continue
    out.relations.push({
      key: key(edge.id),
      diagramId: diagram.id,
      elementId: edge.id,
      type: mapped.type,
      source: key(edge.source),
      target: key(edge.target),
      directed: mapped.directed,
      ...(edge.label?.trim() ? { label: edge.label.trim() } : {}),
      ...(edge.sourceLabel?.trim() ? { sourceMultiplicity: edge.sourceLabel.trim() } : {}),
      ...(edge.targetLabel?.trim() ? { targetMultiplicity: edge.targetLabel.trim() } : {}),
    } satisfies ArchRelation)
  }
}

const FRAGMENT_OPEN = /^(alt|opt|loop|par|break|critical|group)\b\s*(.*)$/

function extractSequence(diagram: ArchDiagram, model: SequenceModel, out: ArchitectureModel) {
  const key = (id: string) => `${diagram.id}:${id}`
  for (const participant of model.participants) {
    const kind: ElementKind = participant.type === 'actor' ? 'actor' : participant.type === 'database' ? 'datastore' : participant.type === 'queue' ? 'queue' : 'participant'
    out.elements.push({
      key: key(participant.id),
      diagramId: diagram.id,
      elementId: participant.id,
      kind,
      subtype: participant.type,
      name: participant.name.trim(),
      stereotypes: stereotypesOf(undefined, participant.name),
      attributes: [],
      operations: [],
    })
  }
  const fragments: string[] = []
  let order = 0
  for (const message of model.messages) {
    if (message.raw !== undefined) {
      const raw = message.raw.trim()
      const open = FRAGMENT_OPEN.exec(raw)
      if (open) fragments.push(`${open[1]}${open[2] ? ` ${open[2]}` : ''}`)
      else if (/^else\b/.test(raw) && fragments.length) fragments[fragments.length - 1] = `${fragments[fragments.length - 1].split(' ')[0]} ${raw}`
      else if (/^end\b/.test(raw) && !/^end ?note/.test(raw)) fragments.pop()
      continue
    }
    if (!model.participants.some((item) => item.id === message.from) || !model.participants.some((item) => item.id === message.to)) continue
    const call = message.type === 'reply' ? undefined : parseCall(message.label)
    out.messages.push({
      key: key(message.id),
      diagramId: diagram.id,
      elementId: message.id,
      order: order++,
      from: key(message.from),
      to: key(message.to),
      label: message.label.trim(),
      type: message.type,
      ...(call ? { call } : {}),
      fragments: [...fragments],
    } satisfies ArchMessage)
  }
}

/** Normaliza todos los diagramas del tablero. Los tipos sin análisis quedan en `ignored`. */
export function extractArchitecture(inputs: DiagramInput[]): ArchitectureModel {
  const out: ArchitectureModel = { diagrams: [], elements: [], relations: [], messages: [], ignored: [] }
  const valid = inputs.filter((input) => input && typeof input.id === 'string' && typeof input.kind === 'string')
  const sorted = [...valid].sort((a, b) => a.id.localeCompare(b.id))
  for (const input of sorted) {
    if (!isAnalyzedKind(input.kind)) {
      out.ignored.push({ id: input.id, name: input.name, kind: input.kind, reason: 'El motor de coherencia aún no analiza este tipo de diagrama.' })
      continue
    }
    const kind = input.kind
    const { model, extraction } = readModel({ ...input, source: input.source ?? '' }, kind)
    const diagram: ArchDiagram = {
      id: input.id,
      name: input.name?.trim() || 'Sin nombre',
      kind,
      view: KIND_VIEW[kind],
      mode: input.mode === 'visual' ? 'visual' : 'code',
      ...(model?.title ? { title: model.title } : {}),
      extraction,
    }
    out.diagrams.push(diagram)
    if (!model) continue
    const before = out.elements.length
    if (isSequence(model)) extractSequence(diagram, model, out)
    else extractGraph(diagram, model as GraphModel, out)
    if (out.elements.length === before) extraction.issues.push('El diagrama está vacío o no tiene elementos analizables.')
  }
  return out
}

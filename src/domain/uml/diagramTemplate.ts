import { sanitizeSettings, type ArchitectureSettings } from './coherence'
import { generatePlantUml } from './generatePlantUml'
import { kindSpec } from './kinds'
import { isStructuredKind, structuredFromRaw } from './structured'
import { isVisualKind, PARTICIPANT_LABELS, MESSAGE_LABELS, type GraphEdge, type GraphModel, type GraphNode, type Message, type Participant, type Point, type SequenceModel, type VisualModel } from './visualModel'
import { UML_DIAGRAM_TYPES, umlDiagramType } from '../umlCatalog'

/**
 * Plantilla de diagramas: archivo JSON con los diagramas de un tablero (código
 * PlantUML y, si los tiene, su modelo visual) y, opcionalmente, la
 * configuración de coherencia arquitectónica. Se descarga desde la galería y
 * se importa en cualquier tablero, por ejemplo uno recién creado.
 *
 * También se aceptan archivos .puml con uno o varios diagramas PlantUML.
 */

export const TEMPLATE_FORMAT = 'gesti-workspace/diagramas'
export const TEMPLATE_VERSION = 1
export const TEMPLATE_FILE_SUFFIX = '.diagramas.json'
export const TEMPLATE_ACCEPT = '.json,.puml,.plantuml,.pu,.iuml,.wsd,.txt'

export const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024
export const MAX_TEMPLATE_DIAGRAMS = 200
/** Mismos límites que la tabla board_diagrams. */
export const MAX_DIAGRAM_NAME = 120
export const MAX_DIAGRAM_SOURCE = 200_000

export type TemplateDiagram = {
  name: string
  kind: string
  mode: 'code' | 'visual'
  source: string
  model?: unknown
}

export type DiagramTemplate = {
  format: typeof TEMPLATE_FORMAT
  version: typeof TEMPLATE_VERSION
  generatedAt: string
  generator: string
  project?: { name: string; description?: string | null }
  instructions: string[]
  diagrams: TemplateDiagram[]
  architectureSettings?: ArchitectureSettings
}

/** Diagrama listo para crearse en un tablero. */
export type ImportCandidate = {
  name: string
  kind: string
  mode: 'code' | 'visual'
  source: string
  model?: VisualModel
  /** El tipo se dedujo del código (archivo .puml): conviene revisarlo. */
  guessedKind: boolean
}

export type ParsedImport = {
  diagrams: ImportCandidate[]
  settings: ArchitectureSettings | null
  /** Nombre del proyecto de origen, si la plantilla lo trae. */
  projectName: string | null
  /** Diagramas omitidos o ajustados, explicados para el usuario. */
  warnings: string[]
}

export const TEMPLATE_INSTRUCTIONS = [
  'Plantilla de diagramas de Gesti - Workspace. Impórtala desde «Diagramas» › «Importar» en cualquier tablero.',
  'Cada elemento de «diagrams» crea un diagrama. Campos: name (nombre, hasta 120 caracteres), kind (tipo), mode y source.',
  `kind admite: ${UML_DIAGRAM_TYPES.filter((type) => type.support !== 'unavailable').map((type) => type.id).join(', ')}.`,
  'mode «code»: source es el código PlantUML (@startuml … @enduml). Es la forma más simple de escribir un diagrama a mano.',
  'mode «visual»: además trae «model», el modelo del editor de arrastrar y soltar. Si se borra «model», el diagrama se importa como código.',
  '«architectureSettings» (opcional) es la configuración del análisis de coherencia arquitectónica del tablero.',
]

// --- Exportar ------------------------------------------------------------------

export function buildDiagramTemplate(input: {
  project: { name: string; description?: string | null }
  diagrams: Array<{ name: string; kind: string; mode: string; source: string | null; model: unknown }>
  settings?: ArchitectureSettings | null
  now?: Date
}): DiagramTemplate {
  return {
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    generatedAt: (input.now ?? new Date()).toISOString(),
    generator: 'Gesti - Workspace',
    project: { name: input.project.name, description: input.project.description ?? null },
    instructions: TEMPLATE_INSTRUCTIONS,
    diagrams: input.diagrams.map((diagram) => {
      const visual = diagram.mode === 'visual' && diagram.model != null
      return {
        name: diagram.name,
        kind: diagram.kind,
        mode: visual ? 'visual' : 'code',
        source: diagram.source ?? '',
        ...(visual ? { model: diagram.model } : {}),
      }
    }),
    ...(input.settings ? { architectureSettings: input.settings } : {}),
  }
}

export const serializeTemplate = (template: DiagramTemplate) => `${JSON.stringify(template, null, 2)}\n`

/** Plantilla de ejemplo para empezar desde cero: un diagrama de cada tipo frecuente. */
export function exampleTemplate(now?: Date): DiagramTemplate {
  const kinds = ['usecase', 'class', 'sequence', 'activity']
  return buildDiagramTemplate({
    project: { name: 'Plantilla de ejemplo', description: 'Diagramas de muestra para completar o reemplazar.' },
    diagrams: kinds.flatMap((kind) => {
      const type = umlDiagramType(kind)
      return type ? [{ name: type.name, kind, mode: 'code', source: type.template, model: null }] : []
    }),
    now,
  })
}

// --- Importar ------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string'
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const texts = (value: unknown) => (Array.isArray(value) ? value.filter(isText) : undefined)

function cleanName(value: unknown, fallback: string) {
  const name = (isText(value) ? value : '').replace(/\s+/g, ' ').trim()
  return (name || fallback).slice(0, MAX_DIAGRAM_NAME).trim()
}

function sanitizePoint(value: unknown): Point | null {
  return isRecord(value) && isNumber(value.x) && isNumber(value.y) ? { x: value.x, y: value.y } : null
}

/** Copia solo los campos conocidos y bien formados de un modelo de lienzo. */
function sanitizeGraphModel(kind: string, raw: Record<string, unknown>): GraphModel | null {
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null
  const nodes: GraphNode[] = []
  for (const item of raw.nodes) {
    if (!isRecord(item) || !isText(item.id) || !isText(item.type) || !isText(item.name) || !isNumber(item.x) || !isNumber(item.y)) continue
    nodes.push({
      id: item.id,
      type: item.type,
      name: item.name,
      x: item.x,
      y: item.y,
      ...(isNumber(item.width) ? { width: item.width } : {}),
      ...(isNumber(item.height) ? { height: item.height } : {}),
      ...(isText(item.stereotype) ? { stereotype: item.stereotype } : {}),
      ...(texts(item.attributes) ? { attributes: texts(item.attributes) } : {}),
      ...(texts(item.methods) ? { methods: texts(item.methods) } : {}),
    })
  }
  const ids = new Set(nodes.map((node) => node.id))
  const edges: GraphEdge[] = []
  for (const item of raw.edges) {
    if (!isRecord(item) || !isText(item.id) || !isText(item.type) || !isText(item.source) || !isText(item.target)) continue
    if (!ids.has(item.source) || !ids.has(item.target)) continue
    const points = Array.isArray(item.points) ? item.points.map(sanitizePoint).filter((point): point is Point => point !== null) : undefined
    edges.push({
      id: item.id,
      type: item.type,
      source: item.source,
      target: item.target,
      ...(isText(item.label) ? { label: item.label } : {}),
      ...(isText(item.sourceLabel) ? { sourceLabel: item.sourceLabel } : {}),
      ...(isText(item.targetLabel) ? { targetLabel: item.targetLabel } : {}),
      ...(points?.length ? { points } : {}),
    })
  }
  return {
    kind,
    version: 1,
    direction: raw.direction === 'left-to-right' ? 'left-to-right' : 'top-to-bottom',
    // Sin layout el editor lo trata como «auto»: se conserva tal cual.
    ...(raw.layout === 'auto' || raw.layout === 'canvas' ? { layout: raw.layout } : {}),
    ...(isText(raw.title) ? { title: raw.title } : {}),
    nodes,
    edges,
    ...(texts(raw.extra) ? { extra: texts(raw.extra) } : {}),
  }
}

function sanitizeSequenceModel(raw: Record<string, unknown>): SequenceModel | null {
  if (!Array.isArray(raw.participants) || !Array.isArray(raw.messages)) return null
  const participants: Participant[] = raw.participants.flatMap((item) =>
    isRecord(item) && isText(item.id) && isText(item.name) && isText(item.type) && item.type in PARTICIPANT_LABELS
      ? [{ id: item.id, name: item.name, type: item.type as Participant['type'] }]
      : [],
  )
  const ids = new Set(participants.map((participant) => participant.id))
  const messages: Message[] = raw.messages.flatMap((item) => {
    if (!isRecord(item) || !isText(item.id)) return []
    const type = isText(item.type) && item.type in MESSAGE_LABELS ? (item.type as Message['type']) : 'sync'
    if (isText(item.raw)) return [{ id: item.id, from: '', to: '', label: '', type, raw: item.raw }]
    if (!isText(item.from) || !isText(item.to) || !ids.has(item.from) || !ids.has(item.to)) return []
    return [{ id: item.id, from: item.from, to: item.to, label: isText(item.label) ? item.label : '', type }]
  })
  return {
    kind: 'sequence',
    version: 1,
    autonumber: raw.autonumber === true,
    ...(isText(raw.title) ? { title: raw.title } : {}),
    participants,
    messages,
    ...(texts(raw.extra) ? { extra: texts(raw.extra) } : {}),
  }
}

/** Modelo visual utilizable o null (datos dañados, de otro tipo o que no generan PlantUML). */
export function sanitizeVisualModel(kind: string, raw: unknown): VisualModel | null {
  if (!isRecord(raw) || raw.kind !== kind || !isVisualKind(kind)) return null
  let model: VisualModel | null
  if (isStructuredKind(kind)) model = structuredFromRaw(kind, raw)
  else if (kind === 'sequence') model = sanitizeSequenceModel(raw)
  else model = kindSpec(kind) ? sanitizeGraphModel(kind, raw) : null
  if (!model) return null
  try {
    generatePlantUml(model)
    return model
  } catch {
    return null
  }
}

function candidateFromTemplate(raw: unknown, position: number, warnings: string[]): ImportCandidate | null {
  const label = `Diagrama ${position}`
  if (!isRecord(raw)) {
    warnings.push(`${label}: no tiene el formato esperado; se omitió.`)
    return null
  }
  const kind = isText(raw.kind) ? raw.kind.trim() : ''
  const type = umlDiagramType(kind)
  const name = cleanName(raw.name, type?.name ?? label)
  if (!type || type.support === 'unavailable') {
    warnings.push(`«${name}»: el tipo «${kind || 'sin tipo'}» no está disponible; se omitió.`)
    return null
  }
  const source = isText(raw.source) ? raw.source : ''
  if (raw.mode === 'visual' && isVisualKind(kind)) {
    const model = sanitizeVisualModel(kind, raw.model)
    if (model) {
      const generated = generatePlantUml(model)
      if (generated.length <= MAX_DIAGRAM_SOURCE) return { name, kind, mode: 'visual', source: generated, model, guessedKind: false }
    }
    if (source.trim()) warnings.push(`«${name}»: su modelo visual no era válido; se importó como código PlantUML.`)
  }
  if (!source.trim()) {
    warnings.push(`«${name}»: no tiene código PlantUML; se omitió.`)
    return null
  }
  if (source.length > MAX_DIAGRAM_SOURCE) {
    warnings.push(`«${name}»: el código supera los ${MAX_DIAGRAM_SOURCE.toLocaleString('es-CL')} caracteres; se omitió.`)
    return null
  }
  return { name, kind, mode: 'code', source, guessedKind: false }
}

function parseTemplate(data: unknown): ParsedImport {
  if (!isRecord(data) || !Array.isArray(data.diagrams)) {
    throw new Error('El archivo no es una plantilla de diagramas de Gesti - Workspace.')
  }
  if (data.format !== undefined && data.format !== TEMPLATE_FORMAT) {
    throw new Error('El archivo JSON no es una plantilla de diagramas de Gesti - Workspace.')
  }
  if (isNumber(data.version) && data.version > TEMPLATE_VERSION) {
    throw new Error('La plantilla es de una versión más nueva de Gesti - Workspace. Actualiza la página e inténtalo de nuevo.')
  }
  if (data.diagrams.length > MAX_TEMPLATE_DIAGRAMS) {
    throw new Error(`La plantilla trae ${data.diagrams.length} diagramas; el máximo por importación es ${MAX_TEMPLATE_DIAGRAMS}.`)
  }
  const warnings: string[] = []
  const diagrams = data.diagrams
    .map((item, index) => candidateFromTemplate(item, index + 1, warnings))
    .filter((item): item is ImportCandidate => item !== null)
  const project = isRecord(data.project) && isText(data.project.name) ? data.project.name.trim() : ''
  return {
    diagrams,
    settings: data.architectureSettings === undefined || data.architectureSettings === null ? null : sanitizeSettings(data.architectureSettings),
    projectName: project || null,
    warnings,
  }
}

const START_KINDS: Record<string, string> = {
  startgantt: 'gantt',
  startnwdiag: 'network',
  startsalt: 'wireframe',
  startmindmap: 'mindmap',
  startregex: 'regex',
}

/**
 * Tipo probable de un diagrama PlantUML. Primero por la directiva @start…,
 * luego por el título de las plantillas del catálogo y, por último, por las
 * palabras clave más características de cada tipo.
 */
export function guessDiagramKind(source: string): string {
  const start = /@(start\w+)/i.exec(source)?.[1].toLowerCase() ?? 'startuml'
  if (START_KINDS[start]) return START_KINDS[start]

  const title = /^\s*title\s+(.+)$/im.exec(source)?.[1].trim().toLowerCase()
  if (title) {
    const byTitle = UML_DIAGRAM_TYPES.find((type) => type.support !== 'unavailable' && /^\s*title\s+(.+)$/im.exec(type.template)?.[1].trim().toLowerCase() === title)
    if (byTitle) return byTitle.id
  }

  const body = source.replace(/'.*$/gm, '')
  const has = (pattern: RegExp) => pattern.test(body)
  if (has(/!include\s*<?C4/i) || has(/^\s*(Person|Container|System)(_Ext)?\s*\(/m)) return 'c4'
  if (has(/!include\s*<?awslib/i)) return 'aws'
  if (has(/!include\s*<?gcp/i)) return 'gcp'
  if (has(/^\s*archimate\b/im)) return 'archimate'
  if (has(/^\s*(robust|concise|clock|binary)\s/m)) return 'timing'
  if (has(/^\s*entity\s/m) && has(/[|}o]\|?--|--\|?[|{o]/)) return 'er'
  if (has(/^\s*(usecase\s|\(.+\))/m)) return 'usecase'
  if (has(/^\s*(participant|boundary|control|database|collections|queue)\s/m) || (has(/^\s*actor\s/m) && has(/->/) && has(/:\s*\S/))) return 'sequence'
  if (has(/^\s*((abstract\s+)?class|interface|enum)\s/m)) return 'class'
  if (has(/^\s*object\s/m)) return 'object'
  if (has(/\[\*\]/) || has(/^\s*state\s/m)) return 'state'
  if (has(/^\s*start\s*$/m) || has(/^\s*:[^\n]+;\s*$/m)) return 'activity'
  if (has(/^\s*(node|artifact|cloud)\s/m)) return 'deployment'
  if (has(/^\s*component\s/m) || has(/^\s*\[[^\]]+\]/m)) return 'component'
  if (has(/^\s*package\s/m)) return 'package'
  return 'class'
}

/** Separa un archivo .puml en sus diagramas (@start… / @end…). */
function parsePlantUmlFile(fileName: string, text: string): ParsedImport {
  const blocks = text.match(/@start\w+[\s\S]*?@end\w+/gi) ?? []
  if (blocks.length === 0) {
    throw new Error('El archivo no contiene diagramas PlantUML (@startuml … @enduml).')
  }
  if (blocks.length > MAX_TEMPLATE_DIAGRAMS) {
    throw new Error(`El archivo trae ${blocks.length} diagramas; el máximo por importación es ${MAX_TEMPLATE_DIAGRAMS}.`)
  }
  const baseName = fileName.replace(/\.[^.]+$/, '').trim() || 'Diagrama importado'
  const warnings: string[] = []
  const diagrams = blocks.flatMap((source, index) => {
    const title = /^\s*title\s+(.+)$/im.exec(source)?.[1]
    const fallback = blocks.length > 1 ? `${baseName} ${index + 1}` : baseName
    const name = cleanName(title, fallback)
    if (source.length > MAX_DIAGRAM_SOURCE) {
      warnings.push(`«${name}»: el código supera los ${MAX_DIAGRAM_SOURCE.toLocaleString('es-CL')} caracteres; se omitió.`)
      return []
    }
    return [{ name, kind: guessDiagramKind(source), mode: 'code' as const, source: `${source.trim()}\n`, guessedKind: true }]
  })
  return { diagrams, settings: null, projectName: null, warnings }
}

/** Lee una plantilla JSON o un archivo PlantUML. Lanza un Error con un mensaje para el usuario. */
export function parseDiagramFile(fileName: string, text: string): ParsedImport {
  const trimmed = text.replace(/^﻿/, '').trim()
  if (!trimmed) throw new Error('El archivo está vacío.')
  if (trimmed.startsWith('{') || /\.json$/i.test(fileName)) {
    let data: unknown
    try {
      data = JSON.parse(trimmed)
    } catch {
      throw new Error('El archivo JSON está dañado o incompleto y no se pudo leer.')
    }
    return parseTemplate(data)
  }
  return parsePlantUmlFile(fileName, trimmed)
}

/** «Nombre», «Nombre (2)», «Nombre (3)»… sin repetir los ya usados (sin distinguir mayúsculas). */
export function uniqueDiagramName(name: string, taken: Set<string>): string {
  const key = (value: string) => value.trim().toLocaleLowerCase('es')
  if (!taken.has(key(name))) {
    taken.add(key(name))
    return name
  }
  for (let copy = 2; ; copy += 1) {
    const suffix = ` (${copy})`
    const candidate = `${name.slice(0, MAX_DIAGRAM_NAME - suffix.length).trim()}${suffix}`
    if (!taken.has(key(candidate))) {
      taken.add(key(candidate))
      return candidate
    }
  }
}

/** Nombre del archivo de exportación: «nexustock-kanban-cascada.diagramas.json». */
export function templateFileName(projectName: string) {
  const slug = projectName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'tablero'}${TEMPLATE_FILE_SUFFIX}`
}

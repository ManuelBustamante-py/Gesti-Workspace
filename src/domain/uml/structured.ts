/**
 * Diagramas con estructura propia (no son grafos): mapa mental, Gantt, red,
 * tiempos y wireframe. Cada uno tiene modelo, generador de PlantUML y parser,
 * así se puede pasar del editor estructurado al código y volver.
 */
import { nextId } from './ids'

// --- Mapa mental -----------------------------------------------------------------------

export type MindNode = { id: string; text: string; side?: 'left' | 'right'; children: MindNode[] }
export type MindmapModel = { kind: 'mindmap'; version: 1; title?: string; root: MindNode; extra?: string[] }

// --- Gantt -------------------------------------------------------------------------------

export type GanttStart = { type: 'project' } | { type: 'after'; task: string } | { type: 'date'; date: string }
export type GanttTask = { id: string; name: string; duration: number; start: GanttStart; progress?: number; milestone?: boolean; resource?: string }
export type GanttModel = { kind: 'gantt'; version: 1; title?: string; projectStart: string; closed: number[]; tasks: GanttTask[]; extra?: string[] }

// --- Red (nwdiag) ----------------------------------------------------------------------------

export type NetworkSegment = { id: string; name: string; address?: string }
export type NetworkHost = { id: string; name: string; description?: string; links: Array<{ network: string; address?: string }> }
export type NetworkModel = { kind: 'network'; version: 1; title?: string; networks: NetworkSegment[]; hosts: NetworkHost[]; extra?: string[] }

// --- Tiempos -------------------------------------------------------------------------------

export type TimingType = 'robust' | 'concise' | 'binary' | 'clock'
export type TimingParticipant = { id: string; name: string; type: TimingType; period?: number }
export type TimingEvent = { id: string; time: number; participant: string; state: string }
export type TimingModel = { kind: 'timing'; version: 1; title?: string; participants: TimingParticipant[]; events: TimingEvent[]; extra?: string[] }

// --- Wireframe ------------------------------------------------------------------------------

export type WidgetType = 'title' | 'text' | 'input' | 'password' | 'button' | 'checkbox' | 'radio' | 'select' | 'link' | 'image' | 'separator'
export type Widget = { id: string; type: WidgetType; label: string; checked?: boolean }
export type WireRow = { id: string; cells: Widget[] }
export type WireframeModel = { kind: 'wireframe'; version: 1; title?: string; frame: 'window' | 'plain'; rows: WireRow[]; extra?: string[] }

export type StructuredModel = MindmapModel | GanttModel | NetworkModel | TimingModel | WireframeModel
export const STRUCTURED_KINDS = ['mindmap', 'gantt', 'network', 'timing', 'wireframe'] as const
export const isStructuredKind = (kind: string): kind is StructuredModel['kind'] => (STRUCTURED_KINDS as readonly string[]).includes(kind)

export const WIDGET_LABELS: Record<WidgetType, string> = {
  title: 'Título', text: 'Texto', input: 'Campo de texto', password: 'Contraseña', button: 'Botón', checkbox: 'Casilla',
  radio: 'Opción (radio)', select: 'Lista desplegable', link: 'Enlace', image: 'Imagen', separator: 'Separador',
}
export const TIMING_LABELS: Record<TimingType, string> = { robust: 'Robusto (varios estados)', concise: 'Conciso (bloques)', binary: 'Binario (alto/bajo)', clock: 'Reloj' }
export const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const WEEKDAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// --- Utilidades ------------------------------------------------------------------------------

const clean = (text: string) => text.replace(/\r\n?/g, '\n')
const lines = (source: string) => clean(source).split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith("'"))
const unquote = (text: string) => text.trim().replace(/^"(.*)"$/s, '$1')
const quoted = (text: string) => `"${(text.trim() || 'Sin nombre').replace(/"/g, "'").replace(/\r?\n/g, '\\n')}"`
/** Nombre de tarea de Gantt: sin corchetes (los usa la sintaxis). */
const taskName = (name: string) => name.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim() || 'Tarea'
/** Identificador válido para nwdiag (redes y equipos). */
export const nwIdentifier = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^(\d)/, '_$1') || 'equipo'

// =============================================================================================
// Generadores
// =============================================================================================

function generateMindmap(model: MindmapModel) {
  const out = ['@startmindmap']
  if (model.title?.trim()) out.push(`title ${model.title.trim()}`)
  out.push(...(model.extra ?? []))
  const emit = (node: MindNode, depth: number) => {
    const stars = '*'.repeat(depth)
    const text = node.text.trim() || ' '
    out.push(text.includes('\n') ? `${stars}:${text};` : `${stars} ${text}`)
    node.children.forEach((child) => emit(child, depth + 1))
  }
  const root = model.root
  out.push(root.text.includes('\n') ? `*:${root.text.trim()};` : `* ${root.text.trim() || 'Tema central'}`)
  root.children.filter((child) => child.side !== 'left').forEach((child) => emit(child, 2))
  const left = root.children.filter((child) => child.side === 'left')
  if (left.length) {
    out.push('left side')
    left.forEach((child) => emit(child, 2))
  }
  out.push('@endmindmap')
  return out.join('\n')
}

function generateGantt(model: GanttModel) {
  const out = ['@startgantt']
  if (model.title?.trim()) out.push(`title ${model.title.trim()}`)
  const total = model.tasks.reduce((sum, task) => sum + (task.milestone ? 0 : task.duration), 0)
  out.push(total > 60 ? 'printscale weekly' : 'printscale daily')
  for (const day of [...model.closed].sort()) out.push(`${WEEKDAYS_EN[day]} are closed`)
  out.push(`Project starts ${model.projectStart}`)
  out.push(...(model.extra ?? []))
  const name = (id: string) => taskName(model.tasks.find((task) => task.id === id)?.name ?? '')
  for (const task of model.tasks) {
    const label = `[${taskName(task.name)}]`
    if (task.milestone) {
      if (task.start.type === 'after' && model.tasks.some((item) => item.id === (task.start as { task: string }).task)) out.push(`${label} happens at [${name(task.start.task)}]'s end`)
      else if (task.start.type === 'date') out.push(`${label} happens ${task.start.date}`)
      else out.push(`${label} happens ${model.projectStart}`)
      continue
    }
    out.push(`${label}${task.resource?.trim() ? ` on {${task.resource.trim().replace(/[{}]/g, '')}}` : ''} requires ${Math.max(1, Math.round(task.duration))} days`)
    if (task.start.type === 'after' && model.tasks.some((item) => item.id === (task.start as { task: string }).task)) out.push(`${label} starts at [${name(task.start.task)}]'s end`)
    else if (task.start.type === 'date') out.push(`${label} starts ${task.start.date}`)
    if (task.progress) out.push(`${label} is ${Math.min(100, Math.max(0, Math.round(task.progress)))}% completed`)
  }
  out.push('@endgantt')
  return out.join('\n')
}

function generateNetwork(model: NetworkModel) {
  const out = ['@startnwdiag']
  if (model.title?.trim()) out.push(`title ${model.title.trim()}`)
  out.push('nwdiag {')
  const described = new Set<string>()
  for (const network of model.networks) {
    out.push(`  network ${nwIdentifier(network.name)} {`)
    if (network.address?.trim()) out.push(`    address = "${network.address.trim()}";`)
    for (const host of model.hosts) {
      const link = host.links.find((item) => item.network === network.id)
      if (!link) continue
      const attributes: string[] = []
      if (link.address?.trim()) attributes.push(`address = "${link.address.trim()}"`)
      // La descripción se declara una sola vez (en la primera red del equipo).
      if (host.description?.trim() && !described.has(host.id)) {
        attributes.push(`description = "${host.description.trim().replace(/"/g, "'")}"`)
        described.add(host.id)
      }
      out.push(`    ${nwIdentifier(host.name)}${attributes.length ? ` [${attributes.join(', ')}]` : ''};`)
    }
    out.push('  }')
  }
  out.push(...(model.extra ?? []).map((line) => `  ${line}`))
  out.push('}')
  out.push('@endnwdiag')
  return out.join('\n')
}

function generateTiming(model: TimingModel) {
  const out = ['@startuml']
  if (model.title?.trim()) out.push(`title ${model.title.trim()}`)
  for (const participant of model.participants) {
    out.push(`${participant.type} ${quoted(participant.name)} as ${participant.id}${participant.type === 'clock' ? ` with period ${participant.period ?? 50}` : ''}`)
  }
  out.push(...(model.extra ?? []))
  const ids = new Set(model.participants.filter((participant) => participant.type !== 'clock').map((participant) => participant.id))
  const times = [...new Set(model.events.filter((event) => ids.has(event.participant)).map((event) => event.time))].sort((a, b) => a - b)
  for (const time of times) {
    out.push(`@${time}`)
    for (const event of model.events.filter((item) => item.time === time && ids.has(item.participant))) {
      const state = event.state.trim() || '{-}'
      out.push(`${event.participant} is ${/\s/.test(state) && !state.startsWith('"') ? quoted(state) : state}`)
    }
  }
  out.push('@enduml')
  return out.join('\n')
}

/** Celda de Salt (sintaxis de wireframes de PlantUML). */
function saltCell(widget: Widget) {
  const label = widget.label.replace(/\|/g, '/').trim()
  switch (widget.type) {
    case 'title': return `<b>${label || 'Título'}`
    case 'text': return label || ' '
    case 'input': return `"${(label || ' ').padEnd(16)}"`
    case 'password': return `"${'*'.repeat(Math.max(4, label.length || 8)).padEnd(16)}"`
    case 'button': return `[${label || 'Botón'}]`
    case 'checkbox': return `[${widget.checked ? 'X' : ' '}] ${label}`
    case 'radio': return `(${widget.checked ? 'X' : ' '}) ${label}`
    case 'select': return `^${label || 'Elegir'}^`
    case 'link': return `<u>${label || 'Enlace'}</u>`
    case 'image': return `<&image> ${label}`
    case 'separator': return '--'
  }
}

function generateWireframe(model: WireframeModel) {
  const out = ['@startsalt']
  if (model.title?.trim()) out.push(`title ${model.title.trim()}`)
  out.push(...(model.extra ?? []))
  out.push(model.frame === 'window' ? '{+' : '{')
  for (const row of model.rows) {
    if (row.cells.length === 1 && row.cells[0].type === 'separator') out.push('  --')
    else out.push(`  ${row.cells.map(saltCell).join(' | ')}`)
  }
  out.push('}')
  out.push('@endsalt')
  return out.join('\n')
}

export function generateStructured(model: StructuredModel): string {
  switch (model.kind) {
    case 'mindmap': return generateMindmap(model)
    case 'gantt': return generateGantt(model)
    case 'network': return generateNetwork(model)
    case 'timing': return generateTiming(model)
    case 'wireframe': return generateWireframe(model)
  }
}

// =============================================================================================
// Parsers
// =============================================================================================

export type StructuredParse = { model: StructuredModel; kept: string[]; warnings: string[] }

function parseMindmap(source: string): StructuredParse {
  const kept: string[] = []
  const warnings: string[] = []
  let title: string | undefined
  let side: 'left' | 'right' = 'right'
  const ids: string[] = []
  const id = () => {
    const value = nextId('n', ids)
    ids.push(value)
    return value
  }
  let root: MindNode | null = null
  const stack: MindNode[] = []
  const all = lines(source)
  for (let index = 0; index < all.length; index += 1) {
    const line = all[index]
    if (/^@(start|end)/.test(line)) continue
    if (/^title\s+/.test(line)) {
      title = line.replace(/^title\s+/, '').trim()
      continue
    }
    if (/^left side$/i.test(line)) {
      side = 'left'
      continue
    }
    if (/^right side$/i.test(line)) {
      side = 'right'
      continue
    }
    const item = /^(\*+|\++|-+)(?:\[#[\w#]+\])?(_)?\s*(.*)$/.exec(line)
    if (!item) {
      kept.push(line)
      continue
    }
    const marker = item[1]
    const depth = marker.length
    let text = item[3]
    if (text.startsWith(':')) {
      text = text.slice(1)
      while (!text.endsWith(';') && index + 1 < all.length) text += `\n${all[(index += 1)]}`
      text = text.replace(/;$/, '')
    }
    const node: MindNode = { id: id(), text: text.trim(), children: [] }
    if (depth === 1) {
      if (root) {
        warnings.push(`Solo se admite un tema central: «${text.trim()}» se agregó como rama.`)
        root.children.push(node)
        stack.length = 1
        continue
      }
      root = node
      stack.length = 0
      stack.push(node)
      continue
    }
    if (!root) {
      root = { id: id(), text: 'Tema central', children: [] }
      stack.push(root)
    }
    stack.length = Math.min(stack.length, depth - 1)
    const parent = stack[stack.length - 1] ?? root
    if (depth === 2) node.side = marker.startsWith('-') ? 'left' : marker.startsWith('+') ? 'right' : side
    parent.children.push(node)
    stack.push(node)
  }
  const model: MindmapModel = { kind: 'mindmap', version: 1, root: root ?? { id: id(), text: 'Tema central', children: [] }, ...(title ? { title } : {}), ...(kept.length ? { extra: kept } : {}) }
  return { model, kept, warnings }
}

const DATE = String.raw`(\d{4})[-/](\d{1,2})[-/](\d{1,2})`
const isoDate = (match: RegExpExecArray, offset = 1) => `${match[offset]}-${match[offset + 1].padStart(2, '0')}-${match[offset + 2].padStart(2, '0')}`

function parseGantt(source: string): StructuredParse {
  const kept: string[] = []
  const warnings: string[] = []
  const tasks: GanttTask[] = []
  const closed = new Set<number>()
  let projectStart = new Date().toISOString().slice(0, 10)
  let title: string | undefined
  let previous: GanttTask | null = null
  const find = (name: string) => tasks.find((task) => task.name === name.trim())
  const ensure = (name: string) => {
    let task = find(name)
    if (!task) {
      task = { id: nextId('n', tasks.map((item) => item.id)), name: name.trim(), duration: 1, start: { type: 'project' } }
      tasks.push(task)
    }
    return task
  }
  for (const line of lines(source)) {
    if (/^@(start|end)/.test(line) || /^printscale\b/i.test(line)) continue
    let match: RegExpExecArray | null
    if ((match = /^title\s+(.*)$/i.exec(line))) title = match[1].trim()
    else if ((match = new RegExp(`^project starts\\s+(?:the\\s+)?${DATE}`, 'i').exec(line))) projectStart = isoDate(match)
    else if ((match = /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s? are closed$/i.exec(line))) closed.add(WEEKDAYS_EN.indexOf(match[1].toLowerCase()))
    else if ((match = /^(?:then\s+)?\[([^\]]+)\](?:\s+on\s+\{([^}]+)\})?\s+(?:requires|lasts)\s+(\d+)\s+(day|week)s?$/i.exec(line))) {
      const task = ensure(match[1])
      task.duration = Number(match[3]) * (match[4].toLowerCase() === 'week' ? 5 : 1)
      if (match[2]) task.resource = match[2].trim()
      if (/^then\s/i.test(line) && previous && previous.id !== task.id) task.start = { type: 'after', task: previous.id }
      previous = task
    } else if ((match = /^\[([^\]]+)\]\s+starts\s+(?:at\s+)?\[([^\]]+)\]'s end$/i.exec(line))) {
      ensure(match[1]).start = { type: 'after', task: ensure(match[2]).id }
    } else if ((match = new RegExp(`^\\[([^\\]]+)\\]\\s+starts\\s+(?:the\\s+|on\\s+)?${DATE}$`, 'i').exec(line))) {
      ensure(match[1]).start = { type: 'date', date: isoDate(match, 2) }
    } else if ((match = /^\[([^\]]+)\]\s+is\s+(\d+)%\s+complete(?:d)?$/i.exec(line))) {
      ensure(match[1]).progress = Number(match[2])
    } else if ((match = /^\[([^\]]+)\]\s+happens\s+at\s+\[([^\]]+)\]'s end$/i.exec(line))) {
      const milestone = ensure(match[1])
      milestone.milestone = true
      milestone.duration = 0
      milestone.start = { type: 'after', task: ensure(match[2]).id }
    } else if ((match = new RegExp(`^\\[([^\\]]+)\\]\\s+happens\\s+(?:the\\s+|on\\s+|at\\s+)?${DATE}$`, 'i').exec(line))) {
      const milestone = ensure(match[1])
      milestone.milestone = true
      milestone.duration = 0
      milestone.start = { type: 'date', date: isoDate(match, 2) }
    } else kept.push(line)
  }
  if (kept.length) warnings.push(`${kept.length} línea(s) del Gantt no se editan en la tabla y se conservan como código.`)
  const model: GanttModel = { kind: 'gantt', version: 1, projectStart, closed: [...closed], tasks, ...(title ? { title } : {}), ...(kept.length ? { extra: kept } : {}) }
  return { model, kept, warnings }
}

function parseNetwork(source: string): StructuredParse {
  const kept: string[] = []
  const networks: NetworkSegment[] = []
  const hosts: NetworkHost[] = []
  let title: string | undefined
  let current: NetworkSegment | null = null
  let depth = 0
  const attributesOf = (text: string) => Object.fromEntries([...text.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)].map((match) => [match[1], match[2]]))
  for (const line of lines(source)) {
    if (/^@(start|end)/.test(line)) continue
    let match: RegExpExecArray | null
    if ((match = /^title\s+(.*)$/i.exec(line))) {
      title = match[1].trim()
      continue
    }
    if (/^nwdiag\s*\{$/.test(line)) {
      depth = 1
      continue
    }
    if ((match = /^network\s+([\w-]+)\s*\{$/.exec(line))) {
      current = { id: nextId('p', networks.map((item) => item.id)), name: match[1] }
      networks.push(current)
      depth = 2
      continue
    }
    if (line === '}') {
      if (depth === 2) current = null
      depth = Math.max(0, depth - 1)
      continue
    }
    if (current && (match = /^address\s*=\s*"([^"]*)"\s*;?$/.exec(line))) {
      current.address = match[1]
      continue
    }
    if (current && (match = /^([\w.-]+)\s*(?:\[(.*)\])?\s*;?$/.exec(line))) {
      const attributes = attributesOf(match[2] ?? '')
      let host = hosts.find((item) => item.name === match![1])
      if (!host) {
        host = { id: nextId('n', hosts.map((item) => item.id)), name: match[1], links: [] }
        hosts.push(host)
      }
      if (attributes.description) host.description = attributes.description
      host.links.push({ network: current.id, ...(attributes.address ? { address: attributes.address } : {}) })
      continue
    }
    kept.push(line)
  }
  const model: NetworkModel = { kind: 'network', version: 1, networks, hosts, ...(title ? { title } : {}), ...(kept.length ? { extra: kept } : {}) }
  return { model, kept, warnings: kept.length ? [`${kept.length} línea(s) de red (grupos, estilos) se conservan como código.`] : [] }
}

function parseTiming(source: string): StructuredParse {
  const kept: string[] = []
  const participants: TimingParticipant[] = []
  const events: TimingEvent[] = []
  const byKey = new Map<string, string>()
  let time = 0
  let title: string | undefined
  for (const line of lines(source)) {
    if (/^@(start|end)uml/.test(line)) continue
    let match: RegExpExecArray | null
    if ((match = /^title\s+(.*)$/i.exec(line))) title = match[1].trim()
    else if ((match = /^(robust|concise|binary|clock)\s+(?:"([^"]+)"|(\S+))(?:\s+as\s+(\w+))?(?:\s+with\s+period\s+(\d+))?/.exec(line))) {
      const name = match[2] ?? match[3]
      const id = nextId('p', participants.map((item) => item.id))
      participants.push({ id, name, type: match[1] as TimingType, ...(match[5] ? { period: Number(match[5]) } : {}) })
      byKey.set(match[4] ?? name, id)
      byKey.set(name, id)
    } else if ((match = /^@(\+)?(\d+)$/.exec(line))) {
      time = match[1] ? time + Number(match[2]) : Number(match[2])
    } else if ((match = /^(\w+|"[^"]+")\s+is\s+(.+)$/.exec(line)) && byKey.has(unquote(match[1]))) {
      events.push({ id: nextId('m', events.map((item) => item.id)), time, participant: byKey.get(unquote(match[1]))!, state: unquote(match[2]) })
    } else kept.push(line)
  }
  const model: TimingModel = { kind: 'timing', version: 1, participants, events, ...(title ? { title } : {}), ...(kept.length ? { extra: kept } : {}) }
  return { model, kept, warnings: kept.length ? [`${kept.length} línea(s) (restricciones, notas) se conservan como código.`] : [] }
}

/** Celda de Salt → control. */
function parseSaltCell(text: string, id: string): Widget {
  const cell = text.trim()
  let match: RegExpExecArray | null
  if ((match = /^<b>(.*)$/.exec(cell))) return { id, type: 'title', label: match[1].trim() }
  if ((match = /^"(.*)"$/.exec(cell))) return /^\*+\s*$/.test(match[1]) ? { id, type: 'password', label: '' } : { id, type: 'input', label: match[1].trim() }
  if ((match = /^\[(X|x| )\]\s*(.*)$/.exec(cell))) return { id, type: 'checkbox', label: match[2].trim(), checked: match[1].toLowerCase() === 'x' }
  if ((match = /^\((X|x| |o)\)\s*(.*)$/.exec(cell))) return { id, type: 'radio', label: match[2].trim(), checked: /x|o/i.test(match[1]) }
  if ((match = /^\[(.*)\]$/.exec(cell))) return { id, type: 'button', label: match[1].trim() }
  if ((match = /^\^(.*)\^$/.exec(cell))) return { id, type: 'select', label: match[1].trim() }
  if ((match = /^<u>(.*?)(<\/u>)?$/.exec(cell))) return { id, type: 'link', label: match[1].trim() }
  if ((match = /^<&image>\s*(.*)$/.exec(cell))) return { id, type: 'image', label: match[1].trim() }
  if (/^(--|==|\.\.|~~)$/.test(cell)) return { id, type: 'separator', label: '' }
  return { id, type: 'text', label: cell }
}

function parseWireframe(source: string): StructuredParse {
  const kept: string[] = []
  const rows: WireRow[] = []
  let title: string | undefined
  let frame: WireframeModel['frame'] = 'plain'
  let depth = 0
  const usedIds: string[] = []
  const id = (prefix: 'n' | 'm') => {
    const value = nextId(prefix, usedIds)
    usedIds.push(value)
    return value
  }
  for (const line of lines(source)) {
    if (/^@(start|end)(salt|uml)/.test(line) || line === 'salt') continue
    let match: RegExpExecArray | null
    if ((match = /^title\s+(.*)$/i.exec(line))) {
      title = match[1].trim()
      continue
    }
    if (depth === 0 && /^\{[+#!-]?$/.test(line)) {
      frame = line === '{+' ? 'window' : 'plain'
      depth = 1
      continue
    }
    if (line === '}') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth === 0) {
      kept.push(line)
      continue
    }
    // Las celdas se separan con «|» (fuera de comillas y corchetes).
    const cells: string[] = []
    let currentCell = ''
    let inQuote = false
    for (const char of line) {
      if (char === '"') inQuote = !inQuote
      if (char === '|' && !inQuote) {
        cells.push(currentCell)
        currentCell = ''
      } else currentCell += char
    }
    cells.push(currentCell)
    rows.push({ id: id('m'), cells: cells.filter((cell) => cell.trim() !== '' || cells.length === 1).map((cell) => parseSaltCell(cell, id('n'))) })
  }
  const model: WireframeModel = { kind: 'wireframe', version: 1, frame, rows, ...(title ? { title } : {}), ...(kept.length ? { extra: kept } : {}) }
  return { model, kept, warnings: [] }
}

export function parseStructured(source: string, kind: StructuredModel['kind']): StructuredParse {
  switch (kind) {
    case 'mindmap': return parseMindmap(source)
    case 'gantt': return parseGantt(source)
    case 'network': return parseNetwork(source)
    case 'timing': return parseTiming(source)
    case 'wireframe': return parseWireframe(source)
  }
}

export function emptyStructured(kind: StructuredModel['kind']): StructuredModel {
  switch (kind) {
    case 'mindmap': return { kind, version: 1, root: { id: 'n1', text: 'Tema central', children: [] } }
    case 'gantt': return { kind, version: 1, projectStart: new Date().toISOString().slice(0, 10), closed: [0, 6], tasks: [] }
    case 'network': return { kind, version: 1, networks: [], hosts: [] }
    case 'timing': return { kind, version: 1, participants: [], events: [] }
    case 'wireframe': return { kind, version: 1, frame: 'window', rows: [] }
  }
}

/** Valida un modelo guardado de estos tipos (datos de otra versión → null). */
export function structuredFromRaw(kind: string, raw: unknown): StructuredModel | null {
  const value = raw as Partial<StructuredModel> | null
  if (!value || value.kind !== kind) return null
  const ok =
    (kind === 'mindmap' && typeof (value as MindmapModel).root === 'object') ||
    (kind === 'gantt' && Array.isArray((value as GanttModel).tasks)) ||
    (kind === 'network' && Array.isArray((value as NetworkModel).networks) && Array.isArray((value as NetworkModel).hosts)) ||
    (kind === 'timing' && Array.isArray((value as TimingModel).participants) && Array.isArray((value as TimingModel).events)) ||
    (kind === 'wireframe' && Array.isArray((value as WireframeModel).rows))
  return ok ? (value as StructuredModel) : null
}

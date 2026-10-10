import { WEEKDAYS, nwIdentifier, type GanttModel, type GanttTask, type MindNode, type MindmapModel, type NetworkModel, type StructuredModel, type TimingModel, type WireframeModel } from './structured'
import type { Finding, Interpretation } from './interpret'

const q = (text: string) => `«${text.replace(/\s*\n\s*/g, ' ').trim() || 'sin texto'}»`
const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`)
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

// --- Mapa mental -------------------------------------------------------------------------

function interpretMindmap(model: MindmapModel): Interpretation {
  const summary: string[] = []
  const findings: Finding[] = []
  const root = model.root
  const count = (node: MindNode): number => 1 + node.children.reduce((sum, child) => sum + count(child), 0)
  const depth = (node: MindNode): number => 1 + Math.max(0, ...node.children.map(depth))
  summary.push(`El tema central es ${q(root.text)}, con ${plural(root.children.length, 'rama principal', 'ramas principales')} y ${plural(count(root) - 1, 'idea', 'ideas')} en total.`)
  for (const branch of root.children) {
    const leaves = branch.children.map((child) => q(child.text))
    summary.push(`${q(branch.text)}${leaves.length ? ` abarca ${list(leaves)}` : ' aún no se desarrolla'}.`)
  }
  if (root.children.length === 0) findings.push({ level: 'info', text: 'El tema central todavía no tiene ramas.' })
  const left = root.children.filter((child) => child.side === 'left').map(count).reduce((sum, value) => sum + value, 0)
  const right = root.children.filter((child) => child.side !== 'left').map(count).reduce((sum, value) => sum + value, 0)
  if (left && right && Math.max(left, right) > 3 * Math.min(left, right)) findings.push({ level: 'info', text: `Un lado del mapa tiene mucho más contenido que el otro (${left} vs ${right} ideas): equilibrarlo facilita la lectura.` })
  if (depth(root) > 5) findings.push({ level: 'info', text: `El mapa tiene ${depth(root)} niveles: más de 4 o 5 suele indicar que una rama merece su propio mapa.` })
  const empty: string[] = []
  const visit = (node: MindNode) => {
    if (!node.text.trim()) empty.push(node.id)
    node.children.forEach(visit)
  }
  visit(root)
  if (empty.length) findings.push({ level: 'warning', text: `${plural(empty.length, 'idea no tiene', 'ideas no tienen')} texto.` })
  const solo = root.children.filter((branch) => branch.children.length === 1)
  if (solo.length) findings.push({ level: 'info', text: `${list(solo.map((branch) => q(branch.text)))} ${solo.length === 1 ? 'tiene' : 'tienen'} una sola sub-idea: quizá pueda fusionarse con su rama.` })
  return { summary, findings }
}

// --- Gantt --------------------------------------------------------------------------------

const toDate = (key: string) => new Date(`${key}T00:00:00Z`)
const toKey = (date: Date) => date.toISOString().slice(0, 10)
const longDate = (key: string) => new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(toDate(key))

/** Fechas de cada tarea según días hábiles, dependencias y fechas fijas. */
export function ganttSchedule(model: GanttModel) {
  const working = (date: Date) => !model.closed.includes(date.getUTCDay())
  const nextWorking = (date: Date) => {
    const next = new Date(date)
    while (!working(next)) next.setUTCDate(next.getUTCDate() + 1)
    return next
  }
  const addWorking = (date: Date, days: number) => {
    const next = new Date(date)
    let remaining = days
    while (remaining > 0) {
      next.setUTCDate(next.getUTCDate() + 1)
      if (working(next)) remaining -= 1
    }
    return next
  }
  const result = new Map<string, { start: string; end: string }>()
  const visiting = new Set<string>()
  const cyclic = new Set<string>()
  const compute = (task: GanttTask): { start: string; end: string } => {
    const known = result.get(task.id)
    if (known) return known
    if (visiting.has(task.id)) {
      cyclic.add(task.id)
      return { start: model.projectStart, end: model.projectStart }
    }
    visiting.add(task.id)
    let start = nextWorking(toDate(model.projectStart))
    if (task.start.type === 'date') start = task.milestone ? toDate(task.start.date) : nextWorking(toDate(task.start.date))
    if (task.start.type === 'after') {
      const previous = model.tasks.find((item) => item.id === (task.start as { task: string }).task)
      if (previous) {
        const end = toDate(compute(previous).end)
        start = task.milestone ? end : addWorking(end, 1)
      }
    }
    const end = task.milestone ? start : addWorking(start, Math.max(1, task.duration) - 1)
    const value = { start: toKey(start), end: toKey(end) }
    result.set(task.id, value)
    visiting.delete(task.id)
    return value
  }
  model.tasks.forEach(compute)
  return { dates: result, cyclic }
}

function interpretGantt(model: GanttModel): Interpretation {
  const summary: string[] = []
  const findings: Finding[] = []
  const { dates, cyclic } = ganttSchedule(model)
  const work = model.tasks.filter((task) => !task.milestone)
  const milestones = model.tasks.filter((task) => task.milestone)
  const end = [...dates.values()].reduce((max, item) => (item.end > max ? item.end : max), model.projectStart)
  summary.push(`El proyecto comienza el ${longDate(model.projectStart)} y, según el plan, termina el ${longDate(end)}.`)
  summary.push(`Tiene ${plural(work.length, 'tarea', 'tareas')}${milestones.length ? ` y ${plural(milestones.length, 'hito', 'hitos')} (${list(milestones.map((task) => q(task.name)))})` : ''}.`)
  if (model.closed.length) summary.push(`No se trabaja los ${list(model.closed.map((day) => WEEKDAYS[day]))}.`)
  for (const task of model.tasks.slice(0, 12)) {
    const range = dates.get(task.id)!
    const after = task.start.type === 'after' ? model.tasks.find((item) => item.id === (task.start as { task: string }).task) : undefined
    summary.push(task.milestone
      ? `Hito ${q(task.name)}: ${longDate(range.start)}${after ? `, al terminar ${q(after.name)}` : ''}.`
      : `${q(task.name)}: ${task.duration} día(s) hábiles, del ${longDate(range.start)} al ${longDate(range.end)}${after ? `, después de ${q(after.name)}` : ''}${task.resource ? `, a cargo de ${task.resource}` : ''}${task.progress ? ` (${task.progress}% avanzado)` : ''}.`)
  }
  if (model.tasks.length > 12) summary.push(`…y ${model.tasks.length - 12} más.`)

  // Cadena más larga (camino crítico aproximado): la que termina en la fecha final.
  const last = model.tasks.find((task) => dates.get(task.id)?.end === end)
  if (last && model.tasks.length > 1) {
    const chain: string[] = []
    let current: GanttTask | undefined = last
    while (current && chain.length < 20) {
      chain.unshift(q(current.name))
      const start: GanttTask['start'] = current.start
      current = start.type === 'after' ? model.tasks.find((item) => item.id === start.task) : undefined
    }
    if (chain.length > 1) summary.push(`Cadena que define la fecha de término: ${chain.join(' → ')}. Un retraso en cualquiera de estas tareas atrasa el proyecto.`)
  }

  const names = new Map<string, number>()
  for (const task of model.tasks) names.set(task.name.trim().toLowerCase(), (names.get(task.name.trim().toLowerCase()) ?? 0) + 1)
  for (const [name, count] of names) if (count > 1) findings.push({ level: 'warning', text: `La tarea «${name}» está repetida ${count} veces: PlantUML identifica las tareas por su nombre y las fusionará.` })
  if (cyclic.size) findings.push({ level: 'warning', text: `Hay dependencias circulares entre ${list(model.tasks.filter((task) => cyclic.has(task.id)).map((task) => q(task.name)))}.` })
  for (const task of model.tasks) {
    if (task.start.type === 'after' && !model.tasks.some((item) => item.id === (task.start as { task: string }).task)) findings.push({ level: 'warning', text: `${q(task.name)} depende de una tarea que ya no existe.` })
    if (task.start.type === 'date' && task.start.date < model.projectStart) findings.push({ level: 'warning', text: `${q(task.name)} empieza antes del inicio del proyecto.` })
    if (task.progress && task.progress > 0 && dates.get(task.id)!.start > toKey(new Date())) findings.push({ level: 'info', text: `${q(task.name)} tiene avance registrado pero aún no debería haber empezado.` })
  }
  const independent = work.filter((task) => task.start.type === 'project')
  if (independent.length > 1) findings.push({ level: 'info', text: `${list(independent.map((task) => q(task.name)))} empiezan todas el primer día: si dependen entre sí, indícalo para que el plan sea realista.` })
  const byResource = new Map<string, number>()
  for (const task of work) if (task.resource) byResource.set(task.resource, (byResource.get(task.resource) ?? 0) + task.duration)
  if (byResource.size) summary.push(`Carga por responsable: ${[...byResource].map(([name, days]) => `${name} ${days} día(s)`).join(', ')}.`)
  return { summary, findings }
}

// --- Red -------------------------------------------------------------------------------------

const ipToNumber = (ip: string) => {
  const parts = ip.split('.').map(Number)
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
    : null
}

function interpretNetwork(model: NetworkModel): Interpretation {
  const summary: string[] = []
  const findings: Finding[] = []
  summary.push(`La red tiene ${plural(model.networks.length, 'segmento', 'segmentos')} y ${plural(model.hosts.length, 'equipo', 'equipos')}.`)
  for (const network of model.networks) {
    const members = model.hosts.filter((host) => host.links.some((link) => link.network === network.id))
    summary.push(`${q(nwIdentifier(network.name))}${network.address ? ` (${network.address})` : ''} conecta ${members.length ? list(members.map((host) => q(host.name))) : 'ningún equipo'}.`)
    if (!members.length) findings.push({ level: 'info', text: `El segmento ${q(network.name)} no tiene equipos.` })
    const cidr = /^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/.exec(network.address?.trim() ?? '')
    const seen = new Map<string, string>()
    for (const host of members) {
      const address = host.links.find((link) => link.network === network.id)?.address?.trim()
      if (!address) continue
      if (seen.has(address)) findings.push({ level: 'warning', text: `${q(host.name)} y ${q(seen.get(address)!)} usan la misma dirección ${address} en ${q(network.name)}.` })
      seen.set(address, host.name)
      if (cidr) {
        const base = ipToNumber(cidr[1])
        const ip = ipToNumber(address)
        const bits = Number(cidr[2])
        if (base !== null && ip !== null && bits >= 0 && bits <= 32) {
          const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
          if (((ip & mask) >>> 0) !== ((base & mask) >>> 0)) findings.push({ level: 'warning', text: `${q(host.name)} tiene la dirección ${address}, que no pertenece a ${network.address}.` })
        }
      }
    }
  }
  const gateways = model.hosts.filter((host) => host.links.length > 1)
  if (gateways.length) summary.push(`${list(gateways.map((host) => q(host.name)))} ${gateways.length === 1 ? 'está' : 'están'} en más de un segmento: hacen de puente o enrutador entre redes.`)
  for (const host of model.hosts) {
    if (!host.links.length) findings.push({ level: 'warning', text: `El equipo ${q(host.name)} no está conectado a ninguna red.` })
    if (host.links.some((link) => !link.address?.trim())) findings.push({ level: 'info', text: `${q(host.name)} no tiene dirección en alguna de sus redes.` })
  }
  return { summary, findings }
}

// --- Tiempos -----------------------------------------------------------------------------------

function interpretTiming(model: TimingModel): Interpretation {
  const summary: string[] = []
  const findings: Finding[] = []
  const times = [...new Set(model.events.map((event) => event.time))].sort((a, b) => a - b)
  const last = times[times.length - 1] ?? 0
  summary.push(`Se observan ${plural(model.participants.length, 'participante', 'participantes')} entre ${times[0] ?? 0} y ${last}.`)
  for (const participant of model.participants) {
    if (participant.type === 'clock') {
      summary.push(`${q(participant.name)} es un reloj con período ${participant.period ?? 50}.`)
      continue
    }
    const events = model.events.filter((event) => event.participant === participant.id).sort((a, b) => a.time - b.time)
    if (!events.length) {
      findings.push({ level: 'warning', text: `${q(participant.name)} no tiene ningún estado.` })
      continue
    }
    const stretches = events.map((event, index) => `${event.state} (${event.time}–${events[index + 1]?.time ?? `${last}+`})`)
    summary.push(`${q(participant.name)}: ${stretches.join(' → ')}.`)
    if (times.length && events[0].time > times[0]) findings.push({ level: 'info', text: `${q(participant.name)} no tiene estado definido al comienzo (${times[0]}).` })
    events.forEach((event, index) => {
      if (index > 0 && events[index - 1].state === event.state) findings.push({ level: 'info', text: `${q(participant.name)} repite el estado ${q(event.state)} en ${event.time}: no hay cambio real.` })
    })
    if (participant.type === 'binary' && events.some((event) => !/^(high|low|alto|bajo)$/i.test(event.state))) findings.push({ level: 'warning', text: `${q(participant.name)} es binario: sus estados deben ser «high» o «low».` })
  }
  return { summary, findings }
}

// --- Wireframe -----------------------------------------------------------------------------------

function interpretWireframe(model: WireframeModel): Interpretation {
  const summary: string[] = []
  const findings: Finding[] = []
  const widgets = model.rows.flatMap((row) => row.cells)
  const of = (type: string) => widgets.filter((widget) => widget.type === type)
  const titles = of('title').map((widget) => q(widget.label))
  summary.push(`Pantalla${titles.length ? ` ${list(titles)}` : ''} con ${plural(model.rows.length, 'fila', 'filas')} y ${plural(widgets.length, 'elemento', 'elementos')}.`)
  const fields = model.rows.flatMap((row) => row.cells.map((cell, index) => ({ cell, label: row.cells[index - 1]?.type === 'text' ? row.cells[index - 1].label : '' }))).filter((item) => ['input', 'password', 'select'].includes(item.cell.type))
  if (fields.length) summary.push(`Pide ${plural(fields.length, 'dato', 'datos')}: ${list(fields.map((item) => q(item.label || item.cell.label || (item.cell.type === 'password' ? 'contraseña' : 'sin etiqueta'))))}.`)
  const choices = [...of('checkbox'), ...of('radio')]
  if (choices.length) summary.push(`Opciones: ${list(choices.map((widget) => `${q(widget.label)}${widget.checked ? ' (marcada)' : ''}`))}.`)
  const actions = [...of('button'), ...of('link')]
  if (actions.length) summary.push(`Acciones: ${list(actions.map((widget) => q(widget.label)))}.`)

  const unlabeled = fields.filter((item) => !item.label && !item.cell.label)
  if (unlabeled.length) findings.push({ level: 'warning', text: `${plural(unlabeled.length, 'campo no tiene', 'campos no tienen')} etiqueta ni texto de ejemplo: el usuario no sabrá qué escribir.` })
  if (fields.length && !of('button').length) findings.push({ level: 'warning', text: 'La pantalla pide datos pero no tiene ningún botón para enviarlos.' })
  for (const button of of('button')) if (/^(ok|aceptar|click|clic|botón|enviar)$/i.test(button.label.trim())) findings.push({ level: 'info', text: `El botón ${q(button.label)} es genérico: un verbo concreto («Ingresar», «Guardar pedido») dice mejor qué pasará.` })
  for (const choice of choices) if (!choice.label.trim()) findings.push({ level: 'warning', text: 'Hay una casilla u opción sin texto.' })
  const radios = of('radio')
  if (radios.length === 1) findings.push({ level: 'info', text: 'Hay una sola opción de tipo radio: con una sola alternativa conviene usar una casilla.' })
  if (radios.filter((widget) => widget.checked).length > 1) findings.push({ level: 'warning', text: 'Hay más de una opción de radio marcada: solo una puede estar seleccionada.' })
  const widest = Math.max(0, ...model.rows.map((row) => row.cells.length))
  if (widest > 4) findings.push({ level: 'info', text: `Una fila tiene ${widest} columnas: en pantallas de celular se verá apretada.` })
  if (of('password').length && !widgets.some((widget) => /olvid|recuperar/i.test(widget.label))) findings.push({ level: 'info', text: 'Hay un campo de contraseña sin opción para recuperarla.' })
  return { summary, findings }
}

export function interpretStructured(model: StructuredModel): Interpretation {
  switch (model.kind) {
    case 'mindmap': return interpretMindmap(model)
    case 'gantt': return interpretGantt(model)
    case 'network': return interpretNetwork(model)
    case 'timing': return interpretTiming(model)
    case 'wireframe': return interpretWireframe(model)
  }
}

// --- Expresiones regulares ----------------------------------------------------------------------

const ESCAPES: Record<string, string> = {
  d: 'un dígito', D: 'algo que no es dígito', w: 'una letra, dígito o «_»', W: 'un carácter que no es letra ni dígito', s: 'un espacio en blanco', S: 'un carácter que no es espacio',
  b: 'un límite de palabra', B: 'algo que no es límite de palabra', n: 'un salto de línea', t: 'un tabulador',
}

function quantifier(text: string) {
  const lazy = text.endsWith('?') && text.length > 1 ? ' (lo mínimo posible)' : ''
  const base = lazy ? text.slice(0, -1) : text
  if (base === '*') return `cero o más veces${lazy}`
  if (base === '+') return `una o más veces${lazy}`
  if (base === '?') return 'opcional'
  const range = /^\{(\d+)(,(\d*))?\}$/.exec(base)
  if (!range) return ''
  if (!range[2]) return `exactamente ${range[1]} veces`
  if (!range[3]) return `${range[1]} o más veces${lazy}`
  return `entre ${range[1]} y ${range[3]} veces${lazy}`
}

/** Explicación de una expresión regular, pieza por pieza, en español. */
export function explainRegex(source: string): Interpretation {
  const pattern = source.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim()).filter((line) => line && !/^@(start|end)regex/.test(line) && !/^title\b/.test(line) && !line.startsWith("'")).join('')
  const summary: string[] = []
  const findings: Finding[] = []
  if (!pattern) return { summary: ['La expresión está vacía.'], findings }
  try {
    new RegExp(pattern)
  } catch (error) {
    findings.push({ level: 'warning', text: `La expresión no es válida: ${(error as Error).message}` })
  }
  summary.push(`Patrón: ${pattern}`)
  let index = 0
  let depth = 0
  const say = (text: string) => summary.push(`${'  '.repeat(depth)}• ${text}`)
  const readQuantifier = () => {
    const match = /^(\*\??|\+\??|\?|\{\d+(?:,\d*)?\}\??)/.exec(pattern.slice(index))
    if (!match) return ''
    index += match[0].length
    return ` — ${quantifier(match[0])}`
  }
  while (index < pattern.length) {
    const char = pattern[index]
    if (char === '^') { index += 1; say('inicio del texto'); continue }
    if (char === '$') { index += 1; say('final del texto'); continue }
    if (char === '|') { index += 1; say('o bien (alternativa):'); continue }
    if (char === ')') { index += 1; depth = Math.max(0, depth - 1); const q2 = readQuantifier(); if (q2) say(`(el grupo anterior se repite${q2.replace(' — ', ' ')})`); continue }
    if (char === '(') {
      const head = /^\((\?:|\?=|\?!|\?<=|\?<!|\?<([\w]+)>)?/.exec(pattern.slice(index))![0]
      index += head.length
      const kind = head === '(?:' ? 'grupo' : head === '(?=' ? 'seguido de' : head === '(?!' ? 'no seguido de' : head === '(?<=' ? 'precedido por' : head === '(?<!' ? 'no precedido por' : head.startsWith('(?<') ? `grupo «${head.slice(3, -1)}»` : 'grupo capturado'
      say(`${kind}:`)
      depth += 1
      continue
    }
    if (char === '[') {
      const end = pattern.indexOf(']', index + 2)
      const body = pattern.slice(index + 1, end < 0 ? undefined : end)
      index = end < 0 ? pattern.length : end + 1
      const negated = body.startsWith('^')
      const parts = (negated ? body.slice(1) : body).replace(/\\(.)/g, (_, c: string) => ESCAPES[c] ? `{${ESCAPES[c]}}` : c)
      say(`${negated ? 'un carácter que NO sea' : 'un carácter entre'} [${parts}]${readQuantifier()}`)
      continue
    }
    if (char === '\\') {
      const next = pattern[index + 1] ?? ''
      index += 2
      if (/\d/.test(next)) say(`lo mismo que capturó el grupo ${next}${readQuantifier()}`)
      else say(`${ESCAPES[next] ?? `el carácter «${next}»`}${readQuantifier()}`)
      continue
    }
    if (char === '.') { index += 1; say(`cualquier carácter${readQuantifier()}`); continue }
    // Texto literal seguido.
    let literal = ''
    while (index < pattern.length && !/[\\^$|()[\].*+?{]/.test(pattern[index])) literal += pattern[(index += 1) - 1]
    if (literal) {
      const q2 = readQuantifier()
      say(q2 && literal.length > 1 ? `el texto «${literal.slice(0, -1)}» y luego «${literal.slice(-1)}»${q2}` : `el texto «${literal}»${q2}`)
    } else index += 1
  }
  if (!pattern.startsWith('^') && !pattern.endsWith('$')) findings.push({ level: 'info', text: 'Sin ^ ni $, la expresión acepta el patrón en cualquier parte de un texto más largo. Para validar un dato completo, ánclala.' })
  if (/\([^)]*[+*][^)]*\)[+*]/.test(pattern)) findings.push({ level: 'warning', text: 'Hay un cuantificador dentro de un grupo que también se repite, como (a+)+: puede volverse extremadamente lento con ciertos textos (retroceso catastrófico).' })
  if (/[a-z0-9]\.(com|cl|org|net|es)\b/i.test(pattern)) findings.push({ level: 'info', text: 'Un «.» sin escapar acepta cualquier carácter; para un punto literal (p. ej. en un dominio) usa «\\.».' })
  if (/\|\||\(\||\|\)/.test(pattern)) findings.push({ level: 'warning', text: 'Hay una alternativa vacía («||», «(|» o «|)»): acepta el texto vacío.' })
  return { summary, findings }
}

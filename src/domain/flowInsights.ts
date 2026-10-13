// Interpretación del avance, por vista: el burndown se lee contra el plan y el
// plazo; el flujo acumulado, por cómo entra, avanza y sale el trabajo. Cada
// una se redacta en la unidad elegida (puntos o tareas) y la contrasta con la
// otra. Reglas explícitas (sin IA): cada conclusión se puede rastrear hasta una
// cifra del tablero.

import type { Burndown } from './burndown'
import { MIN_THROUGHPUT_DAYS, THROUGHPUT_WINDOW_DAYS, WIP_TREND_DAYS, type FlowForecast, type FlowPoint, type FlowStatus } from './cfd'
import { addDays, diffDays, formatDateKey } from './dates'

export type FlowView = 'burndown' | 'cfd'
export type InsightTone = 'good' | 'info' | 'warning' | 'danger'

export type FlowInsight = { id: string; tone: InsightTone; title: string; text: string }

export type FlowScenario = {
  id: 'current' | 'recent' | 'historical' | 'required'
  label: string
  /** Trabajo por semana en la unidad de la serie. */
  perWeek: number
  finish: string | null
  /** true/false frente al plazo; null sin plazo o sin ritmo. */
  meetsDeadline: boolean | null
  note: string
}

/** Indicador del flujo con su lectura (tabla del flujo acumulado). */
export type FlowMetric = { label: string; value: string; note: string; tone?: InsightTone }

export type PendingTask = {
  number: number | null
  title: string
  /** Peso en la unidad de la serie (puntos o 1). */
  weight: number
  status: FlowStatus
  endDate: string | null
}

export type FlowInterpretationInput = {
  unit: { short: string; long: string }
  points: FlowPoint[]
  forecast: FlowForecast
  burndown: Burndown | null
  /** El plazo es el fin comprometido del tablero (no el fin del Gantt). */
  committed: boolean
  pending: PendingTask[]
  /** Estimación: tareas estimadas, total y peso de las no estimadas (solo en puntos). */
  effort?: { estimated: number; total: number; fallback: number }
  /** La misma serie en la otra unidad, para contrastar fechas y tamaños. */
  alternate?: { label: string; points: FlowPoint[]; forecast: FlowForecast | null }
}

export type FlowInterpretation = {
  view: FlowView
  tone: InsightTone
  headline: string
  summary: string
  insights: FlowInsight[]
  /** Solo en el burndown. */
  scenarios: FlowScenario[]
  /** Solo en el flujo acumulado. */
  metrics: FlowMetric[]
  recommendations: string[]
}

/** Lo completado concentrado en un día por encima de esta parte vuelve frágil la proyección. */
export const CONCENTRATION_SHARE = 0.5
/** Días sin completar nada a partir de los cuales se avisa. */
export const IDLE_DAYS = 7
/** Tareas a partir de este peso conviene dividirlas. */
export const LARGE_TASK_POINTS = 13
/** Tramo sin quemar trabajo (en días) a partir del cual se señala una meseta. */
export const PLATEAU_DAYS = 14

const number = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 })
const fmt = (value: number) => number.format(Math.round(value * 10) / 10)
const pct = (value: number) => `${Math.round(value * 100)} %`
const longDate = (day: string) => formatDateKey(day, { day: 'numeric', month: 'long' })
const taskRef = (task: PendingTask) => (task.number !== null ? `#${task.number}` : `«${task.title}»`)
const listRefs = (tasks: PendingTask[]) => {
  const refs = tasks.map(taskRef)
  return refs.length <= 1 ? refs.join('') : `${refs.slice(0, -1).join(', ')} y ${refs[refs.length - 1]}`
}
const TONE_RANK: Record<InsightTone, number> = { good: 0, info: 1, warning: 2, danger: 3 }
const isPoints = (input: FlowInterpretationInput) => input.unit.short === 'pts'

/** Trabajo completado (neto) en los últimos `days` días, terminando `offset` días antes del último. */
function completedIn(points: FlowPoint[], days: number, offset = 0) {
  const end = points.length - offset
  return Math.max(0, points.slice(Math.max(0, end - days), Math.max(0, end)).reduce((sum, point) => sum + point.completed, 0))
}

/** Variación de un valor de la serie en los últimos `days` días. */
function deltaIn(points: FlowPoint[], days: number, value: (point: FlowPoint) => number) {
  if (points.length === 0) return 0
  const last = points[points.length - 1]
  const before = points[Math.max(0, points.length - 1 - days)]
  return value(last) - value(before)
}

function finishAt(today: string, remaining: number, perDay: number) {
  if (remaining <= 0) return today
  return perDay > 0 ? addDays(today, Math.ceil(remaining / perDay)) : null
}

function deadlineNames(committed: boolean) {
  return {
    the: committed ? 'el fin comprometido' : 'el fin planificado del Gantt',
    // «antes del fin…», no «antes de el fin…».
    of: committed ? 'del fin comprometido' : 'del fin planificado del Gantt',
  }
}

function sortInsights(insights: FlowInsight[]) {
  return [...insights].sort((left, right) => TONE_RANK[right.tone] - TONE_RANK[left.tone])
}

function worstTone(insights: FlowInsight[], ids: string[]) {
  const key = insights.filter((insight) => ids.includes(insight.id))
  return key.reduce<InsightTone>((worst, insight) => (TONE_RANK[insight.tone] > TONE_RANK[worst] ? insight.tone : worst), key.length ? 'good' : 'info')
}

// ---------------------------------------------------------------------------
// Hallazgos compartidos por ambas vistas
// ---------------------------------------------------------------------------

/** ¿El ritmo medido depende de un solo día? */
function regularityInsight(input: FlowInterpretationInput, recommendations: string[]): { insight: FlowInsight | null; concentrated: boolean } {
  const { points, forecast } = input
  const windowPoints = points.slice(-forecast.windowDays)
  const windowTotal = windowPoints.reduce((sum, point) => sum + Math.max(0, point.completed), 0)
  if (windowTotal <= 0) return { insight: null, concentrated: false }
  const best = windowPoints.reduce((top, point) => (point.completed > top.completed ? point : top), windowPoints[0])
  const activeDays = windowPoints.filter((point) => point.completed > 0).length
  if (best.completed / windowTotal >= CONCENTRATION_SHARE) {
    recommendations.push('Repartir el trabajo en sesiones regulares (por ejemplo, dos por semana) en vez de jornadas puntuales: el ritmo se vuelve predecible y la proyección, confiable.')
    return {
      concentrated: true,
      insight: {
        id: 'regularity',
        tone: 'warning',
        title: 'Ritmo concentrado en un solo día',
        text: `El ${pct(best.completed / windowTotal)} de lo completado en los últimos ${forecast.windowDays} días (${fmt(best.completed)} de ${fmt(windowTotal)} ${input.unit.long}) ocurrió el ${longDate(best.day)}. La velocidad supone que ese esfuerzo se repite: si no vuelve a ocurrir, irá bajando a medida que ese día salga de la ventana de medición.`,
      },
    }
  }
  return {
    concentrated: false,
    insight: {
      id: 'regularity',
      tone: 'good',
      title: 'Ritmo repartido',
      text: `Lo completado en los últimos ${forecast.windowDays} días se reparte en ${activeDays} días distintos: la velocidad se apoya en un ritmo sostenido.`,
    },
  }
}

function idleInsight(input: FlowInterpretationInput, recommendations: string[]): FlowInsight | null {
  const { points, forecast } = input
  const lastCompletion = [...points].reverse().find((point) => point.completed > 0)
  const idleDays = lastCompletion ? diffDays(lastCompletion.day, forecast.today) : null
  if (forecast.remaining <= 0 || idleDays === null || idleDays < IDLE_DAYS) return null
  recommendations.push('Retomar el avance cuanto antes, empezando por lo que ya está en progreso.')
  return {
    id: 'idle',
    tone: idleDays >= 14 ? 'danger' : 'warning',
    title: `${idleDays} días sin completar trabajo`,
    text: `La última entrega fue el ${longDate(lastCompletion!.day)}. Cada día sin avance acorta el margen frente al plazo.`,
  }
}

function trendInsight(input: FlowInterpretationInput): FlowInsight | null {
  const { points, unit } = input
  if (points.length < 28) return null
  const recent = completedIn(points, 14)
  const previous = completedIn(points, 14, 14)
  if (recent <= 0 && previous <= 0) return null
  const change = previous > 0 ? recent / previous - 1 : 1
  return {
    id: 'trend',
    tone: change >= 0.2 ? 'good' : change <= -0.3 ? 'warning' : 'info',
    title: change >= 0.2 ? 'El ritmo está acelerando' : change <= -0.3 ? 'El ritmo está bajando' : 'Ritmo estable',
    text: `Últimos 14 días: ${fmt(recent)} ${unit.long} completados; los 14 anteriores: ${fmt(previous)}${previous > 0 ? ` (${change >= 0 ? '+' : '−'}${pct(Math.abs(change))})` : ''}.`,
  }
}

function measurementInsights(input: FlowInterpretationInput, recommendations: string[]) {
  const insights: FlowInsight[] = []
  if (input.effort && isPoints(input)) {
    const missing = input.effort.total - input.effort.estimated
    if (missing > 0) {
      insights.push({
        id: 'measurement',
        tone: 'info',
        title: 'Estimación incompleta',
        text: `${missing} de ${input.effort.total} tareas no tienen esfuerzo y cuentan como ${fmt(input.effort.fallback)} pts (el promedio).`,
      })
      recommendations.push(`Estimar las ${missing} tareas sin esfuerzo para afinar la velocidad y la proyección.`)
    }
  }
  if (input.forecast.lowConfidence) {
    insights.push({ id: 'confidence', tone: 'warning', title: 'Poco historial', text: 'Hay menos de 2 semanas de historial: las cifras todavía son poco fiables.' })
  }
  return insights
}

// ---------------------------------------------------------------------------
// Escenarios (burndown)
// ---------------------------------------------------------------------------

/** Escenarios de entrega con distintos ritmos medidos y el necesario para el plazo. */
export function deliveryScenarios(input: Pick<FlowInterpretationInput, 'points' | 'forecast' | 'burndown' | 'unit'>): FlowScenario[] {
  const { points, forecast, burndown, unit } = input
  const { today, remaining, deadline } = forecast
  const meets = (finish: string | null) => (deadline && finish ? finish <= deadline : null)
  const scenarios: FlowScenario[] = []

  const add = (id: FlowScenario['id'], label: string, perDay: number, note: string) => {
    const finish = finishAt(today, remaining, perDay)
    scenarios.push({ id, label, perWeek: perDay * 7, finish, meetsDeadline: meets(finish), note })
  }

  add('current', `Ritmo actual (últimos ${forecast.windowDays} días)`, forecast.throughputPerWeek / 7, 'Base de la proyección principal.')
  if (points.length >= 14) {
    add('recent', 'Ritmo reciente (últimos 14 días)', completedIn(points, 14) / 14, 'Pesa más lo último: anticipa si el equipo acelera o frena.')
  }
  if (burndown && burndown.points.length >= MIN_THROUGHPUT_DAYS) {
    const days = Math.max(MIN_THROUGHPUT_DAYS, burndown.points.length)
    add('historical', 'Ritmo medio desde el inicio', burndown.completedSinceStart / days, `Promedio de ${days} días: el escenario más estable.`)
  }
  if (forecast.requiredPerWeek !== null && deadline) {
    scenarios.push({
      id: 'required',
      label: 'Ritmo necesario para el plazo',
      perWeek: forecast.requiredPerWeek,
      finish: deadline,
      meetsDeadline: true,
      note: `Lo mínimo por semana para terminar justo el ${longDate(deadline)} (${unit.short}/semana).`,
    })
  }
  return scenarios
}

// ---------------------------------------------------------------------------
// Burndown: el avance contra el plan y el plazo
// ---------------------------------------------------------------------------

export function interpretBurndown(input: FlowInterpretationInput): FlowInterpretation {
  const { unit, forecast, burndown, pending } = input
  const { today, remaining, deadline } = forecast
  const names = deadlineNames(input.committed)
  const insights: FlowInsight[] = []
  const recommendations: string[] = []
  const pace = `${fmt(forecast.throughputPerWeek)} ${unit.short}/semana`

  // Avance frente a la línea ideal.
  if (burndown && burndown.deviation !== null && burndown.baseline > 0) {
    const deviation = burndown.deviation
    const share = Math.abs(deviation) / burndown.baseline
    const days = burndown.idealPerWorkingDay ? Math.round(Math.abs(deviation) / burndown.idealPerWorkingDay) : null
    const daysText = days ? ` (unos ${days} días hábiles del plan)` : ''
    insights.push(deviation <= 0
      ? {
        id: 'plan',
        tone: 'good',
        title: deviation === 0 ? 'Justo en la línea ideal' : 'Por debajo de la línea ideal: adelantados',
        text: deviation === 0
          ? 'El trabajo restante coincide con lo que el plan preveía para hoy.'
          : `Quedan ${fmt(-deviation)} ${unit.long} menos de lo que la línea ideal preveía para hoy${daysText}, un ${pct(share)} del alcance inicial.`,
      }
      : {
        id: 'plan',
        tone: share > 0.15 ? 'danger' : 'warning',
        title: 'Por encima de la línea ideal: atrasados',
        text: `Quedan ${fmt(deviation)} ${unit.long} más de lo que la línea ideal preveía para hoy${daysText}, un ${pct(share)} del alcance inicial.`,
      })

    // Tiempo transcurrido frente a trabajo quemado.
    const idealToday = burndown.idealAt(today)
    if (idealToday !== null) {
      const timeShare = 1 - idealToday / burndown.baseline
      const scope = burndown.baseline + burndown.scopeAdded
      const workShare = scope > 0 ? 1 - remaining / scope : 0
      insights.push({
        id: 'burn',
        tone: workShare + 0.05 >= timeShare ? 'good' : workShare + 0.15 >= timeShare ? 'info' : 'warning',
        title: 'Tiempo consumido frente a trabajo quemado',
        text: `Transcurrió el ${pct(timeShare)} del tiempo hábil hasta el plazo y se quemó el ${pct(workShare)} del trabajo. ${workShare >= timeShare ? 'El trabajo va por delante del calendario.' : 'El calendario avanza más rápido que el trabajo.'}`,
      })
    }

    // Último cruce con la línea ideal.
    const withIdeal = burndown.points.filter((point) => point.ideal !== null)
    for (let index = withIdeal.length - 1; index > 0; index -= 1) {
      const now = withIdeal[index].remaining - withIdeal[index].ideal!
      const before = withIdeal[index - 1].remaining - withIdeal[index - 1].ideal!
      if ((now <= 0) !== (before <= 0)) {
        insights.push({
          id: 'crossing',
          tone: now <= 0 ? 'good' : 'warning',
          title: now <= 0 ? 'La línea real bajó de la ideal' : 'La línea real subió sobre la ideal',
          text: `Ocurrió el ${longDate(withIdeal[index].day)}${now <= 0 ? ' y desde entonces el equipo va adelantado.' : ' y desde entonces el equipo va atrasado respecto del plan.'}`,
        })
        break
      }
    }
  }

  // Proyección frente al plazo.
  switch (forecast.risk) {
    case 'complete':
      insights.push({ id: 'deadline', tone: 'good', title: 'Proyecto completado', text: 'El burndown llegó a 0: no queda trabajo pendiente.' })
      break
    case 'on_track':
      insights.push({
        id: 'deadline',
        tone: 'good',
        title: 'La proyección llega a 0 antes del plazo',
        text: `Al ritmo actual (${pace}) el restante llegaría a 0 el ${longDate(forecast.projectedFinish!)}, ${Math.abs(forecast.daysLate ?? 0)} días antes ${names.of} (${longDate(deadline!)}).`,
      })
      break
    case 'at_risk':
      insights.push({
        id: 'deadline',
        tone: 'danger',
        title: `Riesgo de retraso de ${forecast.daysLate} días`,
        text: `Al ritmo actual (${pace}) el restante llegaría a 0 el ${longDate(forecast.projectedFinish!)}, después ${names.of} (${longDate(deadline!)}).`,
      })
      break
    case 'overdue':
      insights.push({
        id: 'deadline',
        tone: 'danger',
        title: 'Plazo vencido',
        text: `${names.the[0].toUpperCase()}${names.the.slice(1)} era el ${longDate(deadline!)} y quedan ${fmt(remaining)} ${unit.long}.`,
      })
      recommendations.push('Acordar una nueva fecha de entrega y registrarla como fin comprometido del tablero.')
      break
    case 'no_velocity':
      insights.push({ id: 'deadline', tone: 'warning', title: 'Sin ritmo medible', text: `No se completó trabajo en los últimos ${THROUGHPUT_WINDOW_DAYS} días: la proyección no llega a 0.` })
      break
    case 'no_deadline':
      insights.push({
        id: 'deadline',
        tone: 'info',
        title: 'Sin plazo de referencia',
        text: `Al ritmo actual el restante llegaría a 0 el ${longDate(forecast.projectedFinish!)}, pero sin fin comprometido ni fechas en el Gantt no hay línea ideal con qué compararlo.`,
      })
      recommendations.push('Definir un fin comprometido en «Editar» del tablero para trazar la línea ideal.')
      break
  }

  // Ritmo necesario frente al actual.
  if (forecast.requiredPerWeek !== null && forecast.throughputPerWeek > 0 && remaining > 0) {
    const ratio = forecast.requiredPerWeek / forecast.throughputPerWeek
    const needed = `${fmt(forecast.requiredPerWeek)} ${unit.short}/semana`
    if (ratio <= 1) {
      insights.push({
        id: 'required',
        tone: ratio <= 0.6 ? 'good' : 'info',
        title: ratio <= 0.6 ? 'Holgura amplia de ritmo' : 'Ritmo suficiente, con poco margen',
        text: `Para cumplir basta con ${needed}: el ${pct(ratio)} del ritmo actual.${ratio <= 0.6 ? ' El equipo podría bajar la intensidad y aun así llegar.' : ' Cualquier semana sin avance consume el margen.'}`,
      })
    } else {
      insights.push({ id: 'required', tone: 'danger', title: 'El ritmo actual no alcanza', text: `Para cumplir se necesitan ${needed}, un ${pct(ratio - 1)} más que el ritmo actual (${pace}).` })
      recommendations.push(`Subir el ritmo a ${needed} (más dedicación o más personas) o recortar alcance: con el ritmo actual faltarían ${fmt(remaining - (forecast.throughputPerWeek / 7) * Math.max(0, diffDays(today, deadline!)))} ${unit.long} al llegar al plazo.`)
    }
  }

  const regularity = regularityInsight(input, recommendations)
  if (regularity.insight) insights.push(regularity.insight)
  const idle = idleInsight(input, recommendations)
  if (idle) insights.push(idle)
  const trend = trendInsight(input)
  if (trend) insights.push(trend)

  // Mesetas: tramos largos sin quemar trabajo.
  if (burndown) {
    let best: { from: string; to: string; days: number } | null = null
    let runStart: string | null = null
    burndown.points.forEach((point, index) => {
      const flat = point.completed <= 0 && point.remaining > 0
      if (flat && runStart === null) runStart = point.day
      const runEnds = runStart !== null && (!flat || index === burndown.points.length - 1)
      if (runEnds) {
        const to = flat ? point.day : burndown.points[index - 1].day
        const days = diffDays(runStart!, to) + 1
        if (!best || days > best.days) best = { from: runStart!, to, days }
        runStart = null
      }
    })
    const plateau = best as { from: string; to: string; days: number } | null
    if (plateau && plateau.days >= PLATEAU_DAYS) {
      insights.push({
        id: 'plateau',
        tone: 'info',
        title: `Meseta más larga: ${plateau.days} días sin quemar trabajo`,
        text: `Del ${longDate(plateau.from)} al ${longDate(plateau.to)} la línea real quedó plana. En el gráfico se ve como un escalón horizontal: conviene saber qué lo frenó (bloqueos, vacaciones, trabajo no registrado).`,
      })
    }
  }

  // Cambios de alcance.
  if (burndown && burndown.scopeAdded !== 0 && burndown.baseline > 0) {
    const share = burndown.scopeAdded / burndown.baseline
    insights.push({
      id: 'scope',
      tone: share > 0.1 ? 'warning' : 'info',
      title: burndown.scopeAdded > 0 ? 'El alcance creció' : 'El alcance se redujo',
      text: `Desde el inicio se ${burndown.scopeAdded > 0 ? 'agregaron' : 'quitaron'} ${fmt(Math.abs(burndown.scopeAdded))} ${unit.long} (${pct(Math.abs(share))} del alcance inicial).${burndown.scopeAdded > 0 ? ' La línea ideal no lo incluye: parte del atraso puede venir de ahí.' : ''}`,
    })
  }

  // Concentración del restante y tareas grandes.
  const byWeight = [...pending].sort((left, right) => right.weight - left.weight)
  if (byWeight.length >= 3 && remaining > 0) {
    const top = byWeight.slice(0, 2)
    const topWeight = top.reduce((sum, task) => sum + task.weight, 0)
    const share = topWeight / remaining
    if (share >= 0.45 && isPoints(input)) {
      insights.push({
        id: 'concentration',
        tone: 'warning',
        title: 'El restante está en pocas tareas',
        text: `${listRefs(top)} concentran el ${pct(share)} de lo que queda por quemar (${fmt(topWeight)} de ${fmt(remaining)} pts). El momento en que la línea llegue a 0 depende sobre todo de ellas.`,
      })
      recommendations.push(`Priorizar ${listRefs(top)}: empezarlas temprano deja tiempo para resolver imprevistos.`)
    }
  }
  const large = isPoints(input) ? pending.filter((task) => task.weight >= LARGE_TASK_POINTS) : []
  if (large.length > 0) {
    recommendations.push(`Dividir ${listRefs(large)} en tareas de 3 a 8 pts: con ${LARGE_TASK_POINTS} pts o más el burndown no baja hasta que la tarea termina entera.`)
  }

  // Vencimientos próximos.
  const dueSoon = pending.filter((task) => task.endDate && task.endDate >= today && diffDays(today, task.endDate) <= 7)
  const overdueTasks = pending.filter((task) => task.endDate && task.endDate < today)
  if (overdueTasks.length > 0) {
    insights.push({
      id: 'due',
      tone: 'danger',
      title: `${overdueTasks.length} tarea(s) con fecha de fin vencida`,
      text: `${listRefs(overdueTasks.slice(0, 6))}${overdueTasks.length > 6 ? ' y otras' : ''} ya pasaron su fin planificado sin completarse.`,
    })
  } else if (dueSoon.length > 0) {
    insights.push({
      id: 'due',
      tone: 'warning',
      title: `${dueSoon.length} tarea(s) vencen en los próximos 7 días`,
      text: `${listRefs(dueSoon.slice(0, 6))}${dueSoon.length > 6 ? ' y otras' : ''}: suman ${fmt(dueSoon.reduce((sum, task) => sum + task.weight, 0))} ${unit.long}.`,
    })
    recommendations.push(`Asegurar esta semana ${dueSoon.length > 4 ? `${dueSoon.slice(0, 4).map(taskRef).join(', ')} y el resto de lo que vence` : listRefs(dueSoon)}.`)
  }

  insights.push(...measurementInsights(input, recommendations))

  // Contraste entre unidades: la fecha cambia según se cuente tareas o puntos.
  const alternateFinish = input.alternate?.forecast?.projectedFinish
  if (alternateFinish && forecast.projectedFinish && forecast.risk !== 'complete') {
    const gap = diffDays(alternateFinish, forecast.projectedFinish)
    if (Math.abs(gap) >= 3) {
      insights.push({
        id: 'units',
        tone: 'info',
        title: `Medido en ${input.alternate!.label} la fecha cambia`,
        text: isPoints(input)
          ? `Contando tareas, el burndown llegaría a 0 el ${longDate(alternateFinish)}; en puntos, el ${longDate(forecast.projectedFinish)}. ${gap > 0 ? 'Lo que queda pesa más que lo cerrado últimamente: la fecha en puntos es la más realista.' : 'Lo que queda es más liviano que lo cerrado últimamente.'}`
          : `En puntos de esfuerzo el burndown llegaría a 0 el ${longDate(alternateFinish)}; contando tareas, el ${longDate(forecast.projectedFinish)}. ${gap > 0 ? 'Las tareas que quedan son más livianas que las cerradas.' : 'Las tareas que quedan son más grandes que las cerradas: contar tareas resulta optimista.'}`,
      })
    }
  }

  if (recommendations.length === 0 && remaining > 0) recommendations.push('Mantener el ritmo actual y revisar el burndown cada semana.')

  const tone = worstTone(insights, ['plan', 'deadline', 'required', 'idle'])
  const headline = forecast.risk === 'complete'
    ? 'Proyecto completado'
    : tone === 'danger' ? 'El plan requiere atención'
      : tone === 'warning' ? 'En plazo, con riesgos a vigilar'
        : tone === 'good' ? 'El burndown avanza en buen estado'
          : deadline ? 'En plazo, con margen ajustado' : 'Avance sin referencia de plazo'

  const done = forecast.current.total > 0 ? forecast.current.done / forecast.current.total : 0
  const parts = [`Avance del ${pct(done)}: quedan ${fmt(remaining)} de ${fmt(forecast.current.total)} ${unit.long}.`]
  if (burndown?.deviation) parts.push(`Respecto de la línea ideal: ${burndown.deviation < 0 ? `${fmt(-burndown.deviation)} ${unit.short} de adelanto` : `${fmt(burndown.deviation)} ${unit.short} de atraso`}.`)
  if (forecast.projectedFinish && remaining > 0) parts.push(`Al ritmo actual (${pace}) llegaría a 0 el ${longDate(forecast.projectedFinish)}${deadline ? `; ${names.the} es el ${longDate(deadline)}` : ''}.`)
  if (regularity.concentrated) parts.push('Ojo: el ritmo depende de un día puntual.')

  return {
    view: 'burndown',
    tone,
    headline,
    summary: parts.join(' '),
    insights: sortInsights(insights),
    scenarios: deliveryScenarios(input),
    metrics: [],
    recommendations,
  }
}

// ---------------------------------------------------------------------------
// Flujo acumulado: cómo entra, avanza y sale el trabajo
// ---------------------------------------------------------------------------

export function interpretFlowDiagram(input: FlowInterpretationInput): FlowInterpretation {
  const { unit, points, forecast, pending } = input
  const { remaining, current } = forecast
  const insights: FlowInsight[] = []
  const recommendations: string[] = []
  const days = Math.min(WIP_TREND_DAYS, Math.max(0, points.length - 1))
  const throughputPerDay = forecast.throughputPerWeek / 7

  // Entradas y salidas en las últimas 2 semanas.
  const finished = Math.max(0, deltaIn(points, days, (point) => point.done))
  const started = Math.max(0, deltaIn(points, days, (point) => point.done + point.in_progress))
  const arrived = deltaIn(points, days, (point) => point.total)
  const backlogChange = deltaIn(points, days, (point) => point.todo)

  if (days > 0 && (started > 0 || finished > 0)) {
    const ratio = finished > 0 ? started / finished : Infinity
    insights.push({
      id: 'balance',
      tone: ratio > 1.5 ? 'warning' : ratio < 0.67 ? 'good' : 'info',
      title: ratio > 1.5 ? 'Se empieza más de lo que se termina' : ratio < 0.67 ? 'Se termina más de lo que se empieza' : 'Entradas y salidas equilibradas',
      text: `En los últimos ${days} días se empezaron ${fmt(started)} ${unit.long} y se terminaron ${fmt(finished)}. ${ratio > 1.5 ? 'La banda «En progreso» se ensancha: el trabajo se acumula a medio hacer.' : ratio < 0.67 ? 'El equipo está cerrando lo que tenía abierto: la banda «En progreso» se angosta.' : 'La banda «En progreso» mantiene su ancho: el flujo es estable.'}`,
    })
    if (ratio > 1.5) recommendations.push('Dejar de empezar y empezar a terminar: cerrar lo que está en progreso antes de tomar tareas nuevas.')
  }

  // Trabajo en curso y cuello de botella.
  if (remaining > 0) {
    const wipShare = forecast.wipNow / remaining
    if (forecast.bottleneck) {
      insights.push({
        id: 'wip',
        tone: 'danger',
        title: 'Posible cuello de botella',
        text: `El trabajo en progreso pasó de ${fmt(forecast.wipBefore)} a ${fmt(forecast.wipNow)} ${unit.long} en ${WIP_TREND_DAYS} días sin que lo completado crezca al mismo ritmo.`,
      })
      recommendations.push('Revisar qué frena las tareas en progreso (revisión, dependencias, bloqueos) y atacar ese paso primero.')
    } else {
      const inProgressTasks = pending.filter((task) => task.status === 'in_progress').length
      const crowded = wipShare >= 0.6 && inProgressTasks >= 4
      insights.push({
        id: 'wip',
        tone: crowded ? 'warning' : 'info',
        title: crowded ? 'Mucho trabajo empezado a la vez' : 'Trabajo en curso',
        text: `${fmt(forecast.wipNow)} ${unit.long} en progreso (hace ${WIP_TREND_DAYS} días: ${fmt(forecast.wipBefore)}), el ${pct(wipShare)} de lo restante.${crowded ? ' Con tantas tareas abiertas a la vez, cada una tarda más en salir.' : ''}`,
      })
      if (crowded) recommendations.push('Limitar el trabajo en curso (por ejemplo, 2 o 3 tareas por persona) para acortar el tiempo de ciclo.')
    }
  }

  // Tiempo de ciclo (ley de Little).
  if (forecast.cycleTimeDays !== null) {
    insights.push({
      id: 'cycle',
      tone: forecast.cycleTimeDays > 21 ? 'warning' : 'info',
      title: `Tiempo de ciclo estimado: ${fmt(forecast.cycleTimeDays)} días`,
      text: `Con ${fmt(forecast.wipNow)} ${unit.long} en curso y una salida de ${fmt(throughputPerDay * 7)} ${unit.short}/semana, lo que hoy se empieza tarda en promedio ≈ ${fmt(forecast.cycleTimeDays)} días en llegar a «Listo» (ley de Little).${forecast.cycleTimeDays > 21 ? ' Es largo: las tareas pasan más de tres semanas abiertas.' : ''}`,
    })
  }

  // Pendiente sin empezar (banda superior).
  if (current.total > 0) {
    insights.push({
      id: 'backlog',
      tone: 'info',
      title: current.todo === 0 ? 'No queda nada sin empezar' : 'Trabajo sin empezar',
      text: current.todo === 0
        ? `Todo lo pendiente ya está en progreso: la banda «Por hacer» desapareció. Lo que falta depende de terminar lo empezado.`
        : `${fmt(current.todo)} ${unit.long} siguen en «Por hacer» (${pct(current.todo / current.total)} del total).${days > 0 && backlogChange !== 0 ? ` En ${days} días esa banda ${backlogChange < 0 ? 'bajó' : 'subió'} ${fmt(Math.abs(backlogChange))}.` : ''}`,
    })
  }

  // Alcance que entra al flujo.
  if (days > 0 && arrived > 0) {
    const coverage = finished > 0 ? finished / arrived : 0
    insights.push({
      id: 'arrivals',
      tone: coverage >= 1 ? 'info' : 'warning',
      title: 'Entra trabajo nuevo al flujo',
      text: `En ${days} días se agregaron ${fmt(arrived)} ${unit.long} y se terminaron ${fmt(finished)}. ${coverage >= 1 ? 'Se termina más de lo que entra: el total pendiente baja.' : 'Entra más de lo que sale: el total pendiente crece aunque el equipo avance.'}`,
    })
  }

  const regularity = regularityInsight(input, recommendations)
  if (regularity.insight) insights.push(regularity.insight)
  const idle = idleInsight(input, recommendations)
  if (idle) insights.push(idle)
  const trend = trendInsight(input)
  if (trend) insights.push(trend)

  // Tamaño de lo que está en curso frente a lo terminado (requiere ambas unidades).
  const alternate = input.alternate?.points
  if (alternate && alternate.length > 0 && remaining > 0) {
    const pointsSeries = isPoints(input) ? points : alternate
    const taskSeries = isPoints(input) ? alternate : points
    const pointsNow = pointsSeries[pointsSeries.length - 1]
    const wipTasks = taskSeries[taskSeries.length - 1].in_progress
    const wipPoints = pointsNow.in_progress
    const doneTasks = completedIn(taskSeries, forecast.windowDays)
    const donePoints = completedIn(pointsSeries, forecast.windowDays)
    if (wipTasks > 0 && doneTasks > 0) {
      const wipSize = wipPoints / wipTasks
      const doneSize = donePoints / doneTasks
      const bigger = wipSize > doneSize * 1.3
      insights.push({
        id: 'size',
        tone: bigger ? 'warning' : 'info',
        title: bigger ? 'Lo que está en curso es más grande que lo terminado' : 'Tamaño de lo que está en curso',
        text: `En progreso: ${fmt(wipTasks)} tareas que suman ${fmt(wipPoints)} pts (${fmt(wipSize)} pts por tarea). Lo terminado en los últimos ${forecast.windowDays} días promedió ${fmt(doneSize)} pts por tarea.${bigger ? ' Contar tareas subestima lo que falta: mira la vista en puntos.' : ''}`,
      })
    }
  }

  insights.push(...measurementInsights(input, recommendations))
  if (recommendations.length === 0 && remaining > 0) recommendations.push('El flujo está sano: mantener el límite de trabajo en curso y revisar el diagrama cada semana.')

  // Indicadores del flujo.
  const metrics: FlowMetric[] = [
    { label: 'Velocidad (salida)', value: `${fmt(forecast.throughputPerWeek)} ${unit.short}/semana`, note: `Lo que llegó a «Listo» en los últimos ${forecast.windowDays} días.` },
    { label: `Empezado (últimos ${days} días)`, value: `${fmt(started)} ${unit.short}`, note: 'Trabajo que pasó a «En progreso» o directo a «Listo».', tone: started > finished * 1.5 ? 'warning' : undefined },
    { label: `Terminado (últimos ${days} días)`, value: `${fmt(finished)} ${unit.short}`, note: 'Lo que salió del flujo.' },
    { label: 'En progreso hoy', value: `${fmt(forecast.wipNow)} ${unit.short}`, note: `Hace ${WIP_TREND_DAYS} días: ${fmt(forecast.wipBefore)} ${unit.short}.`, tone: forecast.bottleneck ? 'danger' : undefined },
    { label: 'Tiempo de ciclo', value: forecast.cycleTimeDays !== null ? `${fmt(forecast.cycleTimeDays)} días` : '—', note: 'En progreso ÷ velocidad (ley de Little).' },
    { label: 'Por hacer', value: `${fmt(current.todo)} ${unit.short}`, note: 'Trabajo todavía sin empezar.' },
  ]
  if (days > 0 && arrived !== 0) metrics.push({ label: `Alcance añadido (últimos ${days} días)`, value: `${arrived > 0 ? '+' : '−'}${fmt(Math.abs(arrived))} ${unit.short}`, note: 'Trabajo que entró (o salió) del tablero.', tone: arrived > finished ? 'warning' : undefined })

  const tone = worstTone(insights, ['balance', 'wip', 'cycle', 'idle', 'arrivals'])
  const headline = remaining <= 0
    ? 'Flujo completado'
    : tone === 'danger' ? 'El flujo está trabado'
      : tone === 'warning' ? 'El flujo avanza, con acumulación a vigilar'
        : tone === 'good' ? 'El flujo avanza sin acumularse' : 'Flujo estable'
  const parts = [
    `Hoy hay ${fmt(current.done)} ${unit.long} en «Listo», ${fmt(forecast.wipNow)} en progreso y ${fmt(current.todo)} por hacer.`,
    `Sale trabajo a ${fmt(forecast.throughputPerWeek)} ${unit.short}/semana${forecast.cycleTimeDays !== null ? ` y cada unidad tarda ≈ ${fmt(forecast.cycleTimeDays)} días en salir` : ''}.`,
  ]
  if (days > 0 && (started > 0 || finished > 0)) parts.push(`En ${days} días se empezaron ${fmt(started)} y se terminaron ${fmt(finished)}.`)

  return {
    view: 'cfd',
    tone,
    headline,
    summary: parts.join(' '),
    insights: sortInsights(insights),
    scenarios: [],
    metrics,
    recommendations,
  }
}

/** Interpretación de la vista indicada. */
export function interpretFlow(input: FlowInterpretationInput, view: FlowView = 'burndown'): FlowInterpretation {
  return view === 'cfd' ? interpretFlowDiagram(input) : interpretBurndown(input)
}

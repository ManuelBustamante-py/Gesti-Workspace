// Interpretación del avance: lee el burndown, la proyección y el trabajo
// pendiente y devuelve un diagnóstico, hallazgos, escenarios de entrega y
// recomendaciones. Reglas explícitas (sin IA): cada conclusión se puede
// rastrear hasta una cifra del tablero.

import type { Burndown } from './burndown'
import { MIN_THROUGHPUT_DAYS, THROUGHPUT_WINDOW_DAYS, type FlowForecast, type FlowPoint, type FlowStatus } from './cfd'
import { addDays, diffDays, formatDateKey } from './dates'

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
  /** Fin proyectado en la otra unidad, para contrastar. */
  alternate?: { label: string; projectedFinish: string | null }
}

export type FlowInterpretation = {
  tone: InsightTone
  headline: string
  summary: string
  insights: FlowInsight[]
  scenarios: FlowScenario[]
  recommendations: string[]
}

/** Lo completado concentrado en un día por encima de esta parte vuelve frágil la proyección. */
export const CONCENTRATION_SHARE = 0.5
/** Días sin completar nada a partir de los cuales se avisa. */
export const IDLE_DAYS = 7
/** Tareas a partir de este peso conviene dividirlas. */
export const LARGE_TASK_POINTS = 13

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

/** Trabajo completado (neto) en los últimos `days` días, terminando `offset` días antes del último. */
function completedIn(points: FlowPoint[], days: number, offset = 0) {
  const end = points.length - offset
  return Math.max(0, points.slice(Math.max(0, end - days), Math.max(0, end)).reduce((sum, point) => sum + point.completed, 0))
}

function finishAt(today: string, remaining: number, perDay: number) {
  if (remaining <= 0) return today
  return perDay > 0 ? addDays(today, Math.ceil(remaining / perDay)) : null
}

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

export function interpretFlow(input: FlowInterpretationInput): FlowInterpretation {
  const { unit, points, forecast, burndown, pending, committed } = input
  const { today, remaining, deadline } = forecast
  const deadlineName = committed ? 'el fin comprometido' : 'el fin planificado del Gantt'
  // «antes del fin…», no «antes de el fin…».
  const ofDeadline = committed ? 'del fin comprometido' : 'del fin planificado del Gantt'
  const insights: FlowInsight[] = []
  const recommendations: string[] = []
  const pace = `${fmt(forecast.throughputPerWeek)} ${unit.short}/semana`

  // 1. Avance frente a la línea ideal.
  if (burndown && burndown.deviation !== null && burndown.baseline > 0) {
    const deviation = burndown.deviation
    const share = Math.abs(deviation) / burndown.baseline
    const days = burndown.idealPerWorkingDay ? Math.round(Math.abs(deviation) / burndown.idealPerWorkingDay) : null
    const daysText = days ? ` (unos ${days} días hábiles del plan)` : ''
    if (deviation <= 0) {
      insights.push({
        id: 'plan',
        tone: 'good',
        title: deviation === 0 ? 'Justo en la línea ideal' : 'Adelantados respecto del plan',
        text: deviation === 0
          ? 'El trabajo restante coincide con lo que el plan preveía para hoy.'
          : `Quedan ${fmt(Math.abs(deviation))} ${unit.long} menos de lo que la línea ideal preveía para hoy${daysText}, un ${pct(share)} del alcance inicial.`,
      })
    } else {
      insights.push({
        id: 'plan',
        tone: share > 0.15 ? 'danger' : 'warning',
        title: 'Atrasados respecto del plan',
        text: `Quedan ${fmt(deviation)} ${unit.long} más de lo que la línea ideal preveía para hoy${daysText}, un ${pct(share)} del alcance inicial.`,
      })
    }
  }

  // 2. Proyección frente al plazo.
  switch (forecast.risk) {
    case 'complete':
      insights.push({ id: 'deadline', tone: 'good', title: 'Proyecto completado', text: 'No queda trabajo pendiente.' })
      break
    case 'on_track':
      insights.push({
        id: 'deadline',
        tone: 'good',
        title: 'Entrega dentro del plazo',
        text: `Al ritmo actual (${pace}) se terminaría el ${longDate(forecast.projectedFinish!)}, ${Math.abs(forecast.daysLate ?? 0)} días antes ${ofDeadline} (${longDate(deadline!)}).`,
      })
      break
    case 'at_risk':
      insights.push({
        id: 'deadline',
        tone: 'danger',
        title: `Riesgo de retraso de ${forecast.daysLate} días`,
        text: `Al ritmo actual (${pace}) se terminaría el ${longDate(forecast.projectedFinish!)}, después ${ofDeadline} (${longDate(deadline!)}).`,
      })
      break
    case 'overdue':
      insights.push({
        id: 'deadline',
        tone: 'danger',
        title: 'Plazo vencido',
        text: `${deadlineName[0].toUpperCase()}${deadlineName.slice(1)} era el ${longDate(deadline!)} y quedan ${fmt(remaining)} ${unit.long}.`,
      })
      recommendations.push('Acordar una nueva fecha de entrega con quien corresponda y registrarla como fin comprometido del tablero.')
      break
    case 'no_velocity':
      insights.push({
        id: 'deadline',
        tone: 'warning',
        title: 'Sin ritmo medible',
        text: `No se completó trabajo en los últimos ${THROUGHPUT_WINDOW_DAYS} días: no es posible proyectar la entrega.`,
      })
      break
    case 'no_deadline':
      insights.push({
        id: 'deadline',
        tone: 'info',
        title: 'Sin plazo de referencia',
        text: `Al ritmo actual se terminaría el ${longDate(forecast.projectedFinish!)}, pero el tablero no tiene fin comprometido ni fechas en el Gantt con qué compararlo.`,
      })
      recommendations.push('Definir un fin comprometido en «Editar» del tablero para medir el avance contra un plazo.')
      break
  }

  // 3. Ritmo necesario frente al actual.
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
      insights.push({
        id: 'required',
        tone: 'danger',
        title: 'El ritmo actual no alcanza',
        text: `Para cumplir se necesitan ${needed}, un ${pct(ratio - 1)} más que el ritmo actual (${pace}).`,
      })
      recommendations.push(`Subir el ritmo a ${needed} (más dedicación o más personas) o recortar alcance: con el ritmo actual faltarían ${fmt(remaining - (forecast.throughputPerWeek / 7) * Math.max(0, diffDays(today, deadline!)))} ${unit.long} al llegar al plazo.`)
    }
  }

  // 4. Regularidad: ¿el ritmo depende de un solo día?
  const windowPoints = points.slice(-forecast.windowDays)
  const windowTotal = windowPoints.reduce((sum, point) => sum + Math.max(0, point.completed), 0)
  const best = windowPoints.reduce<FlowPoint | null>((top, point) => (!top || point.completed > top.completed ? point : top), null)
  const concentrated = Boolean(best && windowTotal > 0 && best.completed / windowTotal >= CONCENTRATION_SHARE && windowPoints.filter((point) => point.completed > 0).length > 0)
  if (best && concentrated) {
    insights.push({
      id: 'regularity',
      tone: 'warning',
      title: 'Ritmo concentrado en un solo día',
      text: `El ${pct(best.completed / windowTotal)} de lo completado en los últimos ${forecast.windowDays} días ocurrió el ${longDate(best.day)}. La proyección supone que ese esfuerzo se repite: si no vuelve a ocurrir, la fecha estimada se irá atrasando a medida que ese día salga de la ventana de medición.`,
    })
    recommendations.push('Repartir el trabajo en sesiones regulares (por ejemplo, dos por semana) en vez de jornadas puntuales: el ritmo se vuelve predecible y la proyección, confiable.')
  } else if (windowTotal > 0) {
    insights.push({
      id: 'regularity',
      tone: 'good',
      title: 'Ritmo repartido',
      text: `Lo completado en los últimos ${forecast.windowDays} días se distribuye en ${windowPoints.filter((point) => point.completed > 0).length} días distintos: la proyección se apoya en un ritmo sostenido.`,
    })
  }

  // 5. Días sin completar trabajo.
  const lastCompletion = [...points].reverse().find((point) => point.completed > 0)
  const idleDays = lastCompletion ? diffDays(lastCompletion.day, today) : null
  if (remaining > 0 && idleDays !== null && idleDays >= IDLE_DAYS) {
    insights.push({
      id: 'idle',
      tone: idleDays >= 14 ? 'danger' : 'warning',
      title: `${idleDays} días sin completar trabajo`,
      text: `La última entrega fue el ${longDate(lastCompletion!.day)}. Cada día sin avance acorta el margen frente al plazo.`,
    })
    recommendations.push('Retomar el avance cuanto antes, empezando por lo que ya está en progreso.')
  }

  // 6. Tendencia: últimos 14 días frente a los 14 anteriores.
  if (points.length >= 28) {
    const recent = completedIn(points, 14)
    const previous = completedIn(points, 14, 14)
    if (recent > 0 || previous > 0) {
      const change = previous > 0 ? recent / previous - 1 : 1
      insights.push({
        id: 'trend',
        tone: change >= 0.2 ? 'good' : change <= -0.3 ? 'warning' : 'info',
        title: change >= 0.2 ? 'El ritmo está acelerando' : change <= -0.3 ? 'El ritmo está bajando' : 'Ritmo estable',
        text: `Últimos 14 días: ${fmt(recent)} ${unit.long}; los 14 anteriores: ${fmt(previous)}${previous > 0 ? ` (${change >= 0 ? '+' : '−'}${pct(Math.abs(change))})` : ''}.`,
      })
    }
  }

  // 7. Concentración del trabajo restante y tareas grandes.
  const byWeight = [...pending].sort((left, right) => right.weight - left.weight)
  if (byWeight.length >= 3 && remaining > 0) {
    const top = byWeight.slice(0, 2)
    const share = top.reduce((sum, task) => sum + task.weight, 0) / remaining
    if (share >= 0.45) {
      insights.push({
        id: 'concentration',
        tone: 'warning',
        title: 'El riesgo está en pocas tareas',
        text: `${listRefs(top)} concentran el ${pct(share)} del trabajo restante (${fmt(top.reduce((sum, task) => sum + task.weight, 0))} de ${fmt(remaining)} ${unit.long}). El plazo depende sobre todo de ellas.`,
      })
      recommendations.push(`Priorizar ${listRefs(top)}: empezarlas temprano deja tiempo para resolver imprevistos.`)
    }
  }
  const large = pending.filter((task) => task.weight >= LARGE_TASK_POINTS && unit.short === 'pts')
  if (large.length > 0) {
    recommendations.push(`Dividir ${listRefs(large)} en tareas de 3 a 8 pts: con ${LARGE_TASK_POINTS} pts o más la incertidumbre es alta y el avance no se ve hasta el final.`)
  }

  // 8. Vencimientos próximos.
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

  // 9. Trabajo en curso.
  if (remaining > 0) {
    const inProgress = pending.filter((task) => task.status === 'in_progress')
    const wipShare = forecast.wipNow / remaining
    if (forecast.bottleneck) {
      insights.push({
        id: 'wip',
        tone: 'danger',
        title: 'Posible cuello de botella',
        text: `El trabajo en progreso pasó de ${fmt(forecast.wipBefore)} a ${fmt(forecast.wipNow)} ${unit.long} en 14 días sin que lo completado crezca al mismo ritmo.`,
      })
    } else if (wipShare >= 0.6 && inProgress.length >= 4) {
      insights.push({
        id: 'wip',
        tone: 'warning',
        title: 'Mucho trabajo empezado a la vez',
        text: `El ${pct(wipShare)} de lo restante (${inProgress.length} tareas) está en progreso. Tener muchas tareas abiertas alarga el tiempo de ciclo${forecast.cycleTimeDays !== null ? ` (hoy ≈ ${fmt(forecast.cycleTimeDays)} días)` : ''}.`,
      })
      recommendations.push('Limitar el trabajo en curso: terminar lo empezado antes de abrir tareas nuevas.')
    } else if (forecast.cycleTimeDays !== null) {
      insights.push({
        id: 'wip',
        tone: 'info',
        title: 'Trabajo en curso controlado',
        text: `${fmt(forecast.wipNow)} ${unit.long} en progreso; con el ritmo actual, cada unidad tarda ≈ ${fmt(forecast.cycleTimeDays)} días en salir.`,
      })
    }
  }

  // 10. Cambios de alcance.
  if (burndown && burndown.scopeAdded !== 0 && burndown.baseline > 0) {
    const share = burndown.scopeAdded / burndown.baseline
    insights.push({
      id: 'scope',
      tone: share > 0.1 ? 'warning' : 'info',
      title: burndown.scopeAdded > 0 ? 'El alcance creció' : 'El alcance se redujo',
      text: `Desde el inicio se ${burndown.scopeAdded > 0 ? 'agregaron' : 'quitaron'} ${fmt(Math.abs(burndown.scopeAdded))} ${unit.long} (${pct(Math.abs(share))} del alcance inicial).${burndown.scopeAdded > 0 ? ' La línea ideal no lo incluye: parte del atraso puede venir de ahí.' : ''}`,
    })
  }

  // 11. Calidad de la medición.
  if (input.effort && unit.short === 'pts') {
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
  if (forecast.lowConfidence) {
    insights.push({ id: 'confidence', tone: 'warning', title: 'Poco historial', text: 'Hay menos de 2 semanas de historial: la proyección todavía es poco fiable.' })
  }
  if (input.alternate?.projectedFinish && forecast.projectedFinish && forecast.risk !== 'complete') {
    const gap = diffDays(input.alternate.projectedFinish, forecast.projectedFinish)
    if (Math.abs(gap) >= 3) {
      insights.push({
        id: 'units',
        tone: 'info',
        title: `Medido en ${input.alternate.label} la fecha cambia`,
        text: unit.short === 'pts'
          ? `Contando tareas se terminaría el ${longDate(input.alternate.projectedFinish)}; en puntos, el ${longDate(forecast.projectedFinish)}. ${gap > 0 ? 'Lo que queda pesa más que lo que se ha cerrado últimamente: la fecha en puntos es la más realista.' : 'Lo que queda es más liviano que lo cerrado últimamente.'}`
          : `En puntos de esfuerzo se terminaría el ${longDate(input.alternate.projectedFinish)}; contando tareas, el ${longDate(forecast.projectedFinish)}. La medición en puntos considera el tamaño de cada tarea.`,
      })
    }
  }

  if (recommendations.length === 0 && remaining > 0) {
    recommendations.push('Mantener el ritmo actual y revisar este análisis cada semana.')
  }

  // Diagnóstico general: lo más grave entre plan, plazo y ritmo necesario.
  const key = insights.filter((insight) => ['plan', 'deadline', 'required', 'idle'].includes(insight.id))
  const tone = key.reduce<InsightTone>((worst, insight) => (TONE_RANK[insight.tone] > TONE_RANK[worst] ? insight.tone : worst), key.length ? 'good' : 'info')
  const headline = forecast.risk === 'complete'
    ? 'Proyecto completado'
    : tone === 'danger' ? 'El proyecto requiere atención'
      : tone === 'warning' ? 'En plazo, con riesgos a vigilar'
        : tone === 'good' ? 'El proyecto avanza en buen estado'
          : deadline ? 'En plazo, con margen ajustado' : 'Avance sin referencia de plazo'

  const done = forecast.current.total > 0 ? forecast.current.done / forecast.current.total : 0
  const parts = [`Avance del ${pct(done)}: quedan ${fmt(remaining)} de ${fmt(forecast.current.total)} ${unit.long}.`]
  if (forecast.projectedFinish && remaining > 0) parts.push(`Al ritmo actual (${pace}) terminaría el ${longDate(forecast.projectedFinish)}${deadline ? `; ${deadlineName} es el ${longDate(deadline)}` : ''}.`)
  if (burndown?.deviation) parts.push(`Respecto de la línea ideal: ${burndown.deviation < 0 ? `${fmt(-burndown.deviation)} ${unit.short} de adelanto` : `${fmt(burndown.deviation)} ${unit.short} de atraso`}.`)
  if (concentrated) parts.push('Ojo: el ritmo depende de un día puntual.')

  return {
    tone,
    headline,
    summary: parts.join(' '),
    insights: [...insights].sort((left, right) => TONE_RANK[right.tone] - TONE_RANK[left.tone]),
    scenarios: deliveryScenarios(input),
    recommendations,
  }
}

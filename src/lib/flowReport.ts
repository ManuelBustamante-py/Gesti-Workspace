import type { jsPDF as JsPdf } from 'jspdf'

import type { Burndown } from '../domain/burndown'
import { flowLabels, THROUGHPUT_WINDOW_DAYS, type FlowForecast, type FlowPoint, type FlowStatus } from '../domain/cfd'
import { formatDateKey, todayKey, weekdayNumber, type WorkingDays } from '../domain/dates'
import { diagramFileName } from '../domain/diagramSvg'
import type { FlowInterpretation, InsightTone } from '../domain/flowInsights'
import { formatEffort } from '../domain/effort'
import { describeWorkingDays } from '../domain/workSchedule'
import { drawBurndownChart, drawFlowChart } from './flowReportCharts'
import { COLORS, PAGE_MARGIN, createPdfLayout, pdfText, reportDate, type Rgb } from './pdfLayout'

/**
 * Informe de avance y proyección del tablero: portada, resumen ejecutivo,
 * burndown, flujo acumulado, escenarios de entrega, interpretación,
 * trabajo pendiente y metodología. Todo sale de las cifras ya calculadas en la
 * vista de flujo: aquí solo se maqueta.
 */

export type FlowReportPendingTask = {
  number: number | null
  title: string
  column: string
  status: FlowStatus
  /** Puntos de esfuerzo; null sin estimar. */
  effort: number | null
  endDate: string | null
}

export type FlowReportInput = {
  board: { name: string; description?: string | null }
  author: string
  generatedAt: Date
  unit: { short: string; long: string }
  measuredInPoints: boolean
  points: FlowPoint[]
  forecast: FlowForecast
  burndown: Burndown | null
  interpretation: FlowInterpretation
  deadlineName: string
  workingDays: WorkingDays
  effort: { estimated: number; total: number; estimatedPoints: number; fallback: number }
  pending: FlowReportPendingTask[]
  /** Tareas con fecha real registrada («Completada el» / «En esta columna desde»). */
  confirmedCount: number
}

const TONES: Record<InsightTone, Rgb> = { danger: COLORS.warning, warning: COLORS.info, good: COLORS.ok, info: COLORS.muted }
const TONE_TITLES: Record<InsightTone, string> = { danger: 'Crítico', warning: 'A vigilar', good: 'Favorable', info: 'Información' }
const number = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 })
const fmt = (value: number) => number.format(value)
const longDate = (day: string) => formatDateKey(day, { day: 'numeric', month: 'long', year: 'numeric' })
const shortDate = (day: string) => formatDateKey(day, { day: '2-digit', month: '2-digit', year: 'numeric' })

export function buildFlowReport(JsPDF: typeof JsPdf, input: FlowReportInput): JsPdf {
  const { forecast, burndown, interpretation, unit } = input
  const doc = new JsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
  const layout = createPdfLayout(doc)
  let chapterNumber = 0
  const deadlineShort = input.deadlineName.startsWith('Fin comprometido') ? 'Fin comprometido' : 'Fin Gantt'

  const chapter = (title: string) => {
    layout.newPage()
    layout.paragraph(`${(chapterNumber += 1)}. ${title}`, { size: 16, bold: true, rgb: COLORS.text, gap: 4 })
    doc.setDrawColor(COLORS.accent[0], COLORS.accent[1], COLORS.accent[2])
    doc.setLineWidth(1.2)
    doc.line(PAGE_MARGIN, layout.y, PAGE_MARGIN + layout.contentWidth, layout.y)
    layout.y += 14
  }
  const chartBlock = (height: number, draw: (box: { x: number; y: number; width: number; height: number }) => number) => {
    layout.ensure(height + 40)
    const box = { x: PAGE_MARGIN, y: layout.y + 4, width: layout.contentWidth, height }
    const legendHeight = draw(box)
    layout.y = box.y + box.height + legendHeight + 18
  }

  const done = forecast.current.total > 0 ? forecast.current.done / forecast.current.total : 0
  const start = burndown?.start ?? input.points[0]?.day

  // --- Portada ----------------------------------------------------------------------------
  doc.setFillColor(40, 50, 56)
  doc.rect(0, 0, layout.pageWidth, 250, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(170, 186, 190)
  doc.text(pdfText('INFORME DE AVANCE Y PROYECCIÓN DE ENTREGA'), PAGE_MARGIN, 92)
  doc.setFontSize(26)
  doc.setTextColor(255, 255, 255)
  const titleLines = doc.splitTextToSize(pdfText(input.board.name), layout.contentWidth) as string[]
  doc.text(titleLines, PAGE_MARGIN, 128)
  if (input.board.description?.trim()) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(214, 222, 224)
    doc.text((doc.splitTextToSize(pdfText(input.board.description.trim()), layout.contentWidth) as string[]).slice(0, 4), PAGE_MARGIN, 128 + titleLines.length * 30 + 4)
  }
  layout.y = 290
  layout.table(['Dato', 'Valor'], [
    ['Fecha de emisión', reportDate.format(input.generatedAt)],
    ['Elaborado por', input.author || '—'],
    ['Período analizado', start ? `${longDate(start)} – ${longDate(forecast.today)}` : '—'],
    [input.deadlineName, forecast.deadline ? longDate(forecast.deadline) : 'Sin plazo definido'],
    ['Unidad de medida', input.measuredInPoints ? `Puntos de esfuerzo (${input.effort.estimated} de ${input.effort.total} tareas estimadas)` : 'Cantidad de tareas'],
    ['Calendario laboral', describeWorkingDays([...input.workingDays])],
  ])
  const tone = TONES[interpretation.tone]
  layout.y += 6
  // Se corta con la fuente y el tamaño con que se dibuja.
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  const statusLines = doc.splitTextToSize(pdfText(interpretation.summary), layout.contentWidth - 28) as string[]
  const boxHeight = 50 + statusLines.length * 12
  doc.setDrawColor(tone[0], tone[1], tone[2])
  doc.setFillColor(250, 250, 251)
  doc.setLineWidth(1.2)
  doc.roundedRect(PAGE_MARGIN, layout.y, layout.contentWidth, boxHeight, 6, 6, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  layout.color(COLORS.muted)
  doc.text('DIAGNÓSTICO', PAGE_MARGIN + 14, layout.y + 20)
  doc.setFontSize(15)
  layout.color(tone)
  doc.text(pdfText(interpretation.headline), PAGE_MARGIN + 14, layout.y + 38)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  layout.color(COLORS.text)
  doc.text(statusLines, PAGE_MARGIN + 14, layout.y + 54)
  layout.y += boxHeight + 12

  // --- 1. Resumen ejecutivo -----------------------------------------------------------------
  chapter('Resumen ejecutivo')
  layout.paragraph(interpretation.summary, { size: 10.5, gap: 10 })
  const deviation = burndown?.deviation ?? null
  layout.facts([
    { label: 'Avance', value: `${Math.round(done * 100)} %`, tone: COLORS.ok },
    { label: `Restante (${unit.short})`, value: `${fmt(forecast.remaining)} de ${fmt(forecast.current.total)}` },
    {
      label: 'Vs. línea ideal hoy',
      value: deviation === null ? '—' : `${deviation > 0 ? '+' : deviation < 0 ? '−' : ''}${fmt(Math.abs(deviation))} ${unit.short}`,
      tone: deviation === null ? undefined : deviation > 0 ? COLORS.warning : COLORS.ok,
    },
    { label: `Velocidad (${unit.short}/semana)`, value: fmt(forecast.throughputPerWeek) },
    { label: `En progreso (${unit.short})`, value: fmt(forecast.wipNow) },
    { label: 'Tiempo de ciclo', value: forecast.cycleTimeDays !== null ? `${fmt(forecast.cycleTimeDays)} días` : '—' },
    {
      label: 'Fin proyectado',
      value: forecast.projectedFinish ? shortDate(forecast.projectedFinish) : '—',
      tone: forecast.risk === 'at_risk' || forecast.risk === 'overdue' ? COLORS.warning : forecast.projectedFinish ? COLORS.ok : undefined,
    },
    { label: input.deadlineName, value: forecast.deadline ? shortDate(forecast.deadline) : '—' },
  ])
  layout.subheading('Puntos clave')
  for (const insight of interpretation.insights.slice(0, 6)) {
    layout.item(`${insight.title}. ${insight.text}`, { rgb: TONES[insight.tone] })
  }

  // --- 2. Burndown ------------------------------------------------------------------------
  if (burndown) {
    chapter('Burndown: trabajo restante frente al plan')
    layout.paragraph(
      `El gráfico muestra cuánto trabajo quedaba (en ${unit.long}) al final de cada día. La línea ideal baja de forma pareja, solo en días hábiles, desde ${fmt(burndown.baseline)} ${unit.short} el ${longDate(burndown.start)} hasta 0 en ${forecast.deadline ? `el ${input.deadlineName.toLowerCase()} (${longDate(forecast.deadline)})` : 'el plazo (no definido)'}. Si la línea real queda por debajo de la ideal, el equipo va adelantado; si queda por encima, atrasado. La línea discontinua azul proyecta el restante al ritmo medido.`,
      { gap: 8 },
    )
    chartBlock(250, (box) => drawBurndownChart(doc, box, { burndown, forecast, unit: unit.short, workingDays: input.workingDays, deadlineLabel: deadlineShort }))
    layout.subheading('Lectura del burndown')
    const idealToday = burndown.idealAt(forecast.today)
    layout.item(`Punto de partida: ${fmt(burndown.baseline)} ${unit.short} el ${longDate(burndown.start)}.`, { rgb: COLORS.accent })
    if (idealToday !== null) {
      layout.item(`Hoy quedan ${fmt(forecast.remaining)} ${unit.short}; el plan preveía ${fmt(idealToday)}. ${deviation !== null && deviation <= 0 ? `Adelanto de ${fmt(Math.abs(deviation))} ${unit.short}.` : `Atraso de ${fmt(deviation ?? 0)} ${unit.short}.`}`, { rgb: deviation !== null && deviation > 0 ? COLORS.warning : COLORS.ok })
    }
    layout.item(`Completado desde el inicio: ${fmt(burndown.completedSinceStart)} ${unit.short}.${burndown.scopeAdded !== 0 ? ` Alcance ${burndown.scopeAdded > 0 ? 'añadido' : 'quitado'}: ${fmt(Math.abs(burndown.scopeAdded))} ${unit.short}.` : ' El alcance no cambió.'}`, { rgb: COLORS.accent })
    if (burndown.workingDaysLeft !== null) layout.item(`Quedan ${burndown.workingDaysLeft} días hábiles hasta el plazo.`, { rgb: COLORS.accent })
  }

  // --- 3. Flujo acumulado -------------------------------------------------------------------
  if (input.points.length > 0) {
    chapter('Flujo acumulado (CFD)')
    layout.paragraph(
      `Cada banda es el trabajo en un estado cada día: abajo lo terminado, al medio lo que está en curso y arriba lo pendiente. Una banda «En progreso» que se ensancha indica que se empieza más de lo que se termina. A la derecha de «Hoy», la línea discontinua proyecta lo completado al ritmo medido.`,
      { gap: 8 },
    )
    chartBlock(230, (box) => drawFlowChart(doc, box, { points: input.points, forecast, unit: unit.short, deadlineLabel: deadlineShort }))
    layout.subheading('Lectura del flujo')
    layout.item(`Trabajo en progreso: ${fmt(forecast.wipNow)} ${unit.short} (hace 14 días: ${fmt(forecast.wipBefore)}).${forecast.bottleneck ? ' Crece más rápido que lo completado: posible cuello de botella.' : ''}`, { rgb: forecast.bottleneck ? COLORS.warning : COLORS.accent })
    layout.item(`Velocidad: ${fmt(forecast.throughputPerWeek)} ${unit.short}/semana en los últimos ${forecast.windowDays} días.`, { rgb: COLORS.accent })
    if (forecast.cycleTimeDays !== null) layout.item(`Tiempo de ciclo estimado (ley de Little): ${fmt(forecast.cycleTimeDays)} días desde que algo se empieza hasta que se termina.`, { rgb: COLORS.accent })
  }

  // --- 4. Escenarios ------------------------------------------------------------------------
  chapter('Proyección y escenarios de entrega')
  layout.paragraph(
    `La proyección principal supone que el equipo mantiene el ritmo de los últimos ${forecast.windowDays} días y que no se agrega trabajo. Como el ritmo real varía, se comparan escenarios con distintos ritmos medidos y el mínimo necesario para cumplir el plazo.`,
    { gap: 8 },
  )
  const scenarios = interpretation.scenarios
  layout.table(
    ['Escenario', `${unit.short}/semana`, 'Terminaría', 'Frente al plazo', 'Lectura'],
    scenarios.map((scenario) => [
      scenario.label,
      fmt(Math.round(scenario.perWeek * 10) / 10),
      scenario.finish ? shortDate(scenario.finish) : 'Sin avance',
      scenario.id === 'required' ? 'Referencia' : scenario.meetsDeadline === null ? '—' : scenario.meetsDeadline ? 'Cumple' : 'No cumple',
      scenario.note,
    ]),
    { tones: scenarios.map((scenario) => (scenario.id === 'required' ? COLORS.muted : scenario.meetsDeadline === false ? COLORS.warning : scenario.meetsDeadline ? COLORS.ok : undefined)) },
  )
  const measured = scenarios.filter((scenario) => scenario.id !== 'required' && scenario.meetsDeadline !== null)
  if (measured.length > 0) {
    const meeting = measured.filter((scenario) => scenario.meetsDeadline).length
    layout.paragraph(
      meeting === measured.length
        ? `Los ${measured.length} escenarios medidos terminan dentro del plazo: la entrega es robusta frente a variaciones del ritmo.`
        : meeting === 0
          ? 'Ningún escenario medido termina dentro del plazo: con los ritmos observados no se llega sin cambios de capacidad o de alcance.'
          : `${meeting} de ${measured.length} escenarios terminan dentro del plazo: el resultado depende de qué ritmo sostenga el equipo.`,
      { bold: true, rgb: meeting === measured.length ? COLORS.ok : meeting === 0 ? COLORS.warning : COLORS.info, gap: 6 },
    )
  }

  // --- 5. Interpretación --------------------------------------------------------------------
  chapter('Interpretación y recomendaciones')
  for (const level of ['danger', 'warning', 'good', 'info'] as const) {
    const group = interpretation.insights.filter((insight) => insight.tone === level)
    if (!group.length) continue
    layout.subheading(`${TONE_TITLES[level]} (${group.length})`, TONES[level])
    for (const insight of group) layout.item(`${insight.title}. ${insight.text}`, { rgb: TONES[level] })
  }
  if (interpretation.recommendations.length) {
    layout.subheading('Recomendaciones')
    interpretation.recommendations.forEach((text, index) => layout.item(text, { rgb: COLORS.accent, label: `${index + 1}.` }))
  }

  // --- 6. Trabajo pendiente -----------------------------------------------------------------
  if (input.pending.length > 0) {
    chapter('Trabajo pendiente')
    const pendingPoints = input.pending.reduce((sum, task) => sum + (task.effort ?? input.effort.fallback), 0)
    layout.paragraph(
      `${input.pending.length} tarea(s) sin completar${input.measuredInPoints ? `, ${fmt(Math.round(pendingPoints * 10) / 10)} pts en total` : ''}. Ordenadas por esfuerzo: las primeras son las que más pesan en el plazo.`,
      { gap: 8 },
    )
    const sorted = [...input.pending].sort((left, right) => (right.effort ?? 0) - (left.effort ?? 0) || (left.number ?? 0) - (right.number ?? 0))
    layout.table(
      ['N°', 'Tarea', 'Columna', 'Estado', 'Esfuerzo', 'Fin planificado'],
      sorted.map((task) => [
        task.number !== null ? String(task.number) : '—',
        task.title,
        task.column,
        flowLabels[task.status],
        task.effort !== null ? formatEffort(task.effort) : 'Sin estimar',
        task.endDate ? shortDate(task.endDate) : '—',
      ]),
      { tones: sorted.map((task) => (task.endDate && task.endDate < forecast.today ? COLORS.warning : undefined)) },
    )
  }

  // --- Anexo: metodología y serie semanal ---------------------------------------------------
  layout.newPage()
  layout.paragraph('Anexo A. Metodología', { size: 16, bold: true, rgb: COLORS.text, gap: 10 })
  const method: Array<[string, string]> = [
    ['Unidad de medida', input.measuredInPoints
      ? `Puntos de esfuerzo (escala de planning poker). Cada tarea aporta sus puntos.${input.effort.total > input.effort.estimated ? ` Las ${input.effort.total - input.effort.estimated} sin estimar aportan el promedio de las estimadas (${fmt(input.effort.fallback)} pts).` : ' Todas las tareas están estimadas.'}`
      : 'Cantidad de tareas: todas pesan lo mismo.'],
    ['Velocidad', `Trabajo que pasó a «Listo» desde otro estado, menos lo reabierto, en los últimos ${THROUGHPUT_WINDOW_DAYS} días. Lo creado o importado ya terminado no cuenta. Con menos de una semana de historial se divide igualmente por 7 días.`],
    ['Fechas reales', `Se usan las fechas registradas por el equipo («Completada el» y «En esta columna desde») de ${input.confirmedCount} tarea(s) en lugar del momento en que se movió la tarjeta.`],
    ['Línea ideal', 'Baja de forma lineal desde el restante del día de inicio hasta 0 en el plazo, solo en días hábiles. No se ajusta al alcance añadido después, para que ese crecimiento se vea como desviación.'],
    ['Alcance inicial', 'Las tareas que llegaron con el tablero (creación o importación inicial) forman parte del alcance desde el inicio; solo lo agregado después cuenta como alcance añadido.'],
    ['Proyección', 'Restante ÷ velocidad diaria, contado desde hoy. Supone que el ritmo se mantiene y que no se agrega trabajo.'],
    ['Tiempo de ciclo', 'Ley de Little: trabajo en progreso ÷ velocidad. Es una estimación del tiempo medio que tarda el trabajo en terminarse una vez empezado.'],
    ['Interpretación', 'Reglas explícitas sobre las cifras anteriores (sin inteligencia artificial): cada hallazgo puede verificarse en los gráficos y tablas de este informe.'],
  ]
  for (const [label, text] of method) {
    layout.paragraph(label.toUpperCase(), { size: 7.5, bold: true, rgb: COLORS.muted, gap: 0 })
    layout.paragraph(text, { size: 9.5, gap: 6 })
  }

  const weekly = input.points.filter((point, index) => weekdayNumber(point.day) === 2 || index === input.points.length - 1)
  if (weekly.length > 0) {
    layout.y += 8
    layout.paragraph(`Anexo B. Serie semanal (${unit.long})`, { size: 16, bold: true, rgb: COLORS.text, gap: 10 })
    layout.table(
      ['Fecha', 'Listo', 'En progreso', 'Por hacer', 'Total', 'Restante', 'Ideal'],
      weekly.map((point) => {
        const ideal = burndown && point.day >= burndown.start ? burndown.idealAt(point.day) : null
        return [
          `${shortDate(point.day)}${point.day === forecast.today ? ' (hoy)' : ''}`,
          fmt(point.done),
          fmt(point.in_progress),
          fmt(point.todo),
          fmt(point.total),
          fmt(Math.round((point.total - point.done) * 10) / 10),
          ideal !== null ? fmt(ideal) : '—',
        ]
      }),
    )
  }

  layout.footer(`Informe de avance · ${input.board.name}`, 2)
  return doc
}

/** Genera y descarga el informe (jsPDF se carga solo al descargar). */
export async function downloadFlowReport(input: Omit<FlowReportInput, 'generatedAt'>) {
  const { jsPDF } = await import('jspdf')
  const doc = buildFlowReport(jsPDF, { ...input, generatedAt: new Date() })
  doc.save(diagramFileName(`informe de avance ${input.board.name} ${todayKey()}`, 'pdf'))
}

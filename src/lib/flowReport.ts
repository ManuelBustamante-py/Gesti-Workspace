import type { jsPDF as JsPdf } from 'jspdf'

import { flowLabels, THROUGHPUT_WINDOW_DAYS, type FlowStatus } from '../domain/cfd'
import { addDays, formatDateKey, todayKey, weekdayNumber, type WorkingDays } from '../domain/dates'
import { diagramFileName } from '../domain/diagramSvg'
import { formatEffort } from '../domain/effort'
import type { FlowAnalysis } from '../domain/flowAnalysis'
import type { FlowInsight, InsightTone } from '../domain/flowInsights'
import { describeWorkingDays } from '../domain/workSchedule'
import { drawBurndownChart, drawFlowChart } from './flowReportCharts'
import { COLORS, PAGE_MARGIN, createPdfLayout, pdfText, reportDate, type Rgb } from './pdfLayout'

/**
 * Informe de avance y proyección del tablero, con diseño de informe ejecutivo:
 * portada con indicadores, índice clicable y marcadores del PDF, resumen
 * ejecutivo, burndown, escenarios de entrega, flujo acumulado, recomendaciones,
 * trabajo pendiente y anexos. Cada vista lleva su propia interpretación. Todo
 * sale del análisis ya calculado en la vista de flujo: aquí solo se maqueta.
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
  analysis: FlowAnalysis
  measuredInPoints: boolean
  deadlineName: string
  workingDays: WorkingDays
  effort: { estimated: number; total: number; estimatedPoints: number; fallback: number }
  pending: FlowReportPendingTask[]
  /** Tareas con fecha real registrada («Completada el» / «En esta columna desde»). */
  confirmedCount: number
}

const BRAND = { dark: [34, 43, 49], accent: [59, 110, 200], soft: [244, 246, 248], line: [222, 226, 230] } as const
const TONES: Record<InsightTone, Rgb> = { danger: [200, 70, 95], warning: [196, 140, 40], good: [46, 140, 90], info: [108, 117, 125] }
const TONE_FILLS: Record<InsightTone, Rgb> = { danger: [252, 240, 243], warning: [252, 246, 234], good: [238, 247, 242], info: [245, 246, 247] }
const TONE_TITLES: Record<InsightTone, string> = { danger: 'CRÍTICO', warning: 'A VIGILAR', good: 'FAVORABLE', info: 'INFORMACIÓN' }
const number = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 })
const fmt = (value: number) => number.format(Math.round(value * 10) / 10)
const longDate = (day: string) => formatDateKey(day, { day: 'numeric', month: 'long', year: 'numeric' })
const shortDate = (day: string) => formatDateKey(day, { day: '2-digit', month: '2-digit', year: 'numeric' })
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '-' : ''}${fmt(Math.abs(value))}`
const SCENARIO_SHORT = { current: 'Ritmo actual', recent: 'Ritmo reciente', historical: 'Ritmo histórico', required: 'Ritmo necesario' } as const
const capitalize = (text: string) => `${text[0].toUpperCase()}${text.slice(1)}`

export function buildFlowReport(JsPDF: typeof JsPdf, input: FlowReportInput): JsPdf {
  const { analysis } = input
  const { forecast, burndown, unit } = analysis
  const plan = analysis.interpretations.burndown
  const flow = analysis.interpretations.cfd
  const doc = new JsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
  const layout = createPdfLayout(doc)
  const width = layout.pageWidth
  const contentWidth = layout.contentWidth
  const deadlineShort = input.deadlineName.startsWith('Fin comprometido') ? 'Fin comprometido' : 'Fin Gantt'
  const done = forecast.current.total > 0 ? forecast.current.done / forecast.current.total : 0
  const start = burndown?.start ?? analysis.points[0]?.day
  const weekAhead = addDays(forecast.today, 7)

  // Capítulos: para el índice, los marcadores y el encabezado de cada página.
  const chapters: Array<{ number: string; title: string; page: number }> = []
  const pageChapter = new Map<number, string>()
  let chapterCount = 0

  const setFill = (rgb: Rgb) => doc.setFillColor(rgb[0], rgb[1], rgb[2])
  const setDraw = (rgb: Rgb) => doc.setDrawColor(rgb[0], rgb[1], rgb[2])
  const setText = (rgb: Rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2])

  const markPage = () => {
    const last = chapters[chapters.length - 1]
    if (last) pageChapter.set(doc.getNumberOfPages(), /^[A-Z]$/.test(last.number) ? `Anexo ${last.number}. ${last.title}` : `${last.number}. ${last.title}`)
  }
  /** Asegura espacio; si salta de página, deja lugar para el encabezado corrido. */
  const ensure = (height: number) => {
    const before = doc.getNumberOfPages()
    layout.ensure(height)
    if (doc.getNumberOfPages() !== before) {
      layout.y = Math.max(layout.y, PAGE_MARGIN + 10)
      markPage()
    }
  }

  const chapter = (title: string, subtitle: string, label?: string) => {
    layout.newPage()
    layout.y = PAGE_MARGIN + 10
    const tag = label ?? String((chapterCount += 1))
    chapters.push({ number: tag, title, page: doc.getNumberOfPages() })
    markPage()
    setFill(BRAND.accent)
    doc.roundedRect(PAGE_MARGIN, layout.y, 30, 30, 5, 5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(255, 255, 255)
    doc.text(pdfText(tag), PAGE_MARGIN + 15, layout.y + 20, { align: 'center' })
    doc.setFontSize(17)
    setText(COLORS.text)
    doc.text(pdfText(label ? `Anexo ${label}. ${title}` : title), PAGE_MARGIN + 42, layout.y + 14)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    setText(COLORS.muted)
    doc.text(pdfText(subtitle), PAGE_MARGIN + 42, layout.y + 28)
    layout.y += 42
    setDraw(BRAND.line)
    doc.setLineWidth(0.8)
    doc.line(PAGE_MARGIN, layout.y, PAGE_MARGIN + contentWidth, layout.y)
    layout.y += 16
  }

  const sectionTitle = (text: string) => {
    ensure(70)
    layout.y += 4
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    setText(BRAND.accent)
    doc.text(pdfText(text.toUpperCase()), PAGE_MARGIN, layout.y + 8)
    layout.y += 16
  }

  /** Recuadro con borde lateral de color, etiqueta de tono, título y texto. */
  const callout = (tone: InsightTone, title: string, text: string, options: { label?: string; large?: boolean } = {}) => {
    const size = options.large ? 10 : 9
    const titleSize = options.large ? 13 : 10
    const inner = contentWidth - 28
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(size)
    const lines = doc.splitTextToSize(pdfText(text), inner) as string[]
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(titleSize)
    const titleLines = doc.splitTextToSize(pdfText(title), inner) as string[]
    const titleHeight = titleLines.length * titleSize * 1.2
    const height = 24 + titleHeight + lines.length * size * 1.4 + 2
    ensure(height + 8)
    const y = layout.y
    setFill(TONE_FILLS[tone])
    doc.roundedRect(PAGE_MARGIN, y, contentWidth, height, 4, 4, 'F')
    setFill(TONES[tone])
    doc.rect(PAGE_MARGIN, y, 3, height, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    setText(TONES[tone])
    doc.text(pdfText(options.label ?? TONE_TITLES[tone]), PAGE_MARGIN + 14, y + 12)
    doc.setFontSize(titleSize)
    setText(COLORS.text)
    doc.text(titleLines, PAGE_MARGIN + 14, y + 14 + titleSize)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(size)
    setText([60, 66, 70])
    doc.text(lines, PAGE_MARGIN + 14, y + 18 + titleHeight + size)
    layout.y = y + height + 8
  }

  const insightList = (insights: FlowInsight[]) => {
    for (const insight of insights) callout(insight.tone, insight.title, insight.text)
  }

  /** Fila de indicadores en tarjetas (sobre fondo oscuro en la portada). */
  const kpis = (items: Array<{ label: string; value: string; note?: string; tone?: Rgb }>, perRow = 4, dark = false) => {
    const gap = 8
    const cardWidth = (contentWidth - gap * (perRow - 1)) / perRow
    for (let first = 0; first < items.length; first += perRow) {
      const row = items.slice(first, first + perRow)
      const height = row.some((item) => item.note) ? 58 : 46
      ensure(height + gap)
      row.forEach((item, index) => {
        const x = PAGE_MARGIN + index * (cardWidth + gap)
        if (dark) doc.setFillColor(48, 60, 67)
        else setFill(BRAND.soft)
        doc.roundedRect(x, layout.y, cardWidth, height, 5, 5, 'F')
        if (item.tone) {
          setFill(item.tone)
          doc.rect(x, layout.y + 8, 2.5, height - 16, 'F')
        }
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(6.5)
        if (dark) doc.setTextColor(160, 178, 184)
        else setText(COLORS.muted)
        doc.text((doc.splitTextToSize(pdfText(item.label.toUpperCase()), cardWidth - 18) as string[]).slice(0, 1), x + 10, layout.y + 14)
        let size = 16
        doc.setFontSize(size)
        while (size > 9 && doc.getTextWidth(pdfText(item.value)) > cardWidth - 18) doc.setFontSize((size -= 1))
        if (dark) doc.setTextColor(255, 255, 255)
        else setText(item.tone ?? COLORS.text)
        doc.text(pdfText(item.value), x + 10, layout.y + 34)
        if (item.note) {
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(7)
          if (dark) doc.setTextColor(200, 210, 212)
          else setText(COLORS.muted)
          doc.text((doc.splitTextToSize(pdfText(item.note), cardWidth - 18) as string[]).slice(0, 1), x + 10, layout.y + 48)
        }
      })
      layout.y += height + gap
    }
  }

  /** Gráfico dentro de una tarjeta con título y subtítulo. */
  const chartCard = (title: string, subtitle: string, height: number, draw: (box: { x: number; y: number; width: number; height: number }) => number) => {
    const total = height + 72
    ensure(total + 8)
    const top = layout.y
    setDraw(BRAND.line)
    doc.setLineWidth(0.8)
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(PAGE_MARGIN, top, contentWidth, total, 6, 6, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    setText(COLORS.text)
    doc.text(pdfText(title), PAGE_MARGIN + 14, top + 20)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    setText(COLORS.muted)
    doc.text(pdfText(subtitle), PAGE_MARGIN + 14, top + 32)
    draw({ x: PAGE_MARGIN + 10, y: top + 42, width: contentWidth - 22, height })
    layout.y = top + total + 12
  }

  // --- Portada ------------------------------------------------------------------------------
  setFill(BRAND.dark)
  doc.rect(0, 0, width, 330, 'F')
  setFill(BRAND.accent)
  doc.rect(0, 330, width, 4, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(150, 170, 176)
  doc.text(pdfText('INFORME DE AVANCE Y PROYECCIÓN DE ENTREGA'), PAGE_MARGIN, 70)
  doc.setFontSize(28)
  doc.setTextColor(255, 255, 255)
  const titleLines = (doc.splitTextToSize(pdfText(input.board.name), contentWidth) as string[]).slice(0, 2)
  doc.text(titleLines, PAGE_MARGIN, 104)
  let coverY = 104 + titleLines.length * 30
  if (input.board.description?.trim()) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10.5)
    doc.setTextColor(206, 216, 218)
    const description = (doc.splitTextToSize(pdfText(input.board.description.trim()), contentWidth) as string[]).slice(0, 3)
    doc.text(description, PAGE_MARGIN, coverY - 4)
    coverY += description.length * 14
  }
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(170, 186, 190)
  doc.text(pdfText(`Medido en ${unit.long} · ${start ? `${longDate(start)} – ${longDate(forecast.today)}` : longDate(forecast.today)}`), PAGE_MARGIN, coverY + 6)
  layout.y = Math.max(coverY + 26, 196)
  kpis([
    { label: 'Avance', value: `${Math.round(done * 100)} %` },
    { label: `Restante (${unit.short})`, value: fmt(forecast.remaining) },
    { label: 'Fin proyectado', value: forecast.projectedFinish ? shortDate(forecast.projectedFinish) : '—' },
    { label: input.deadlineName, value: forecast.deadline ? shortDate(forecast.deadline) : '—' },
  ], 4, true)

  layout.y = 358
  callout(plan.tone, plan.headline, plan.summary, { label: 'DIAGNÓSTICO DEL PLAN · BURNDOWN', large: true })
  callout(flow.tone, flow.headline, flow.summary, { label: 'DIAGNÓSTICO DEL FLUJO · CFD', large: true })
  layout.y += 4
  layout.table(['Dato', 'Valor'], [
    ['Fecha de emisión', reportDate.format(input.generatedAt)],
    ['Elaborado por', input.author || '—'],
    ['Unidad de medida', input.measuredInPoints ? `Puntos de esfuerzo (${input.effort.estimated} de ${input.effort.total} tareas estimadas)` : 'Cantidad de tareas'],
    ['Calendario laboral', describeWorkingDays([...input.workingDays])],
  ])

  // --- Índice (se completa al final, con los números de página reales) ----------------------
  layout.newPage()
  const tocPage = doc.getNumberOfPages()

  // --- 1. Resumen ejecutivo -----------------------------------------------------------------
  chapter('Resumen ejecutivo', 'Las cifras clave y lo más importante de cada vista')
  const deviation = burndown?.deviation ?? null
  kpis([
    { label: 'Avance', value: `${Math.round(done * 100)} %`, note: `${fmt(forecast.current.done)} de ${fmt(forecast.current.total)} ${unit.short}`, tone: TONES.good },
    { label: 'Restante', value: `${fmt(forecast.remaining)} ${unit.short}`, note: burndown?.scopeAdded ? `Alcance ${signed(burndown.scopeAdded)} ${unit.short}` : 'Sin cambios de alcance' },
    {
      label: 'Vs. línea ideal',
      value: deviation === null ? '—' : `${signed(deviation)} ${unit.short}`,
      note: deviation === null ? 'Sin plazo' : deviation > 0 ? 'Atraso respecto del plan' : 'Adelanto respecto del plan',
      tone: deviation === null ? undefined : deviation > 0 ? TONES.danger : TONES.good,
    },
    { label: 'Velocidad', value: `${fmt(forecast.throughputPerWeek)} ${unit.short}/sem`, note: `Últimos ${forecast.windowDays} días` },
    { label: 'En progreso', value: `${fmt(forecast.wipNow)} ${unit.short}`, note: `Hace 14 días: ${fmt(forecast.wipBefore)}`, tone: forecast.bottleneck ? TONES.danger : undefined },
    { label: 'Tiempo de ciclo', value: forecast.cycleTimeDays !== null ? `${fmt(forecast.cycleTimeDays)} días` : '—', note: 'Ley de Little' },
    {
      label: 'Fin proyectado',
      value: forecast.projectedFinish ? shortDate(forecast.projectedFinish) : '—',
      note: forecast.daysLate !== null ? (forecast.daysLate > 0 ? `${forecast.daysLate} días tarde` : `${Math.abs(forecast.daysLate)} días de margen`) : undefined,
      tone: forecast.risk === 'at_risk' || forecast.risk === 'overdue' ? TONES.danger : forecast.projectedFinish ? TONES.good : undefined,
    },
    { label: input.deadlineName, value: forecast.deadline ? shortDate(forecast.deadline) : '—', note: burndown?.workingDaysLeft != null ? `${burndown.workingDaysLeft} días hábiles` : undefined },
  ])
  sectionTitle('Plan y plazo (burndown)')
  callout(plan.tone, plan.headline, plan.summary, { label: 'DIAGNÓSTICO' })
  insightList(plan.insights.filter((insight) => insight.tone === 'danger' || insight.tone === 'warning').slice(0, 3))
  sectionTitle('Flujo de trabajo (CFD)')
  callout(flow.tone, flow.headline, flow.summary, { label: 'DIAGNÓSTICO' })
  insightList(flow.insights.filter((insight) => insight.tone === 'danger' || insight.tone === 'warning').slice(0, 3))

  // --- 2. Burndown --------------------------------------------------------------------------
  if (burndown) {
    chapter('Burndown', `Trabajo restante en ${unit.long} frente a la línea ideal hasta el plazo`)
    layout.paragraph(
      `La línea ideal baja de forma pareja, solo en días hábiles, desde ${fmt(burndown.baseline)} ${unit.short} el ${longDate(burndown.start)} hasta 0 en ${forecast.deadline ? `el ${input.deadlineName.toLowerCase()} (${longDate(forecast.deadline)})` : 'el plazo (no definido)'}. Si la línea real queda por debajo, el equipo va adelantado; si queda por encima, atrasado. La línea azul discontinua proyecta el restante al ritmo medido.`,
      { size: 9.5, gap: 10 },
    )
    chartCard('Trabajo restante', `${capitalize(unit.long)} pendientes al final de cada día`, 240, (box) =>
      drawBurndownChart(doc, box, { burndown, forecast, unit: unit.short, workingDays: input.workingDays, deadlineLabel: deadlineShort }),
    )
    sectionTitle(`Interpretación del burndown · en ${unit.long}`)
    callout(plan.tone, plan.headline, plan.summary, { label: 'DIAGNÓSTICO', large: true })
    insightList(plan.insights)
  }

  // --- 3. Escenarios ------------------------------------------------------------------------
  if (plan.scenarios.length > 0) {
    chapter('Escenarios de entrega', 'Cuándo se terminaría con distintos ritmos de trabajo')
    layout.paragraph(
      `La proyección principal supone que el equipo mantiene el ritmo de los últimos ${forecast.windowDays} días y que no se agrega trabajo. Como el ritmo real varía, se comparan escenarios con distintos ritmos medidos y el mínimo necesario para cumplir el plazo.`,
      { size: 9.5, gap: 10 },
    )
    kpis(plan.scenarios.map((scenario) => ({
      label: SCENARIO_SHORT[scenario.id],
      value: scenario.finish ? shortDate(scenario.finish) : 'Sin avance',
      note: `${fmt(scenario.perWeek)} ${unit.short}/semana${scenario.id === 'required' ? ' · referencia' : scenario.meetsDeadline === null ? '' : scenario.meetsDeadline ? ' · cumple' : ' · no cumple'}`,
      tone: scenario.id === 'required' ? TONES.info : scenario.meetsDeadline === false ? TONES.danger : scenario.meetsDeadline ? TONES.good : undefined,
    })), Math.min(4, plan.scenarios.length))
    layout.y += 4
    layout.table(
      ['Escenario', `${unit.short}/semana`, 'Terminaría', 'Frente al plazo', 'Lectura'],
      plan.scenarios.map((scenario) => [
        scenario.label,
        fmt(scenario.perWeek),
        scenario.finish ? shortDate(scenario.finish) : 'Sin avance',
        scenario.id === 'required' ? 'Referencia' : scenario.meetsDeadline === null ? '—' : scenario.meetsDeadline ? 'Cumple' : 'No cumple',
        scenario.note,
      ]),
      { tones: plan.scenarios.map((scenario) => (scenario.id === 'required' ? COLORS.muted : scenario.meetsDeadline === false ? TONES.danger : scenario.meetsDeadline ? TONES.good : undefined)) },
    )
    const measured = plan.scenarios.filter((scenario) => scenario.id !== 'required' && scenario.meetsDeadline !== null)
    if (measured.length > 0) {
      const meeting = measured.filter((scenario) => scenario.meetsDeadline).length
      callout(
        meeting === measured.length ? 'good' : meeting === 0 ? 'danger' : 'warning',
        meeting === measured.length ? 'La entrega es robusta' : meeting === 0 ? 'Ningún escenario llega a tiempo' : 'La entrega depende del ritmo',
        meeting === measured.length
          ? `Los ${measured.length} escenarios medidos terminan dentro del plazo: aunque el ritmo varíe, la fecha se sostiene.`
          : meeting === 0
            ? 'Con los ritmos observados no se llega al plazo sin aumentar la capacidad o recortar alcance.'
            : `${meeting} de ${measured.length} escenarios terminan dentro del plazo: el resultado depende de qué ritmo sostenga el equipo.`,
        { label: 'CONCLUSIÓN' },
      )
    }
  }

  // --- 4. Flujo acumulado -------------------------------------------------------------------
  if (analysis.points.length > 0) {
    chapter('Flujo acumulado (CFD)', `Cómo entra, avanza y sale el trabajo, en ${unit.long}`)
    layout.paragraph(
      'Cada banda es el trabajo en un estado cada día: abajo lo terminado, al medio lo que está en curso y arriba lo pendiente. La distancia vertical entre bandas es la cantidad en ese estado; la horizontal, aproximadamente cuánto tarda en pasar de un estado al siguiente. Una banda «En progreso» que se ensancha indica que se empieza más de lo que se termina.',
      { size: 9.5, gap: 10 },
    )
    chartCard('Flujo acumulado', `${capitalize(unit.long)} en cada estado, día a día`, 220, (box) =>
      drawFlowChart(doc, box, { points: analysis.points, forecast, unit: unit.short, deadlineLabel: deadlineShort }),
    )
    sectionTitle('Indicadores del flujo')
    layout.table(['Indicador', 'Valor', 'Lectura'], flow.metrics.map((metric) => [metric.label, metric.value, metric.note]), { tones: flow.metrics.map((metric) => (metric.tone ? TONES[metric.tone] : undefined)) })
    sectionTitle(`Interpretación del flujo · en ${unit.long}`)
    callout(flow.tone, flow.headline, flow.summary, { label: 'DIAGNÓSTICO', large: true })
    insightList(flow.insights)
  }

  // --- 5. Recomendaciones -------------------------------------------------------------------
  const recommendations = [
    ...plan.recommendations.map((text) => ({ text, source: 'Plan' })),
    ...flow.recommendations.filter((text) => !plan.recommendations.includes(text)).map((text) => ({ text, source: 'Flujo' })),
  ]
  if (recommendations.length > 0) {
    chapter('Recomendaciones', 'Acciones sugeridas a partir de ambas vistas')
    recommendations.forEach((entry, index) => {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.5)
      const lines = doc.splitTextToSize(pdfText(entry.text), contentWidth - 90) as string[]
      const height = Math.max(36, 18 + lines.length * 13)
      ensure(height + 8)
      setFill(BRAND.soft)
      doc.roundedRect(PAGE_MARGIN, layout.y, contentWidth, height, 4, 4, 'F')
      setFill(BRAND.accent)
      doc.circle(PAGE_MARGIN + 18, layout.y + 18, 9, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(255, 255, 255)
      doc.text(String(index + 1), PAGE_MARGIN + 18, layout.y + 21, { align: 'center' })
      doc.setFontSize(6.5)
      setText(BRAND.accent)
      doc.text(entry.source.toUpperCase(), PAGE_MARGIN + contentWidth - 10, layout.y + 14, { align: 'right' })
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.5)
      setText(COLORS.text)
      doc.text(lines, PAGE_MARGIN + 38, layout.y + 21)
      layout.y += height + 8
    })
  }

  // --- 6. Trabajo pendiente -----------------------------------------------------------------
  if (input.pending.length > 0) {
    chapter('Trabajo pendiente', 'Tareas sin completar, ordenadas por esfuerzo')
    const pendingPoints = input.pending.reduce((sum, task) => sum + (task.effort ?? input.effort.fallback), 0)
    const dueSoon = input.pending.filter((task) => task.endDate && task.endDate >= forecast.today && task.endDate <= weekAhead).length
    const overdue = input.pending.filter((task) => task.endDate && task.endDate < forecast.today).length
    kpis([
      { label: 'Tareas pendientes', value: String(input.pending.length) },
      { label: 'Esfuerzo pendiente', value: input.measuredInPoints ? `${fmt(pendingPoints)} pts` : '—' },
      { label: 'Vencen en 7 días', value: String(dueSoon), tone: dueSoon > 0 ? TONES.warning : undefined },
      { label: 'Vencidas', value: String(overdue), tone: overdue > 0 ? TONES.danger : TONES.good },
    ])
    layout.y += 4
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
      { tones: sorted.map((task) => (task.endDate && task.endDate < forecast.today ? TONES.danger : task.endDate && task.endDate <= weekAhead ? TONES.warning : undefined)) },
    )
  }

  // --- Anexos -------------------------------------------------------------------------------
  chapter('Metodología', 'Cómo se calcula cada cifra de este informe', 'A')
  const method: Array<[string, string]> = [
    ['Unidad de medida', input.measuredInPoints
      ? `Puntos de esfuerzo (escala de planning poker). Cada tarea aporta sus puntos.${input.effort.total > input.effort.estimated ? ` Las ${input.effort.total - input.effort.estimated} sin estimar aportan el promedio de las estimadas (${fmt(input.effort.fallback)} pts).` : ' Todas las tareas están estimadas.'}`
      : 'Cantidad de tareas: todas pesan lo mismo.'],
    ['Velocidad', `Trabajo que pasó a «Listo» desde otro estado, menos lo reabierto, en los últimos ${THROUGHPUT_WINDOW_DAYS} días. Lo creado o importado ya terminado no cuenta. Con menos de una semana de historial se divide igualmente por 7 días.`],
    ['Fechas reales', `Se usan las fechas registradas por el equipo («Completada el» y «En esta columna desde») de ${input.confirmedCount} tarea(s) en lugar del momento en que se movió la tarjeta.`],
    ['Línea ideal', 'Baja de forma lineal desde el restante del día de inicio hasta 0 en el plazo, solo en días hábiles. No se ajusta al alcance añadido después, para que ese crecimiento se vea como desviación.'],
    ['Alcance inicial', 'Las tareas que llegaron con el tablero (creación o importación inicial) forman parte del alcance desde el inicio; solo lo agregado después cuenta como alcance añadido.'],
    ['Proyección', 'Restante ÷ velocidad diaria, contado desde hoy. Supone que el ritmo se mantiene y que no se agrega trabajo.'],
    ['Tiempo de ciclo', 'Ley de Little: trabajo en progreso ÷ velocidad. Estima el tiempo medio que tarda el trabajo en terminarse una vez empezado.'],
    ['Interpretación', 'Reglas explícitas sobre las cifras anteriores, separadas por vista (burndown y flujo acumulado), sin inteligencia artificial: cada hallazgo puede verificarse en los gráficos y tablas de este informe.'],
  ]
  for (const [label, text] of method) {
    ensure(40)
    layout.paragraph(label.toUpperCase(), { size: 7.5, bold: true, rgb: BRAND.accent, gap: 0 })
    layout.paragraph(text, { size: 9.5, gap: 7 })
  }

  const weekly = analysis.points.filter((point, index) => weekdayNumber(point.day) === 2 || index === analysis.points.length - 1)
  if (weekly.length > 0) {
    chapter('Serie semanal', `Trabajo por estado al inicio de cada semana, en ${unit.long}`, 'B')
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
          fmt(point.total - point.done),
          ideal !== null ? fmt(ideal) : '—',
        ]
      }),
    )
  }

  // --- Índice clicable y marcadores --------------------------------------------------------
  doc.setPage(tocPage)
  let tocY = PAGE_MARGIN + 10
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  setText(COLORS.text)
  doc.text('Contenido', PAGE_MARGIN, tocY + 18)
  tocY += 32
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  setText(COLORS.muted)
  doc.text(pdfText('Haz clic en un capítulo para ir a él. Los marcadores del visor de PDF también permiten navegar.'), PAGE_MARGIN, tocY + 6)
  tocY += 36
  for (const entry of chapters) {
    const annex = /^[A-Z]$/.test(entry.number)
    const label = pdfText(annex ? `Anexo ${entry.number}. ${entry.title}` : entry.title)
    setFill(annex ? BRAND.soft : BRAND.accent)
    doc.roundedRect(PAGE_MARGIN, tocY - 14, 22, 20, 4, 4, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    if (annex) setText(BRAND.accent)
    else doc.setTextColor(255, 255, 255)
    doc.text(entry.number, PAGE_MARGIN + 11, tocY, { align: 'center' })
    doc.setFontSize(11)
    setText(COLORS.text)
    doc.text(label, PAGE_MARGIN + 32, tocY)
    const labelEnd = PAGE_MARGIN + 32 + doc.getTextWidth(label) + 6
    doc.setFont('helvetica', 'normal')
    setText(COLORS.muted)
    const pageLabel = String(entry.page)
    doc.text(pageLabel, PAGE_MARGIN + contentWidth, tocY, { align: 'right' })
    setDraw(BRAND.line)
    doc.setLineWidth(0.8)
    doc.setLineDashPattern([1, 2], 0)
    doc.line(labelEnd, tocY - 1, PAGE_MARGIN + contentWidth - doc.getTextWidth(pageLabel) - 6, tocY - 1)
    doc.setLineDashPattern([], 0)
    doc.link(PAGE_MARGIN, tocY - 15, contentWidth, 22, { pageNumber: entry.page })
    doc.outline.add(null, label, { pageNumber: entry.page })
    tocY += 30
  }

  // --- Encabezado corrido y pie de página ----------------------------------------------------
  const pages = doc.getNumberOfPages()
  for (let page = 2; page <= pages; page += 1) {
    doc.setPage(page)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    setText(BRAND.accent)
    doc.text(pdfText(input.board.name.toUpperCase()), PAGE_MARGIN, PAGE_MARGIN - 18)
    const section = pageChapter.get(page)
    if (section) {
      doc.setFont('helvetica', 'normal')
      setText(COLORS.muted)
      doc.text(pdfText(section), PAGE_MARGIN + contentWidth, PAGE_MARGIN - 18, { align: 'right' })
    }
    setDraw(BRAND.line)
    doc.setLineWidth(0.6)
    doc.line(PAGE_MARGIN, PAGE_MARGIN - 12, PAGE_MARGIN + contentWidth, PAGE_MARGIN - 12)
  }
  layout.footer(`Informe de avance y proyección · ${input.board.name} · ${shortDate(forecast.today)}`, 2)
  return doc
}

/** Genera y descarga el informe (jsPDF se carga solo al descargar). */
export async function downloadFlowReport(input: Omit<FlowReportInput, 'generatedAt'>) {
  const { jsPDF } = await import('jspdf')
  const doc = buildFlowReport(jsPDF, { ...input, generatedAt: new Date() })
  doc.save(diagramFileName(`informe de avance ${input.board.name} ${todayKey()}`, 'pdf'))
}

import type { jsPDF as JsPdf } from 'jspdf'

import { projectedRemainingAt, type Burndown } from '../domain/burndown'
import type { FlowForecast, FlowPoint } from '../domain/cfd'
import { niceScale } from '../domain/chartZoom'
import { addDays, diffDays, formatDateKey, isWorkingDay, type WorkingDays } from '../domain/dates'
import { pdfText, type Rgb } from './pdfLayout'

/**
 * Gráficos del informe de avance dibujados como vectores con jsPDF: se leen
 * nítidos a cualquier zoom e impresos. Paleta clara, equivalente a la del
 * tablero (azul = restante real, gris discontinuo = ideal).
 */

export type ChartBox = { x: number; y: number; width: number; height: number }

export const CHART_COLORS = {
  actual: [59, 110, 200],
  ideal: [128, 136, 140],
  deadline: [200, 70, 95],
  today: [110, 150, 30],
  grid: [228, 231, 234],
  axis: [120, 128, 132],
  offday: [246, 247, 249],
  future: [250, 250, 252],
  scope: [196, 140, 40],
  done: [46, 140, 90],
  doneFill: [170, 216, 190],
  progress: [190, 130, 40],
  progressFill: [238, 206, 150],
  todo: [80, 120, 190],
  todoFill: [196, 212, 238],
} as const

const PAD = { left: 34, right: 10, top: 14, bottom: 22 }

const setDraw = (doc: JsPdf, rgb: Rgb) => doc.setDrawColor(rgb[0], rgb[1], rgb[2])
const setFill = (doc: JsPdf, rgb: Rgb) => doc.setFillColor(rgb[0], rgb[1], rgb[2])
const setText = (doc: JsPdf, rgb: Rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2])

/** Polilínea o polígono con coordenadas absolutas (jsPDF usa desplazamientos relativos). */
function path(doc: JsPdf, points: Array<[number, number]>, style: 'S' | 'F' | 'FD', closed = false) {
  if (points.length < 2) return
  const deltas = points.slice(1).map(([x, y], index) => [x - points[index][0], y - points[index][1]])
  doc.lines(deltas, points[0][0], points[0][1], [1, 1], style, closed)
}

/** Marcas del eje X: días, semanas, quincenas o meses según el tramo. */
function xTicks(start: string, end: string) {
  const total = diffDays(start, end)
  const ticks: string[] = []
  if (total > 120) {
    let [year, month] = start.split('-').map(Number)
    for (;;) {
      const day = `${year}-${String(month).padStart(2, '0')}-01`
      if (day > end) break
      if (day >= start) ticks.push(day)
      month += 1
      if (month > 12) { month = 1; year += 1 }
    }
    return ticks
  }
  const step = total <= 21 ? 2 : total <= 60 ? 7 : 14
  for (let pos = 0; pos <= total; pos += step) ticks.push(addDays(start, pos))
  return ticks
}

function frame(doc: JsPdf, box: ChartBox, start: string, end: string, scale: ReturnType<typeof niceScale>, unit: string) {
  const inner = { x: box.x + PAD.left, y: box.y + PAD.top, width: box.width - PAD.left - PAD.right, height: box.height - PAD.top - PAD.bottom }
  const total = Math.max(1, diffDays(start, end))
  const x = (day: string) => inner.x + (diffDays(start, day) / total) * inner.width
  const y = (value: number) => inner.y + inner.height - ((value - scale.min) / (scale.max - scale.min)) * inner.height

  doc.setLineWidth(0.4)
  setDraw(doc, CHART_COLORS.grid)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  setText(doc, CHART_COLORS.axis)
  for (const tick of scale.ticks) {
    doc.line(inner.x, y(tick), inner.x + inner.width, y(tick))
    doc.text(String(tick), inner.x - 4, y(tick) + 2, { align: 'right' })
  }
  for (const day of xTicks(start, end)) {
    doc.text(pdfText(formatDateKey(day, { day: 'numeric', month: 'short' })), x(day), inner.y + inner.height + 10, { align: 'center' })
  }
  doc.text(pdfText(unit), box.x, box.y + 6)
  setDraw(doc, CHART_COLORS.axis)
  doc.setLineWidth(0.6)
  doc.line(inner.x, inner.y + inner.height, inner.x + inner.width, inner.y + inner.height)
  return { inner, x, y }
}

function verticalMarker(doc: JsPdf, xPos: number, inner: ChartBox, rgb: Rgb, label: string, align: 'left' | 'right', top = true) {
  setDraw(doc, rgb)
  doc.setLineWidth(1)
  doc.line(xPos, inner.y, xPos, inner.y + inner.height)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  setText(doc, rgb)
  doc.text(pdfText(label), xPos + (align === 'left' ? 3 : -3), top ? inner.y + 7 : inner.y + inner.height - 4, { align })
}

/** Leyenda horizontal bajo el gráfico: devuelve la altura usada. */
export function legend(doc: JsPdf, x: number, y: number, items: Array<{ label: string; rgb: Rgb; kind: 'line' | 'dash' | 'box' }>) {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  let cursor = x
  for (const entry of items) {
    if (entry.kind === 'box') {
      setFill(doc, entry.rgb)
      doc.rect(cursor, y - 5, 8, 6, 'F')
    } else {
      setDraw(doc, entry.rgb)
      doc.setLineWidth(1.4)
      if (entry.kind === 'dash') doc.setLineDashPattern([2.5, 2], 0)
      doc.line(cursor, y - 2, cursor + 12, y - 2)
      doc.setLineDashPattern([], 0)
    }
    setText(doc, [70, 76, 80])
    const text = pdfText(entry.label)
    doc.text(text, cursor + 15, y)
    cursor += 15 + doc.getTextWidth(text) + 14
  }
  return 12
}

function chartEnd(today: string, deadline: string | null, projectedFinish: string | null) {
  const candidates = [addDays(today, 7)]
  if (deadline) candidates.push(addDays(deadline, 2))
  if (projectedFinish) candidates.push(addDays(projectedFinish, 2))
  const latest = candidates.reduce((max, day) => (day > max ? day : max))
  const limit = addDays(today, 365)
  return latest > limit ? limit : latest
}

export function drawBurndownChart(
  doc: JsPdf,
  box: ChartBox,
  options: { burndown: Burndown; forecast: FlowForecast; unit: string; workingDays: WorkingDays; deadlineLabel: string },
) {
  const { burndown, forecast, unit, workingDays, deadlineLabel } = options
  const { start, points, idealAt, deadline, baseline } = burndown
  const { today, projectedFinish } = forecast
  const end = chartEnd(today, deadline, projectedFinish)
  const scale = niceScale(0, Math.max(baseline, ...points.map((point) => point.remaining), 1))
  const { inner, x, y } = frame(doc, box, start, end, scale, `Restante (${unit})`)
  const remainingToday = points.at(-1)?.remaining ?? 0

  // Futuro y días no hábiles (si se distinguen).
  setFill(doc, CHART_COLORS.future)
  doc.rect(x(today), inner.y, x(end) - x(today), inner.height, 'F')
  const daySpacing = inner.width / Math.max(1, diffDays(start, end))
  if (workingDays.length < 7 && daySpacing >= 2.5) {
    setFill(doc, CHART_COLORS.offday)
    for (let day = start; day <= end; day = addDays(day, 1)) {
      if (!isWorkingDay(day, workingDays)) doc.rect(x(day) - daySpacing / 2, inner.y, daySpacing, inner.height, 'F')
    }
  }

  if (deadline) {
    const ideal: Array<[number, number]> = []
    const idealEnd = deadline < end ? deadline : end
    for (let day = start; day <= idealEnd; day = addDays(day, 1)) ideal.push([x(day), y(idealAt(day) ?? 0)])
    setDraw(doc, CHART_COLORS.ideal)
    doc.setLineWidth(1)
    doc.setLineDashPattern([3, 2.5], 0)
    path(doc, ideal, 'S')
    doc.setLineDashPattern([], 0)
  }

  setDraw(doc, CHART_COLORS.actual)
  doc.setLineWidth(1.6)
  doc.setLineJoin('round')
  path(doc, points.map((point) => [x(point.day), y(point.remaining)]), 'S')

  if (projectedFinish && remainingToday > 0) {
    const finish = projectedFinish <= end ? projectedFinish : end
    doc.setLineWidth(1.2)
    doc.setLineDashPattern([2, 2], 0)
    doc.line(x(today), y(remainingToday), x(finish), y(projectedRemainingAt(finish, today, remainingToday, projectedFinish) ?? 0))
    doc.setLineDashPattern([], 0)
    if (projectedFinish <= end) {
      setFill(doc, [255, 255, 255])
      doc.circle(x(projectedFinish), y(0), 2.6, 'FD')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      setText(doc, CHART_COLORS.actual)
      const label = pdfText(`Proyección · ${formatDateKey(projectedFinish, { day: 'numeric', month: 'short' })}`)
      // Cerca del borde derecho la etiqueta pasa al lado izquierdo del punto.
      const fitsRight = x(projectedFinish) + 4 + doc.getTextWidth(label) <= inner.x + inner.width - 4
      doc.text(label, x(projectedFinish) + (fitsRight ? 4 : -4), y(0) - 5, { align: fitsRight ? 'left' : 'right' })
    }
  }

  // Alcance añadido.
  setFill(doc, CHART_COLORS.scope)
  for (const point of points.filter((item) => item.scopeChange > 0)) {
    const px = x(point.day)
    const py = y(point.remaining) - 4
    path(doc, [[px, py - 4], [px + 2.6, py], [px - 2.6, py]], 'F', true)
  }

  if (deadline && deadline <= end) verticalMarker(doc, x(deadline), inner, CHART_COLORS.deadline, `${deadlineLabel} · ${formatDateKey(deadline, { day: 'numeric', month: 'short' })}`, 'right')
  verticalMarker(doc, x(today), inner, CHART_COLORS.today, 'Hoy', 'left', false)

  // Etiquetas directas en «Hoy».
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  setText(doc, CHART_COLORS.actual)
  const actualY = y(remainingToday)
  const idealToday = idealAt(today)
  const idealY = idealToday !== null ? y(idealToday) : null
  const collide = idealY !== null && Math.abs(idealY - actualY) < 9
  doc.text(pdfText(`Real · ${formatNumber(remainingToday)}`), x(today) + 4, actualY - (collide ? 4 : 2))
  if (idealToday !== null && idealY !== null) {
    setText(doc, CHART_COLORS.ideal)
    doc.text(pdfText(`Ideal · ${formatNumber(idealToday)}`), x(today) + 4, idealY + (collide ? 9 : 7))
  }

  return legend(doc, box.x + PAD.left, box.y + box.height + 12, [
    { label: 'Restante real', rgb: CHART_COLORS.actual, kind: 'line' },
    { label: 'Línea ideal', rgb: CHART_COLORS.ideal, kind: 'dash' },
    { label: 'Proyección', rgb: CHART_COLORS.actual, kind: 'dash' },
    { label: deadlineLabel, rgb: CHART_COLORS.deadline, kind: 'line' },
    { label: 'Hoy', rgb: CHART_COLORS.today, kind: 'line' },
  ])
}

export function drawFlowChart(
  doc: JsPdf,
  box: ChartBox,
  options: { points: FlowPoint[]; forecast: FlowForecast; unit: string; deadlineLabel: string },
) {
  const { points, forecast, unit, deadlineLabel } = options
  const { today, projectedFinish, deadline, current } = forecast
  const start = points[0].day
  const end = chartEnd(today, deadline, projectedFinish)
  const scale = niceScale(0, Math.max(...points.map((point) => point.total), current.total, 1))
  const { inner, x, y } = frame(doc, box, start, end, scale, `Trabajo (${unit})`)

  setFill(doc, CHART_COLORS.future)
  doc.rect(x(today), inner.y, x(end) - x(today), inner.height, 'F')

  const band = (upper: (point: FlowPoint) => number, lower: (point: FlowPoint) => number, fill: Rgb, line: Rgb) => {
    const top = points.map((point): [number, number] => [x(point.day), y(upper(point))])
    const bottom = points.map((point): [number, number] => [x(point.day), y(lower(point))]).reverse()
    setFill(doc, fill)
    path(doc, [...top, ...bottom], 'F', true)
    setDraw(doc, line)
    doc.setLineWidth(0.7)
    path(doc, top, 'S')
  }
  band((point) => point.total, (point) => point.done + point.in_progress, CHART_COLORS.todoFill, CHART_COLORS.todo)
  band((point) => point.done + point.in_progress, (point) => point.done, CHART_COLORS.progressFill, CHART_COLORS.progress)
  band((point) => point.done, () => 0, CHART_COLORS.doneFill, CHART_COLORS.done)

  // Alcance actual y proyección de lo completado.
  setDraw(doc, CHART_COLORS.axis)
  doc.setLineWidth(0.5)
  doc.line(x(today), y(current.total), x(end), y(current.total))
  if (projectedFinish && current.done < current.total) {
    const finish = projectedFinish <= end ? projectedFinish : end
    const span = Math.max(1, diffDays(today, projectedFinish))
    const value = current.done + (current.total - current.done) * Math.min(1, diffDays(today, finish) / span)
    setDraw(doc, [60, 66, 70])
    doc.setLineWidth(1.2)
    doc.setLineDashPattern([3, 2.5], 0)
    doc.line(x(today), y(current.done), x(finish), y(value))
    doc.setLineDashPattern([], 0)
  }

  if (deadline && deadline >= start && deadline <= end) verticalMarker(doc, x(deadline), inner, CHART_COLORS.deadline, `${deadlineLabel} · ${formatDateKey(deadline, { day: 'numeric', month: 'short' })}`, 'right')
  verticalMarker(doc, x(today), inner, CHART_COLORS.today, 'Hoy', 'left', false)

  return legend(doc, box.x + PAD.left, box.y + box.height + 12, [
    { label: 'Por hacer', rgb: CHART_COLORS.todoFill, kind: 'box' },
    { label: 'En progreso', rgb: CHART_COLORS.progressFill, kind: 'box' },
    { label: 'Listo', rgb: CHART_COLORS.doneFill, kind: 'box' },
    { label: 'Proyección de lo completado', rgb: [60, 66, 70], kind: 'dash' },
    { label: deadlineLabel, rgb: CHART_COLORS.deadline, kind: 'line' },
  ])
}

const numberFormat = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 })
function formatNumber(value: number) {
  return numberFormat.format(value)
}

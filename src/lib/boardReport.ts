import type { jsPDF as JsPdf } from 'jspdf'

import { COLUMN_STATUSES, columnStatusLabels, columnStatusProgress, resolveColumnStatus, type ColumnStatus } from '../domain/columnStatus'
import { formatDateKey, todayKey } from '../domain/dates'
import { deadlineStatus } from '../domain/deadlines'
import { descriptionSummary } from '../domain/description'
import { formatEffort } from '../domain/effort'
import { activityNumbers } from '../domain/numbering'
import { priorityLabels } from '../domain/priority'
import { computeSchedule } from '../domain/schedule'
import { boardSchedule, describeWorkingDays } from '../domain/workSchedule'
import { projectDeadline, type Board } from '../services/boards'
import type { BoardColumn } from '../services/columns'
import type { Task, TaskPriority } from '../services/tasks'
import { COLORS, PAGE_MARGIN, createPdfLayout, reportDate, type Rgb } from './pdfLayout'

/**
 * Informe PDF de un tablero: avance, cifras clave, carga por responsable y el
 * detalle de las tareas de cada columna. Va en hojas apaisadas para que la
 * tabla de tareas quepa sin apretar.
 */

export type BoardReportInput = {
  board: Board
  columns: BoardColumn[]
  tasksByColumn: Record<string, Task[]>
  /** Nombres de responsables por tarea. */
  assigneeNames: Record<string, string[]>
  generatedAt: Date
  /** Fecha de referencia para atrasos y vencimientos (hoy por defecto). */
  today?: string
}

const STATUS_COLORS: Record<ColumnStatus, Rgb> = { todo: COLORS.blue, in_progress: COLORS.info, done: COLORS.ok }
const PRIORITY_COLORS: Record<TaskPriority, Rgb> = { high: COLORS.warning, medium: COLORS.info, low: COLORS.ok }
const PRIORITY_ORDER: TaskPriority[] = ['high', 'medium', 'low']
const shortDate = (value: string | null) => (value ? formatDateKey(value) : '—')

export function buildBoardReport(JsPDF: typeof JsPdf, input: BoardReportInput): JsPdf {
  const { board, columns, tasksByColumn, assigneeNames } = input
  const today = input.today ?? todayKey()
  const layout = createPdfLayout(new JsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' }), { orientation: 'landscape' })
  const { doc } = layout

  const entries = columns.flatMap((column) => {
    const status = resolveColumnStatus(column)
    return (tasksByColumn[column.id] ?? []).map((task) => ({ task, column, status }))
  })
  const numbers = activityNumbers(columns, tasksByColumn)
  const schedule = computeSchedule(entries.map(({ task }) => task), boardSchedule(board).working_days)

  const byStatus = Object.fromEntries(COLUMN_STATUSES.map((status) => [status, 0])) as Record<ColumnStatus, number>
  const pendingByPriority: Record<TaskPriority, number> = { high: 0, medium: 0, low: 0 }
  let progressSum = 0
  let overdue = 0
  let dueSoon = 0
  let latestEnd: string | null = null
  for (const { task, status } of entries) {
    byStatus[status] += 1
    progressSum += columnStatusProgress[status]
    if (task.end_date && (!latestEnd || task.end_date > latestEnd)) latestEnd = task.end_date
    if (status === 'done') continue
    pendingByPriority[task.priority] += 1
    const deadline = deadlineStatus(task, status, today)
    if (deadline.overdueDays !== null) overdue += 1
    else if (deadline.dueInDays !== null) dueSoon += 1
  }
  const total = entries.length
  const percent = total ? Math.round(progressSum / total) : 0
  const critical = [...schedule.tasks.values()].filter((info) => info.critical).length
  const plannedEnd = projectDeadline(board, latestEnd)

  // Encabezado
  layout.paragraph('INFORME DEL TABLERO', { size: 8, bold: true, rgb: COLORS.muted, gap: 0 })
  layout.paragraph(board.name, { size: 20, bold: true, gap: 0 })
  layout.paragraph(`Generado el ${reportDate.format(input.generatedAt)} · Jornada: ${describeWorkingDays(boardSchedule(board).working_days)}`, { size: 9, rgb: COLORS.muted, gap: 6 })
  if (board.description) layout.paragraph(board.description, { size: 10, gap: 6 })

  // Avance
  layout.heading('Avance del proyecto')
  layout.paragraph(`${percent}% estimado por estado de columnas`, { size: 12, bold: true, gap: 6 })
  if (total) {
    const barHeight = 9
    layout.ensure(barHeight + 30)
    let x = PAGE_MARGIN
    for (const status of COLUMN_STATUSES) {
      const width = (byStatus[status] / total) * layout.contentWidth
      if (!width) continue
      const rgb = STATUS_COLORS[status]
      doc.setFillColor(rgb[0], rgb[1], rgb[2])
      doc.rect(x, layout.y, width, barHeight, 'F')
      x += width
    }
    layout.y += barHeight + 8
    // Leyenda en una sola línea.
    let legendX = PAGE_MARGIN
    doc.setFontSize(8.5)
    for (const status of COLUMN_STATUSES) {
      const rgb = STATUS_COLORS[status]
      const label = `${columnStatusLabels[status]} ${byStatus[status]}`
      doc.setFillColor(rgb[0], rgb[1], rgb[2])
      doc.rect(legendX, layout.y + 2, 7, 7, 'F')
      doc.setFont('helvetica', 'normal')
      layout.color(COLORS.text)
      doc.text(label, legendX + 11, layout.y + 8.5)
      legendX += 11 + doc.getTextWidth(label) + 18
    }
    layout.y += 22
  }

  layout.facts([
    { label: 'Tareas', value: String(total) },
    { label: 'Atrasadas', value: String(overdue), tone: overdue ? COLORS.warning : undefined },
    { label: 'Vencen en 7 días', value: String(dueSoon), tone: dueSoon ? COLORS.info : undefined },
    { label: 'En ruta crítica', value: String(critical) },
    { label: 'Fin planificado', value: plannedEnd ? formatDateKey(plannedEnd) : 'Sin fecha' },
  ], 5)

  layout.subheading('Pendientes por prioridad')
  layout.paragraph(PRIORITY_ORDER.map((priority) => `${priorityLabels[priority]}: ${pendingByPriority[priority]}`).join('   ·   '), { gap: 6 })

  // Carga por responsable
  const workload = new Map<string, { pending: number; done: number }>()
  let unassignedPending = 0
  for (const { task, status } of entries) {
    const names = assigneeNames[task.id] ?? []
    if (!names.length && status !== 'done') unassignedPending += 1
    for (const name of names) {
      const load = workload.get(name) ?? { pending: 0, done: 0 }
      if (status === 'done') load.done += 1
      else load.pending += 1
      workload.set(name, load)
    }
  }
  if (workload.size || unassignedPending) {
    layout.heading('Carga por responsable')
    const rows = [...workload.entries()].sort(([, left], [, right]) => right.pending - left.pending || right.done - left.done)
    layout.table(
      ['Responsable', 'Pendientes', 'Completadas', 'Total'],
      [
        ...rows.map(([name, load]) => [name, String(load.pending), String(load.done), String(load.pending + load.done)]),
        ...(unassignedPending ? [['Sin responsable', String(unassignedPending), '—', String(unassignedPending)]] : []),
      ],
    )
  }

  // Tareas por columna
  layout.heading('Tareas por columna')
  if (!columns.length) layout.paragraph('El tablero no tiene columnas.', { italic: true, rgb: COLORS.muted })
  for (const column of columns) {
    const status = resolveColumnStatus(column)
    const tasks = tasksByColumn[column.id] ?? []
    layout.subheading(`${column.name} · ${columnStatusLabels[status]} (${tasks.length})`, STATUS_COLORS[status])
    if (!tasks.length) {
      layout.paragraph('Sin tareas.', { italic: true, rgb: COLORS.muted, gap: 6 })
      continue
    }
    layout.table(
      ['N°', 'Tarea', 'Prioridad', 'Esfuerzo', 'Responsables', 'Inicio', 'Fin', 'Plazo'],
      tasks.map((task) => {
        const summary = task.description ? descriptionSummary(task.description, 140) : ''
        return [
          String(numbers.get(task.id) ?? ''),
          summary ? `${task.title}\n${summary}` : task.title,
          priorityLabels[task.priority],
          task.effort === null || task.effort === undefined ? '—' : formatEffort(Number(task.effort)),
          (assigneeNames[task.id] ?? []).join(', ') || '—',
          shortDate(task.start_date),
          shortDate(task.end_date),
          deadlineText(task, status, today, schedule.tasks.get(task.id)?.critical ?? false),
        ]
      }),
      { tones: tasks.map((task) => PRIORITY_COLORS[task.priority]) },
    )
  }

  layout.footer(`Gesti - Workspace · ${board.name}`)
  return doc
}

function deadlineText(task: Task, status: ColumnStatus, today: string, critical: boolean) {
  const parts: string[] = []
  if (status === 'done') parts.push(task.completed_at ? `Completada ${formatDateKey(task.completed_at)}` : 'Completada')
  else {
    const deadline = deadlineStatus(task, status, today)
    if (deadline.overdueDays !== null) parts.push(`Atrasada ${deadline.overdueDays} d`)
    else if (deadline.dueInDays !== null) parts.push(deadline.dueInDays === 0 ? 'Vence hoy' : `Vence en ${deadline.dueInDays} d`)
  }
  if (critical) parts.push('Ruta crítica')
  return parts.join('\n') || '—'
}

/** Genera y descarga el informe en PDF. jsPDF se carga solo al usarlo. */
export async function downloadBoardReport(input: Omit<BoardReportInput, 'generatedAt'>, fileName: string) {
  const { jsPDF } = await import('jspdf')
  buildBoardReport(jsPDF, { ...input, generatedAt: new Date() }).save(fileName)
}

import { COLUMN_STATUSES, columnStatusProgress, type ColumnStatus } from './columnStatus'
import { deadlineStatus } from './deadlines'

/** Fila agregada: cuántas tareas de un tablero tienen un estado y una fecha de fin. */
export type SummaryRow = {
  board_id: string
  status: ColumnStatus
  end_date: string | null
  task_count: number
}

export type BoardSummary = {
  total: number
  byStatus: Record<ColumnStatus, number>
  /** Avance estimado por estado de columnas (misma regla que el dashboard del tablero). */
  percent: number
  overdue: number
  dueSoon: number
  /** Fin planificado: la fecha de fin más tardía (como el Gantt). */
  plannedEnd: string | null
}

export function emptySummary(): BoardSummary {
  return {
    total: 0,
    byStatus: Object.fromEntries(COLUMN_STATUSES.map((status) => [status, 0])) as Record<ColumnStatus, number>,
    percent: 0,
    overdue: 0,
    dueSoon: 0,
    plannedEnd: null,
  }
}

/** Resúmenes por tablero a partir de las filas agregadas del servidor. */
export function summarizeBoards(rows: SummaryRow[], today: string): Record<string, BoardSummary> {
  const summaries: Record<string, BoardSummary> = {}
  const progressSum: Record<string, number> = {}

  for (const row of rows) {
    const status = COLUMN_STATUSES.includes(row.status) ? row.status : 'todo'
    const summary = (summaries[row.board_id] ??= emptySummary())
    summary.total += row.task_count
    summary.byStatus[status] += row.task_count
    progressSum[row.board_id] = (progressSum[row.board_id] ?? 0) + columnStatusProgress[status] * row.task_count

    const deadline = deadlineStatus({ end_date: row.end_date }, status, today)
    if (deadline.overdueDays !== null) summary.overdue += row.task_count
    else if (deadline.dueInDays !== null) summary.dueSoon += row.task_count

    if (row.end_date && (!summary.plannedEnd || row.end_date > summary.plannedEnd)) summary.plannedEnd = row.end_date
  }

  for (const [boardId, summary] of Object.entries(summaries)) {
    summary.percent = summary.total ? Math.round(progressSum[boardId] / summary.total) : 0
  }
  return summaries
}

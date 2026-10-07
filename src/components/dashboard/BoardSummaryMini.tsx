import { COLUMN_STATUSES, columnStatusLabels } from '../../domain/columnStatus'
import { formatDateKey } from '../../domain/dates'
import type { BoardHighlight } from '../../domain/deadlines'
import { progressMilestone } from '../../domain/roles'
import type { BoardSummary } from '../../domain/boardSummary'

interface BoardSummaryMiniProps {
  summary: BoardSummary | undefined
  /** Abre el tablero con un resaltado activo (atrasadas o vencen pronto). */
  onOpenHighlight: (mode: BoardHighlight) => void
}

/** Miniatura del resumen ejecutivo de un tablero, para la lista «Mis tableros». */
function BoardSummaryMini({ summary, onOpenHighlight }: BoardSummaryMiniProps) {
  if (!summary || summary.total === 0) {
    return <p className="board-summary board-summary-empty">Sin tareas todavía.</p>
  }

  const milestone = progressMilestone(summary.percent)

  return (
    <div className="board-summary">
      <div className="flex items-baseline justify-between gap-2">
        <p className="flex items-baseline gap-1.5">
          <span className="text-xl font-bold text-white">{summary.percent}%</span>
          <span className="text-[11px] text-[var(--text-muted)]">avance</span>
        </p>
        <span className="text-[11px] text-[var(--text-muted)]" title={milestone.label}>
          <span aria-hidden="true">{milestone.emote}</span> {milestone.label}
        </span>
      </div>

      <div
        className="status-bar status-bar-mini mt-1.5"
        role="img"
        aria-label={COLUMN_STATUSES.map((status) => `${columnStatusLabels[status]}: ${summary.byStatus[status]}`).join(', ')}
      >
        {COLUMN_STATUSES.filter((status) => summary.byStatus[status] > 0).map((status) => (
          <span
            key={status}
            className={`status-bar-segment status-fill-${status}`}
            style={{ flexGrow: summary.byStatus[status] }}
            title={`${columnStatusLabels[status]}: ${summary.byStatus[status]}`}
          />
        ))}
      </div>

      <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
        {summary.total} tarea{summary.total === 1 ? '' : 's'} · {summary.byStatus.done} completada{summary.byStatus.done === 1 ? '' : 's'}
        {summary.plannedEnd && ` · Fin ${formatDateKey(summary.plannedEnd, { day: 'numeric', month: 'short' })}`}
      </p>

      {(summary.overdue > 0 || summary.dueSoon > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          {summary.overdue > 0 && (
            <button type="button" onClick={() => onOpenHighlight('overdue')} className="overdue-chip board-summary-chip" title="Abrir el tablero resaltando las tareas atrasadas">
              ⚠ {summary.overdue} atrasada{summary.overdue === 1 ? '' : 's'}
            </button>
          )}
          {summary.dueSoon > 0 && (
            <button type="button" onClick={() => onOpenHighlight('dueSoon')} className="due-soon-chip board-summary-chip" title="Abrir el tablero resaltando las tareas que vencen pronto">
              ⏳ {summary.dueSoon} vence{summary.dueSoon === 1 ? '' : 'n'} pronto
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default BoardSummaryMini

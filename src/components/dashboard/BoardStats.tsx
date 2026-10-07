import { useMemo } from 'react'

import {
  COLUMN_STATUSES,
  columnStatusLabels,
  columnStatusProgress,
  resolveColumnStatus,
  type ColumnStatus,
} from '../../domain/columnStatus'
import { addDays, todayKey } from '../../domain/dates'
import type { BoardPerson } from '../../domain/people'
import { progressMilestone, roleEmotes } from '../../domain/roles'
import type { ProjectSchedule } from '../../domain/schedule'
import type { BoardColumn } from '../../services/columns'
import type { Task, TaskPriority } from '../../services/tasks'

interface BoardStatsProps {
  columns: BoardColumn[]
  tasksByColumn: Record<string, Task[]>
  schedule: ProjectSchedule
  assignments: Record<string, string[]>
  people: BoardPerson[]
  currentUserId: string | undefined
  commentStats: Record<string, { total: number; alerts: number }>
  /** Modo «Atrasadas» activo en el tablero. */
  overdueActive: boolean
  onToggleOverdue: () => void
}

const statusIcons: Record<ColumnStatus, string> = { todo: '○', in_progress: '◐', done: '●' }
const priorityOrder: TaskPriority[] = ['high', 'medium', 'low']
const priorityText: Record<TaskPriority, string> = { high: 'Alta', medium: 'Media', low: 'Baja' }

function BoardStats({ columns, tasksByColumn, schedule, assignments, people, currentUserId, commentStats, overdueActive, onToggleOverdue }: BoardStatsProps) {
  const stats = useMemo(() => {
    const today = todayKey()
    const nextWeek = addDays(today, 7)
    const entries = columns.flatMap((column) =>
      (tasksByColumn[column.id] ?? []).map((task) => ({ task, status: resolveColumnStatus(column) })),
    )
    const byStatus = Object.fromEntries(COLUMN_STATUSES.map((status) => [status, 0])) as Record<ColumnStatus, number>
    const pendingByPriority: Record<TaskPriority, number> = { high: 0, medium: 0, low: 0 }
    let overdue = 0
    let dueSoon = 0
    let progressSum = 0

    entries.forEach(({ task, status }) => {
      byStatus[status] += 1
      progressSum += columnStatusProgress[status]
      if (status === 'done') return
      pendingByPriority[task.priority] += 1
      if (task.end_date && task.end_date < today) overdue += 1
      else if (task.end_date && task.end_date <= nextWeek) dueSoon += 1
    })

    const total = entries.length
    let critical = 0
    let overlaps = 0
    schedule.tasks.forEach((info) => {
      if (info.critical) critical += 1
      if (info.startsBeforePredecessor) overlaps += 1
    })

    return {
      total,
      byStatus,
      pendingByPriority,
      overdue,
      dueSoon,
      critical,
      overlaps,
      cycles: schedule.cyclicTaskIds.size,
      percent: total ? Math.round(progressSum / total) : 0,
      undated: entries.filter(({ task }) => !task.start_date || !task.end_date).length,
      unassignedPending: entries.filter(({ task, status }) => status !== 'done' && !(assignments[task.id]?.length)).length,
      withAlerts: entries.filter(({ task }) => (commentStats[task.id]?.alerts ?? 0) > 0).length,
      // Carga por persona: tareas pendientes y completadas asignadas a cada una.
      workload: people
        .map((person) => {
          const assigned = entries.filter(({ task }) => assignments[task.id]?.includes(person.userId))
          return {
            person,
            pending: assigned.filter(({ status }) => status !== 'done').length,
            done: assigned.filter(({ status }) => status === 'done').length,
          }
        })
        .filter((item) => item.pending + item.done > 0)
        .sort((left, right) => right.pending - left.pending || right.done - left.done),
    }
  }, [assignments, columns, commentStats, people, tasksByColumn, schedule])

  if (stats.total === 0) {
    return (
      <section className="stats-panel" aria-label="Estadísticas del tablero">
        <p className="text-sm text-[var(--text-muted)]">Añade tareas para ver el avance del proyecto.</p>
      </section>
    )
  }

  const milestone = progressMilestone(stats.percent)

  return (
    <section className="stats-panel" aria-labelledby="board-stats-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="board-stats-title" className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Avance del proyecto
          </h3>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white">{stats.percent}%</span>
            <span className="text-sm text-[var(--text-muted)]">estimado por estado de columnas</span>
          </p>
        </div>
        <span className="milestone-badge" title="Hito de avance del tablero">
          <span aria-hidden="true">{milestone.emote}</span> {milestone.label}
        </span>
      </div>

      {/* Barra apilada: cada segmento lleva su etiqueta en la leyenda (no solo color). */}
      <div
        className="status-bar mt-3"
        role="img"
        aria-label={COLUMN_STATUSES.map((status) => `${columnStatusLabels[status]}: ${stats.byStatus[status]}`).join(', ')}
      >
        {COLUMN_STATUSES.filter((status) => stats.byStatus[status] > 0).map((status) => (
          <span
            key={status}
            className={`status-bar-segment status-fill-${status}`}
            style={{ flexGrow: stats.byStatus[status] }}
            title={`${columnStatusLabels[status]}: ${stats.byStatus[status]} de ${stats.total}`}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
        {COLUMN_STATUSES.map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span className={`status-dot status-fill-${status}`} aria-hidden="true" />
            <span aria-hidden="true">{statusIcons[status]}</span>
            {columnStatusLabels[status]} <strong className="text-[var(--text-main)]">{stats.byStatus[status]}</strong>
          </li>
        ))}
      </ul>

      <div className="stat-tiles mt-4">
        <div className="stat-tile">
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">Tareas</span>
        </div>
        {/* Pulsable: resalta en el tablero las tareas atrasadas. */}
        <button
          type="button"
          onClick={onToggleOverdue}
          disabled={stats.overdue === 0 && !overdueActive}
          aria-pressed={overdueActive}
          className={`stat-tile stat-tile-button ${stats.overdue > 0 ? 'stat-tile-alert' : ''} ${overdueActive ? 'stat-tile-active' : ''}`}
          title={stats.overdue > 0 ? 'Resaltar las tareas atrasadas en el tablero' : 'No hay tareas atrasadas'}
        >
          <span className="stat-value">{stats.overdue}</span>
          <span className="stat-label">
            {stats.overdue > 0 ? '⚠ ' : ''}Atrasadas{stats.overdue > 0 && (overdueActive ? ' · ocultar' : ' · ver')}
          </span>
        </button>
        <div className="stat-tile">
          <span className="stat-value">{stats.dueSoon}</span>
          <span className="stat-label">Vencen en 7 días</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{stats.critical}</span>
          <span className="stat-label">◆ En ruta crítica</span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Pendientes por prioridad</h4>
          <ul className="mt-2 flex flex-wrap gap-2">
            {priorityOrder.map((priority) => (
              <li key={priority} className={`priority-${priority} rounded-full px-3 py-1 text-xs`}>
                {priorityText[priority]} · <strong>{stats.pendingByPriority[priority]}</strong>
              </li>
            ))}
          </ul>
        </div>
        {(stats.overlaps > 0 || stats.cycles > 0 || stats.undated > 0 || stats.unassignedPending > 0 || stats.withAlerts > 0) && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Revisar planificación</h4>
            <ul className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
              {stats.overlaps > 0 && <li>⚠ {stats.overlaps} tarea(s) empiezan antes de que termine su predecesora.</li>}
              {stats.cycles > 0 && <li>⚠ {stats.cycles} tarea(s) forman un ciclo de dependencias.</li>}
              {stats.undated > 0 && <li>○ {stats.undated} tarea(s) sin fechas no aparecen en el Gantt.</li>}
              {stats.withAlerts > 0 && <li>⚠ {stats.withAlerts} tarea(s) con problemas o parches temporales reportados.</li>}
              {stats.unassignedPending > 0 && <li>○ {stats.unassignedPending} tarea(s) pendientes sin responsable.</li>}
            </ul>
          </div>
        )}
      </div>

      {stats.workload.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Carga por responsable</h4>
          <ul className="workload-list mt-2">
            {stats.workload.map(({ person, pending, done }) => (
              <li key={person.userId} className="workload-item">
                <span className="min-w-0 truncate">
                  <span aria-hidden="true">{roleEmotes[person.role]} </span>
                  {person.name}
                  {person.userId === currentUserId && <span className="text-[var(--text-muted)]"> (tú)</span>}
                </span>
                <span className="shrink-0 text-xs text-[var(--text-muted)]">
                  <strong className="text-[var(--text-main)]">{pending}</strong> pendiente{pending === 1 ? '' : 's'} · {done} completada{done === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export default BoardStats

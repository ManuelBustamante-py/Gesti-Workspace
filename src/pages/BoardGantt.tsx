import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'
import { useBoardData } from '../hooks/useBoardData'
import { columnStatusLabels, columnStatusProgress, resolveColumnStatus } from '../domain/columnStatus'
import { addDays, diffDays, formatDateKey, startOfWeek, todayKey } from '../domain/dates'
import { activityNumbers } from '../domain/numbering'
import { assigneeNames, buildBoardPeople } from '../domain/people'
import { computeSchedule } from '../domain/schedule'
import { boardSchedule, describeWorkingDays } from '../domain/workSchedule'
import { getBoard, type Board } from '../services/boards'
import { exportBoardGanttWorkbook } from '../services/boardWorkbook'
import { getProfile, type Profile } from '../services/profiles'

const WEEK_WIDTH = 126
const DAY_WIDTH = WEEK_WIDTH / 7
const ROW_HEIGHT = 76
const BAR_HEIGHT = 26

function useIsNarrow() {
  const query = '(max-width: 767px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setNarrow(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return narrow
}

/** Fondo semanal (lunes a domingo) con los días no laborables sombreados. */
function nonWorkingBackground(workingDays: number[]) {
  // Orden lunes..domingo en la convención 1 = domingo.
  const weekOrder = [2, 3, 4, 5, 6, 7, 1]
  const stops = weekOrder.flatMap((day, index) => {
    const color = workingDays.includes(day) ? 'transparent' : 'rgba(255,255,255,0.045)'
    return [`${color} ${index * DAY_WIDTH}px`, `${color} ${(index + 1) * DAY_WIDTH}px`]
  })
  return `linear-gradient(to right, ${stops.join(', ')})`
}

function BoardGantt() {
  const { boardId } = useParams<{ boardId: string }>()
  const { user } = useAuth()
  const narrow = useIsNarrow()
  const [board, setBoard] = useState<Board | null>(null)
  const [boardError, setBoardError] = useState('')
  const [loadingBoard, setLoadingBoard] = useState(true)
  const [exportError, setExportError] = useState('')
  const [ownerProfile, setOwnerProfile] = useState<Profile | null>(null)

  useEffect(() => {
    if (!boardId || !user) return
    let cancelled = false
    getBoard(boardId)
      .then((result) => {
        if (cancelled) return
        if (!result) setBoardError('No se encontró el tablero o no tienes acceso.')
        setBoard(result)
      })
      .catch((err) => !cancelled && setBoardError(err instanceof Error ? err.message : 'No se pudo cargar el tablero.'))
      .finally(() => !cancelled && setLoadingBoard(false))
    return () => {
      cancelled = true
    }
  }, [boardId, user])

  const { columns, tasksByColumn, members, assignments, loading, error } = useBoardData(board?.id ?? null, Boolean(board))

  useEffect(() => {
    if (!board) return
    let cancelled = false
    getProfile(board.owner_id)
      .then((profile) => !cancelled && setOwnerProfile(profile))
      .catch(() => !cancelled && setOwnerProfile(null))
    return () => {
      cancelled = true
    }
  }, [board])

  const namesByTask = useMemo(() => {
    if (!board) return {}
    const people = buildBoardPeople(board.owner_id, ownerProfile, 'Propietario', members)
    return Object.fromEntries(
      Object.entries(assignments).map(([taskId, userIds]) => [taskId, assigneeNames(userIds, people)]),
    )
  }, [assignments, board, members, ownerProfile])
  const workingDays = useMemo(() => (board ? boardSchedule(board).working_days : []), [board])
  const numbers = useMemo(() => activityNumbers(columns, tasksByColumn), [columns, tasksByColumn])
  const allTasks = useMemo(
    () => columns.flatMap((column) => (tasksByColumn[column.id] ?? []).map((task) => ({ task, column }))),
    [columns, tasksByColumn],
  )
  const schedule = useMemo(
    () => computeSchedule(allTasks.map(({ task }) => task), workingDays),
    [allTasks, workingDays],
  )

  const rows = useMemo(
    () =>
      allTasks
        .filter(({ task }) => task.start_date && task.end_date)
        .sort((left, right) =>
          left.task.start_date!.localeCompare(right.task.start_date!) ||
          (numbers.get(left.task.id) ?? 0) - (numbers.get(right.task.id) ?? 0),
        ),
    [allTasks, numbers],
  )
  const undated = allTasks.length - rows.length

  const timeline = useMemo(() => {
    if (rows.length === 0) return null
    const start = startOfWeek(rows.reduce((min, { task }) => (task.start_date! < min ? task.start_date! : min), rows[0].task.start_date!))
    const end = rows.reduce((max, { task }) => (task.end_date! > max ? task.end_date! : max), rows[0].task.end_date!)
    const weeks = Math.floor(diffDays(start, end) / 7) + 1
    return { start, weeks: Array.from({ length: weeks }, (_, index) => addDays(start, index * 7)) }
  }, [rows])

  const labelWidth = narrow ? 168 : 340
  const today = todayKey()

  if (loadingBoard || (board && loading && columns.length === 0)) {
    return <main className="min-h-screen bg-[var(--bg-main)] p-6 text-slate-400">Cargando diagrama Gantt...</main>
  }

  if (!board || boardError) {
    return (
      <main className="min-h-screen bg-[var(--bg-main)] p-6 text-slate-300">
        <p className="alert-error rounded-lg p-4" role="alert">{boardError || 'Tablero no disponible.'}</p>
        <Link to="/dashboard" className="btn-ghost mt-4 inline-block px-4 py-2">Volver a tableros</Link>
      </main>
    )
  }

  const currentSchedule = boardSchedule(board)
  const x = (date: string) => diffDays(timeline!.start, date) * DAY_WIDTH
  const rowIndex = new Map(rows.map(({ task }, index) => [task.id, index]))
  const criticalCount = rows.filter(({ task }) => schedule.tasks.get(task.id)?.critical).length

  return (
    <main className="min-h-screen bg-[var(--bg-main)] px-3 py-4 text-slate-100 sm:px-6 sm:py-7">
      <div className="mx-auto max-w-[1800px]">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Link to={`/dashboard#board-${board.id}`} className="text-sm text-slate-400 transition hover:text-white">
              ← Volver al tablero
            </Link>
            <div className="mt-3 flex items-center gap-3">
              <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: board.color }} />
              <h1 className="min-w-0 break-words text-2xl font-semibold text-white sm:text-3xl">{board.name}</h1>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              {rows.length} actividad{rows.length === 1 ? '' : 'es'} con fechas · {criticalCount} en ruta crítica · Jornada: {describeWorkingDays(currentSchedule.working_days)}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              void exportBoardGanttWorkbook(board, columns, tasksByColumn, namesByTask).catch((err) =>
                setExportError(err instanceof Error ? err.message : 'No se pudo exportar.'),
              )
            }
            className="btn-ghost px-4 py-2 text-sm"
          >
            Exportar Gantt XLSX
          </button>
        </header>

        {(error || exportError) && <p className="alert-error mb-4 rounded-lg p-3 text-sm" role="alert">{error || exportError}</p>}

        <section className="glass-panel overflow-hidden rounded-2xl">
          <div className="border-b border-white/10 px-4 py-4 sm:px-5">
            <h2 className="text-lg font-semibold text-white">Cronograma del tablero</h2>
            <p className="mt-1 text-sm text-slate-400">
              La barra muestra la duración; el relleno, el avance estimado por estado de la columna. Los días no laborables aparecen sombreados.
            </p>
          </div>

          {!timeline ? (
            <div className="px-5 py-16 text-center text-sm text-slate-400">Añade fechas de inicio y fin a tus tareas para verlas aquí.</div>
          ) : (
            <div className="gantt-scroll">
              <div style={{ width: labelWidth + timeline.weeks.length * WEEK_WIDTH }}>
                <div className="gantt-row gantt-header" style={{ gridTemplateColumns: `${labelWidth}px 1fr` }}>
                  <div className="gantt-label gantt-sticky px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400 sm:px-5">Tarea</div>
                  <div className="flex">
                    {timeline.weeks.map((week, index) => (
                      <div key={week} className="shrink-0 border-l border-white/5 px-2 py-2 text-center text-[10px] text-slate-400" style={{ width: WEEK_WIDTH }}>
                        <span className="block font-semibold text-slate-300">{formatDateKey(week, { day: 'numeric', month: 'short' })}</span>
                        <span className="mt-0.5 block text-[9px] text-slate-500">Semana {index + 1}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="relative">
                  <svg
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0 z-20"
                    width={timeline.weeks.length * WEEK_WIDTH}
                    height={rows.length * ROW_HEIGHT}
                    style={{ left: labelWidth }}
                  >
                    {rows.flatMap(({ task }) =>
                      (task.predecessor_ids ?? [])
                        .filter((predecessorId) => rowIndex.has(predecessorId))
                        .map((predecessorId) => {
                          const predecessor = rows[rowIndex.get(predecessorId)!].task
                          const startX = x(addDays(predecessor.end_date!, 1)) - 2
                          const endX = x(task.start_date!) + 2
                          const startY = rowIndex.get(predecessorId)! * ROW_HEIGHT + ROW_HEIGHT / 2
                          const endY = rowIndex.get(task.id)! * ROW_HEIGHT + ROW_HEIGHT / 2
                          const bendX = endX >= startX + 16 ? endX - 8 : startX + 8
                          const critical = schedule.tasks.get(task.id)?.critical && schedule.tasks.get(predecessorId)?.critical
                          const overlap = schedule.tasks.get(task.id)?.startsBeforePredecessor
                          const path = endX >= startX + 16
                            ? `M ${startX} ${startY} H ${bendX} V ${endY} H ${endX}`
                            : `M ${startX} ${startY} H ${bendX} V ${(startY + endY) / 2} H ${endX - 8} V ${endY} H ${endX}`
                          const color = critical ? 'var(--critical)' : overlap ? 'var(--priority-medium)' : '#94a3b8'
                          return (
                            <g key={`${predecessorId}-${task.id}`}>
                              <path d={path} fill="none" stroke="#111827" strokeWidth={4} opacity={0.9} />
                              <path d={path} fill="none" stroke={color} strokeWidth={critical ? 2 : 1.5} strokeDasharray={critical ? undefined : '4 3'} />
                              <path d={`M ${endX - 5} ${endY - 4} L ${endX} ${endY} L ${endX - 5} ${endY + 4}`} fill="none" stroke={color} strokeWidth={1.5} />
                            </g>
                          )
                        }),
                    )}
                  </svg>

                  {today >= timeline.start && diffDays(timeline.start, today) <= timeline.weeks.length * 7 && (
                    <div className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-lime-300" style={{ left: labelWidth + x(today) }}>
                      <span className="absolute top-1 left-1 whitespace-nowrap rounded-full bg-lime-300 px-2 py-0.5 text-[10px] font-semibold text-slate-950">Hoy</span>
                    </div>
                  )}

                  {rows.map(({ task, column }) => {
                    const info = schedule.tasks.get(task.id)
                    const status = resolveColumnStatus(column)
                    const progress = columnStatusProgress[status]
                    const critical = info?.critical ?? false
                    const left = x(task.start_date!)
                    const width = Math.max(x(addDays(task.end_date!, 1)) - left, DAY_WIDTH)
                    return (
                      <div key={task.id} className="gantt-row" style={{ gridTemplateColumns: `${labelWidth}px 1fr`, height: ROW_HEIGHT }}>
                        <div className="gantt-label gantt-sticky min-w-0 px-3 py-2 sm:px-5">
                          <p className="line-clamp-2 text-sm font-medium text-white" title={task.title}>
                            <span className="mr-1.5 text-xs text-slate-500">#{numbers.get(task.id)}</span>
                            {task.title}
                          </p>
                          <p className="truncate text-[11px] text-slate-500">
                            {columnStatusLabels[status]} · {info?.duration ?? '?'} d háb.
                            {critical && <span className="ml-1 text-[var(--critical)]">◆ crítica</span>}
                            {info?.startsBeforePredecessor && <span className="ml-1 text-[var(--priority-medium)]">⚠ solapada</span>}
                          </p>
                          {(namesByTask[task.id]?.length ?? 0) > 0 && (
                            <p className="truncate text-[11px] text-slate-400" title={namesByTask[task.id].join(', ')}>
                              👤 {namesByTask[task.id].join(', ')}
                            </p>
                          )}
                        </div>
                        <div className="relative" style={{ backgroundImage: nonWorkingBackground(workingDays), backgroundSize: `${WEEK_WIDTH}px 100%` }}>
                          <div
                            className={`gantt-bar ${critical ? 'gantt-bar-critical' : progress === 100 ? 'gantt-bar-done' : ''}`}
                            style={{ left, width, height: BAR_HEIGHT, top: (ROW_HEIGHT - BAR_HEIGHT) / 2 }}
                            title={`#${numbers.get(task.id)} ${task.title}\n${formatDateKey(task.start_date!)} → ${formatDateKey(task.end_date!)} · ${progress}%`}
                          >
                            <span className="gantt-bar-progress" style={{ width: `${progress}%` }} />
                            <span className="gantt-bar-label">{progress}%</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-white/10 px-4 py-4 text-xs text-slate-400 sm:px-5">
            <span><i className="mr-2 inline-block h-3 w-3 rounded-sm bg-[var(--critical)] align-middle" />Ruta crítica (holgura 0)</span>
            <span><i className="mr-2 inline-block h-3 w-3 rounded-sm bg-[#6b8fb3] align-middle" />Actividad</span>
            <span><i className="mr-2 inline-block h-3 w-3 rounded-sm bg-[var(--status-done)] align-middle" />Completada</span>
            <span><i className="mr-2 inline-block h-3 w-3 rounded-sm bg-white/10 align-middle" />No laborable</span>
            <span>⚠ Empieza antes de que termine su predecesora</span>
            {undated > 0 && <span>{undated} tarea(s) sin fechas no se muestran.</span>}
          </div>
          <p className="border-t border-white/10 px-4 py-3 text-xs text-slate-500 sm:px-5">
            La ruta crítica se calcula con dependencias fin a inicio sobre los días hábiles del tablero. Las fechas de inicio guardadas actúan como «empieza no antes de».
          </p>
        </section>
      </div>
    </main>
  )
}

export default BoardGantt

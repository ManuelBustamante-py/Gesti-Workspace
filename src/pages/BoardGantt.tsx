import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import AssigneeAvatars from '../components/board/AssigneeAvatars'
import { useAuth } from '../context/AuthContext'
import { useBoardData } from '../hooks/useBoardData'
import { columnStatusLabels, columnStatusProgress, resolveColumnStatus } from '../domain/columnStatus'
import { addDays, diffDays, formatDateKey, isWorkingDay, startOfWeek, todayKey, weekdayNumber } from '../domain/dates'
import { activityNumbers } from '../domain/numbering'
import { assigneeNames, buildBoardPeople, type BoardPerson } from '../domain/people'
import { computeSchedule } from '../domain/schedule'
import { boardSchedule, describeWorkingDays } from '../domain/workSchedule'
import { getBoard, type Board } from '../services/boards'
import { exportBoardGanttWorkbook } from '../services/boardWorkbook'
import { getProfile, type Profile } from '../services/profiles'

type Zoom = 'fit' | 'week' | 'day'

const ZOOM_LABELS: Record<Zoom, string> = { fit: 'Ajustar', week: 'Semanas', day: 'Días' }
/** Ancho de un día en píxeles para las escalas fijas. «Ajustar» lo calcula según el espacio. */
const FIXED_DAY_WIDTH: Record<Exclude<Zoom, 'fit'>, number> = { week: 20, day: 44 }
const MIN_FIT_DAY_WIDTH = 8
const MAX_FIT_DAY_WIDTH = 72
const BAR_HEIGHT = 28
const WEEKDAY_INITIALS = ['D', 'L', 'M', 'X', 'J', 'V', 'S']

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

/** Ancho disponible del contenedor, actualizado al redimensionar la ventana. */
function useElementWidth<T extends HTMLElement>() {
  // Ref de callback: el contenedor aparece después de la carga inicial.
  const [element, setElement] = useState<T | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return [setElement, width] as const
}

function zoomStorageKey(boardId: string) {
  return `gesti:gantt-zoom:${boardId}`
}

function readZoom(boardId: string | undefined, narrow: boolean): Zoom {
  try {
    const stored = boardId ? window.localStorage.getItem(zoomStorageKey(boardId)) : null
    if (stored === 'fit' || stored === 'week' || stored === 'day') return stored
  } catch {
    // Preferencia opcional.
  }
  // En móvil «Ajustar» comprimiría demasiado: se parte de semanas con desplazamiento.
  return narrow ? 'week' : 'fit'
}

/** Fondo de una semana: separador semanal y días no laborables sombreados. */
function weekBackground(workingDays: number[], dayWidth: number) {
  const weekOrder = [2, 3, 4, 5, 6, 7, 1] // lunes..domingo con 1 = domingo
  const stops = weekOrder.flatMap((day, index) => {
    const color = workingDays.includes(day) ? 'transparent' : 'rgba(255,255,255,0.045)'
    return [`${color} ${index * dayWidth}px`, `${color} ${(index + 1) * dayWidth}px`]
  })
  return [
    'linear-gradient(to right, rgba(255,255,255,0.07) 1px, transparent 1px)',
    `linear-gradient(to right, ${stops.join(', ')})`,
  ].join(', ')
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
  const [zoom, setZoom] = useState<Zoom>(() => readZoom(boardId, narrow))
  const [scrollRef, availableWidth] = useElementWidth<HTMLDivElement>()

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

  const people = useMemo(
    () => (board ? buildBoardPeople(board.owner_id, ownerProfile, 'Propietario', members) : []),
    [board, members, ownerProfile],
  )
  const namesByTask = useMemo(
    () => Object.fromEntries(Object.entries(assignments).map(([taskId, userIds]) => [taskId, assigneeNames(userIds, people)])),
    [assignments, people],
  )
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
    const weekCount = Math.floor(diffDays(start, end) / 7) + 1
    const days = Array.from({ length: weekCount * 7 }, (_, index) => addDays(start, index))
    return { start, days, weeks: Array.from({ length: weekCount }, (_, index) => addDays(start, index * 7)) }
  }, [rows])

  function changeZoom(next: Zoom) {
    setZoom(next)
    try {
      if (boardId) window.localStorage.setItem(zoomStorageKey(boardId), next)
    } catch {
      // Preferencia opcional.
    }
  }

  const labelWidth = narrow ? 156 : 340
  const rowHeight = narrow ? 70 : 64
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
  const totalDays = timeline?.days.length ?? 0
  const dayWidth = zoom === 'fit'
    ? Math.min(MAX_FIT_DAY_WIDTH, Math.max(MIN_FIT_DAY_WIDTH, (availableWidth - labelWidth - 2) / Math.max(totalDays, 1)))
    : FIXED_DAY_WIDTH[zoom]
  const weekWidth = dayWidth * 7
  const timelineWidth = dayWidth * totalDays
  const showDays = dayWidth >= 18
  const x = (date: string) => diffDays(timeline!.start, date) * dayWidth
  const rowIndex = new Map(rows.map(({ task }, index) => [task.id, index]))
  const criticalCount = rows.filter(({ task }) => schedule.tasks.get(task.id)?.critical).length
  const todayVisible = timeline !== null && today >= timeline.start && diffDays(timeline.start, today) < totalDays

  const weekLabel = (week: string, index: number) => {
    if (weekWidth >= 110) return { main: formatDateKey(week, { day: 'numeric', month: 'short' }), sub: `Semana ${index + 1}` }
    if (weekWidth >= 56) return { main: formatDateKey(week, { day: 'numeric', month: 'short' }), sub: `S${index + 1}` }
    return { main: `S${index + 1}`, sub: '' }
  }

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
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-white">Cronograma del tablero</h2>
              <p className="mt-1 text-sm text-slate-400">
                La barra muestra la duración; el relleno, el avance estimado por estado de la columna. Los días no laborables aparecen sombreados.
              </p>
            </div>
            <div className="gantt-zoom" role="group" aria-label="Escala del cronograma">
              {(Object.keys(ZOOM_LABELS) as Zoom[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => changeZoom(value)}
                  aria-pressed={zoom === value}
                  className={`filter-chip ${zoom === value ? 'filter-chip-active' : ''}`}
                >
                  {ZOOM_LABELS[value]}
                </button>
              ))}
            </div>
          </div>

          <div ref={scrollRef} className="gantt-scroll">
            {!timeline ? (
              <div className="px-5 py-16 text-center text-sm text-slate-400">Añade fechas de inicio y fin a tus tareas para verlas aquí.</div>
            ) : availableWidth === 0 ? null : (
              <div style={{ width: labelWidth + timelineWidth }}>
                {/* Cabecera: semanas y, si hay espacio, cada día. */}
                <div className="gantt-row gantt-header" style={{ gridTemplateColumns: `${labelWidth}px ${timelineWidth}px` }}>
                  <div className="gantt-label gantt-sticky px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400 sm:px-5">Tarea</div>
                  <div className="relative">
                    <div className="flex">
                      {timeline.weeks.map((week, index) => {
                        const label = weekLabel(week, index)
                        return (
                          <div key={week} className="gantt-week-cell" style={{ width: weekWidth }}>
                            <span className="block font-semibold text-slate-300">{label.main}</span>
                            {label.sub && <span className="block text-[9px] text-slate-500">{label.sub}</span>}
                          </div>
                        )
                      })}
                    </div>
                    {showDays && (
                      <div className="flex border-t border-white/5">
                        {timeline.days.map((day) => (
                          <div
                            key={day}
                            className={`gantt-day-cell ${isWorkingDay(day, workingDays) ? '' : 'gantt-day-off'} ${day === today ? 'gantt-day-today' : ''}`}
                            style={{ width: dayWidth }}
                            title={formatDateKey(day, { weekday: 'long', day: 'numeric', month: 'long' })}
                          >
                            {dayWidth >= 28 && <span className="block text-[9px] opacity-70">{WEEKDAY_INITIALS[weekdayNumber(day) - 1]}</span>}
                            <span className="block">{Number(day.slice(8, 10))}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {todayVisible && (
                      <span className="gantt-today-pill" style={{ left: x(today) + dayWidth / 2 }}>Hoy</span>
                    )}
                  </div>
                </div>

                <div className="relative">
                  <svg
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0 z-20"
                    width={timelineWidth}
                    height={rows.length * rowHeight}
                    style={{ left: labelWidth }}
                  >
                    {rows.flatMap(({ task }) =>
                      (task.predecessor_ids ?? [])
                        .filter((predecessorId) => rowIndex.has(predecessorId))
                        .map((predecessorId) => {
                          const predecessor = rows[rowIndex.get(predecessorId)!].task
                          const startX = x(addDays(predecessor.end_date!, 1)) - 2
                          const endX = x(task.start_date!) + 2
                          const startY = rowIndex.get(predecessorId)! * rowHeight + rowHeight / 2
                          const endY = rowIndex.get(task.id)! * rowHeight + rowHeight / 2
                          const gap = Math.min(10, Math.max(4, dayWidth / 2))
                          const forward = endX >= startX + gap * 2
                          const path = forward
                            ? `M ${startX} ${startY} H ${endX - gap} V ${endY} H ${endX}`
                            : `M ${startX} ${startY} H ${startX + gap} V ${(startY + endY) / 2} H ${endX - gap} V ${endY} H ${endX}`
                          const critical = schedule.tasks.get(task.id)?.critical && schedule.tasks.get(predecessorId)?.critical
                          const overlap = schedule.tasks.get(task.id)?.startsBeforePredecessor
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

                  {todayVisible && (
                    <div className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-lime-300/80" style={{ left: labelWidth + x(today) + dayWidth / 2 }} />
                  )}

                  {rows.map(({ task, column }) => {
                    const info = schedule.tasks.get(task.id)
                    const status = resolveColumnStatus(column)
                    const progress = columnStatusProgress[status]
                    const critical = info?.critical ?? false
                    const left = x(task.start_date!)
                    const width = Math.max(x(addDays(task.end_date!, 1)) - left, Math.min(dayWidth, 12))
                    const number = numbers.get(task.id)
                    const assignees = (assignments[task.id] ?? [])
                      .map((userId) => people.find((person) => person.userId === userId))
                      .filter((person): person is BoardPerson => Boolean(person))
                    const barLabel = width >= 96 ? `#${number} · ${progress}%` : width >= 40 ? `${progress}%` : ''
                    const description = `#${number} ${task.title}. ${formatDateKey(task.start_date!)} a ${formatDateKey(task.end_date!)}. ${columnStatusLabels[status]}, ${progress}%${critical ? ', ruta crítica' : ''}`
                    return (
                      <div key={task.id} className="gantt-row" style={{ gridTemplateColumns: `${labelWidth}px ${timelineWidth}px`, height: rowHeight }}>
                        <div className="gantt-label gantt-sticky min-w-0 px-3 py-2 sm:px-5">
                          <p className="line-clamp-2 text-[13px] font-medium leading-snug text-white sm:text-sm" title={task.title}>
                            <span className="mr-1.5 text-xs text-slate-500">#{number}</span>
                            {task.title}
                          </p>
                          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-slate-500">
                            <span className="min-w-0 truncate">
                              {columnStatusLabels[status]} · {info?.duration ?? '?'} d háb.
                              {critical && <span className="ml-1 text-[var(--critical)]">◆ crítica</span>}
                              {info?.startsBeforePredecessor && <span className="ml-1 text-[var(--priority-medium)]">⚠ solapada</span>}
                            </span>
                            {assignees.length > 0 && (
                              <span className="ml-auto shrink-0">
                                <AssigneeAvatars people={assignees} max={narrow ? 2 : 3} />
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="relative" style={{ backgroundImage: weekBackground(workingDays, dayWidth), backgroundSize: `${weekWidth}px 100%` }}>
                          <div
                            className={`gantt-bar ${critical ? 'gantt-bar-critical' : progress === 100 ? 'gantt-bar-done' : ''}`}
                            style={{ left, width, height: BAR_HEIGHT, top: (rowHeight - BAR_HEIGHT) / 2 }}
                            title={`${description}${namesByTask[task.id]?.length ? `\nResponsables: ${namesByTask[task.id].join(', ')}` : ''}`}
                            role="img"
                            aria-label={description}
                          >
                            <span className="gantt-bar-progress" style={{ width: `${progress}%` }} />
                            {barLabel && <span className="gantt-bar-label">{barLabel}</span>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

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

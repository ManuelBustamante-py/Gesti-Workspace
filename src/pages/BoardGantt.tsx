import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'
import { getBoards, type Board } from '../services/boards'
import { ensureBoardColumns } from '../services/columns'
import { getColumnTasks, type Task } from '../services/tasks'

type GanttTask = Task & {
  columnName: string
  progress: number
  critical: boolean
}

const DAY_MS = 86400000

function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function startOfWeek(value: Date) {
  const date = new Date(value)
  const day = date.getDay()
  const daysFromMonday = day === 0 ? 6 : day - 1
  date.setDate(date.getDate() - daysFromMonday)
  date.setHours(0, 0, 0, 0)
  return date
}

function endOfWeek(value: Date) {
  const date = startOfWeek(value)
  date.setDate(date.getDate() + 6)
  return date
}

function progressForColumn(columnName: string) {
  const name = columnName.toLowerCase()
  if (name.includes('complet') || name.includes('termin') || name.includes('hech')) {
    return 100
  }
  if (name.includes('progreso') || name.includes('curso') || name.includes('doing')) {
    return 60
  }
  return 0
}

function BoardGantt() {
  const { boardId } = useParams<{ boardId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [board, setBoard] = useState<Board | null>(null)
  const [tasks, setTasks] = useState<GanttTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!boardId || !user) {
      return
    }

    const targetBoardId = boardId
    let cancelled = false
    async function loadGantt() {
      try {
        setLoading(true)
        setError('')
        const boards = await getBoards()
        const selectedBoard = boards.find((item) => item.id === targetBoardId)
        if (!selectedBoard) {
          throw new Error('No se encontró el tablero solicitado.')
        }

        const columns = await ensureBoardColumns(targetBoardId)
        const taskGroups = await Promise.all(
          columns.map(async (column) => ({
            column,
            tasks: await getColumnTasks(column.id),
          })),
        )
        const loadedTasks = taskGroups.flatMap(({ column, tasks: columnTasks }) =>
          columnTasks
            .filter((task) => Boolean(task.start_date && task.end_date))
            .map((task) => ({
              ...task,
              columnName: column.name,
              progress: progressForColumn(column.name),
              critical: task.priority === 'high',
            })),
        )

        if (!cancelled) {
          setBoard(selectedBoard)
          setTasks(loadedTasks)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'No se pudo cargar el diagrama Gantt.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadGantt()
    return () => {
      cancelled = true
    }
  }, [boardId, user])

  const timeline = useMemo(() => {
    if (tasks.length === 0) {
      return { start: null, end: null, weeks: [] as Date[] }
    }
    const start = startOfWeek(new Date(
      Math.min(...tasks.map((task) => parseDate(task.start_date as string).getTime())),
    ))
    const end = endOfWeek(new Date(
      Math.max(...tasks.map((task) => parseDate(task.end_date as string).getTime())),
    ))
    const weeks = Array.from(
      { length: Math.round((end.getTime() - start.getTime()) / (DAY_MS * 7)) + 1 },
      (_, index) => {
        const week = new Date(start)
        week.setDate(week.getDate() + index * 7)
        return week
      },
    )
    return { start, end, weeks }
  }, [tasks])

  const criticalIds = useMemo(() => {
    const scheduled = tasks.filter((task) => task.start_date && task.end_date)
    const byId = new Map(scheduled.map((task) => [task.id, task]))
    const duration = (task: GanttTask) =>
      Math.max(
        1,
        Math.round(
          (parseDate(task.end_date as string).getTime() -
            parseDate(task.start_date as string).getTime()) /
            DAY_MS,
        ) + 1,
      )
    const earliestFinish = new Map<string, number>()
    const visiting = new Set<string>()

    function calculateEarliestFinish(task: GanttTask): number {
      const cached = earliestFinish.get(task.id)
      if (cached !== undefined) return cached
      if (visiting.has(task.id)) return task.start_date ? parseDate(task.start_date).getTime() + duration(task) * DAY_MS : 0
      visiting.add(task.id)
      const predecessorFinish = (task.predecessor_ids ?? [])
        .map((id) => byId.get(id))
        .filter((item): item is GanttTask => Boolean(item))
        .reduce(
          (latest, predecessor) => Math.max(latest, calculateEarliestFinish(predecessor)),
          0,
        )
      const ownStart = parseDate(task.start_date as string).getTime()
      const finish = Math.max(ownStart, predecessorFinish) + duration(task) * DAY_MS
      visiting.delete(task.id)
      earliestFinish.set(task.id, finish)
      return finish
    }

    const projectFinish = Math.max(
      ...scheduled.map((task) => calculateEarliestFinish(task)),
      0,
    )
    const latestStart = new Map<string, number>()
    const successors = new Map<string, GanttTask[]>()
    scheduled.forEach((task) => {
      ;(task.predecessor_ids ?? []).forEach((predecessorId) => {
        const predecessor = byId.get(predecessorId)
        if (predecessor) {
          successors.set(predecessorId, [
            ...(successors.get(predecessorId) ?? []),
            task,
          ])
        }
      })
    })
    const critical = new Set<string>()
    ;[...scheduled]
      .sort(
        (left, right) =>
          parseDate(right.end_date as string).getTime() -
          parseDate(left.end_date as string).getTime(),
      )
      .forEach((task) => {
      const successorStarts = (successors.get(task.id) ?? []).map(
        (successor) => latestStart.get(successor.id) ?? projectFinish,
      )
      const latestFinish = successorStarts.length
        ? Math.min(...successorStarts)
        : projectFinish
      const slack = latestFinish - calculateEarliestFinish(task)
      if (Math.abs(slack) <= DAY_MS) critical.add(task.id)
      latestStart.set(task.id, latestFinish - duration(task) * DAY_MS)
      })
    return critical
  }, [tasks])

  if (loading) {
    return <main className="min-h-screen bg-[var(--bg-main)] p-6 text-slate-400">Cargando diagrama Gantt...</main>
  }

  if (error || !board) {
    return (
      <main className="min-h-screen bg-[var(--bg-main)] p-6 text-slate-300">
        <p className="alert-error rounded-lg p-4">{error || 'Tablero no disponible.'}</p>
        <button type="button" onClick={() => navigate('/dashboard')} className="btn-ghost mt-4 px-4 py-2">
          Volver a tableros
        </button>
      </main>
    )
  }

  const labelWidth = 360
  const weekWidth = 120
  const rowHeight = 72
  const orderedTasks = [...tasks].sort((left, right) => {
    const startDifference =
      parseDate(left.start_date as string).getTime() -
      parseDate(right.start_date as string).getTime()

    return startDifference || left.position - right.position
  })
  const todayOffset =
    timeline.start && timeline.end
      ? (Date.now() - timeline.start.getTime()) / (DAY_MS * 7)
      : -1

  return (
    <main className="min-h-screen bg-[var(--bg-main)] px-3 py-4 text-slate-100 sm:px-6 sm:py-7">
      <div className="mx-auto max-w-[1800px]">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link to="/dashboard" className="text-sm text-slate-400 transition hover:text-white">
              ← Volver al tablero
            </Link>
            <div className="mt-4 flex items-center gap-3">
              <span className="h-4 w-4 rounded-full" style={{ backgroundColor: board.color }} />
              <h1 className="text-2xl font-semibold text-white sm:text-3xl">{board.name}</h1>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Diagrama Gantt · {tasks.length} actividad{tasks.length === 1 ? '' : 'es'}
              {timeline.start && timeline.end
                ? ` · ${timeline.start.toLocaleDateString('es-ES')} - ${timeline.end.toLocaleDateString('es-ES')}`
                : ''}
            </p>
          </div>
          <button type="button" onClick={() => navigate('/dashboard')} className="btn-ghost px-4 py-2">
            Cerrar vista
          </button>
        </header>

        <section className="glass-panel overflow-hidden rounded-2xl">
          <div className="border-b border-white/10 px-5 py-5">
            <h2 className="text-lg font-semibold text-white">Cronograma del tablero</h2>
            <p className="mt-1 text-sm text-slate-400">
              Las barras muestran la duración; el relleno indica el avance estimado por estado.
            </p>
          </div>

          {tasks.length === 0 ? (
            <div className="px-5 py-16 text-center text-sm text-slate-400">
              Añade fechas de inicio y fin a tus tareas para verlas aquí.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div style={{ minWidth: labelWidth + timeline.weeks.length * weekWidth }}>
                <div
                  className="grid border-b border-white/10 bg-white/[0.03]"
                  style={{ gridTemplateColumns: `${labelWidth}px 1fr` }}
                >
                  <div className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Tarea
                  </div>
                  <div
                    className="grid"
                    style={{ gridTemplateColumns: `repeat(${timeline.weeks.length}, ${weekWidth}px)` }}
                  >
                    {timeline.weeks.map((week, index) => (
                      <div key={week.toISOString()} className="border-l border-white/5 px-2 py-3 text-center text-[10px] text-slate-400">
                        <span className="block font-semibold text-slate-300">
                          {week.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                        </span>
                        <span className="mt-1 block text-[9px] text-slate-500">
                          Semana {index + 1}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="relative">
                  <svg
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0 z-50"
                    width={timeline.weeks.length * weekWidth}
                    height={orderedTasks.length * rowHeight}
                    style={{ left: labelWidth }}
                  >
                    {orderedTasks.flatMap((task, index) => {
                      const successors = orderedTasks
                        .map((candidate, candidateIndex) => ({
                          task: candidate,
                          index: candidateIndex,
                        }))
                        .filter(({ task: candidate }) =>
                          (candidate.predecessor_ids ?? []).includes(task.id),
                        )

                      const taskOffset = Math.round(
                        (parseDate(task.start_date as string).getTime() -
                          (timeline.start as Date).getTime()) /
                          (DAY_MS * 7),
                      )
                      const taskDuration =
                        (parseDate(task.end_date as string).getTime() -
                          parseDate(task.start_date as string).getTime()) /
                          (DAY_MS * 7) +
                        1 / 7
                      const startX = taskOffset * weekWidth + taskDuration * weekWidth - 3
                      return successors.map(({ task: nextTask, index: nextIndex }) => {
                        const nextOffset =
                          (parseDate(nextTask.start_date as string).getTime() -
                            (timeline.start as Date).getTime()) /
                          (DAY_MS * 7)
                        const endX = nextOffset * weekWidth + 3
                        const startY = index * rowHeight + rowHeight / 2
                        const endY = nextIndex * rowHeight + rowHeight / 2
                        const bendX = Math.max(startX + 12, endX - 12)
                        const critical =
                          criticalIds.has(task.id) && criticalIds.has(nextTask.id)
                        const path = `M ${startX} ${startY} H ${bendX} V ${endY} H ${endX}`

                        return (
                          <g key={`${task.id}-${nextTask.id}`}>
                            <path
                              d={path}
                              fill="none"
                              stroke="#111827"
                              strokeWidth={critical ? 5 : 4}
                              strokeDasharray={critical ? undefined : '4 3'}
                              opacity={0.95}
                            />
                            <path
                              d={path}
                              fill="none"
                              stroke={critical ? '#fb7185' : '#94a3b8'}
                              strokeWidth={critical ? 2 : 1.5}
                              strokeDasharray={critical ? undefined : '4 3'}
                              opacity={1}
                            />
                          </g>
                        )
                      })
                    })}
                  </svg>

                  {todayOffset >= 0 && todayOffset <= timeline.weeks.length && (
                    <div
                      className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-lime-300"
                      style={{
                        left: labelWidth + todayOffset * weekWidth,
                      }}
                    >
                      <span className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-lime-300 px-2 py-1 text-[10px] font-semibold text-slate-950">
                        Hoy
                      </span>
                    </div>
                  )}

                {orderedTasks.map((task) => {
                  const start = parseDate(task.start_date as string)
                  const end = parseDate(task.end_date as string)
                  const offset = (start.getTime() - (timeline.start as Date).getTime()) / (DAY_MS * 7)
                  const duration = (end.getTime() - start.getTime()) / (DAY_MS * 7) + 1 / 7
                  const isCritical = criticalIds.has(task.id)
                  const barColor = isCritical
                    ? 'bg-[#7f1d3b]'
                    : task.progress === 100
                      ? 'bg-emerald-400'
                      : 'bg-slate-500'
                  const progressWidth = Math.max(0, Math.min(100, task.progress))

                  return (
                    <div
                      key={task.id}
                      className="grid min-h-[72px] border-b border-white/10"
                      style={{ gridTemplateColumns: `${labelWidth}px 1fr` }}
                    >
                      <div className="min-w-0 px-5 py-3">
                        <p className="break-words text-sm font-medium text-white">
                          <span className="mr-2 text-xs text-slate-500">
                            #{orderedTasks.findIndex((item) => item.id === task.id) + 1}
                          </span>
                          {task.title}
                        </p>
                        <p className="break-words text-xs text-slate-500">
                          {task.columnName} · {task.progress}%
                        </p>
                      </div>
                      <div
                        className="relative grid items-center"
                        style={{ gridTemplateColumns: `repeat(${timeline.weeks.length}, ${weekWidth}px)` }}
                      >
                        {timeline.weeks.map((week) => (
                          <span key={week.toISOString()} className="h-full border-l border-white/5" />
                        ))}
                        <div
                          className={`absolute z-40 h-7 overflow-visible rounded-md border ${isCritical ? 'border-rose-200 shadow-[0_0_0_1px_rgba(251,113,133,0.55),0_0_12px_rgba(244,63,94,0.22)]' : 'border-white/20'} ${barColor}`}
                          style={{
                            left: offset * weekWidth + 3,
                            width: Math.max(duration * weekWidth - 6, 38),
                          }}
                          title={`${task.start_date} → ${task.end_date}`}
                        >
                          <div className="absolute inset-0 overflow-hidden rounded-[5px]">
                            <div
                              className={isCritical ? 'h-full bg-rose-400/80' : 'h-full bg-white/35'}
                              style={{ width: `${progressWidth}%` }}
                            />
                          </div>
                          <span className={`absolute inset-0 z-10 flex items-center justify-center whitespace-nowrap text-[10px] font-bold ${isCritical ? 'text-white' : 'text-slate-950'}`}>
                            {task.progress}%
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-5 border-t border-white/10 px-5 py-4 text-xs text-slate-400">
            <span><i className="mr-2 inline-block h-3 w-3 rounded-sm bg-rose-400" />Ruta crítica visual</span>
            <span><i className="mr-2 inline-block h-3 w-3 rounded-sm bg-emerald-400" />Completada</span>
            <span><i className="mr-2 inline-block h-3 w-3 rounded-sm bg-slate-500" />Pendiente</span>
            <span><i className="mr-2 inline-block h-0.5 w-4 align-middle bg-rose-400" />Secuencia crítica</span>
            <span><i className="mr-2 inline-block h-0.5 w-4 align-middle border-t border-dashed border-slate-500" />Dependencia visual</span>
            <span>La ruta crítica visual combina prioridad alta y orden cronológico; las dependencias aún no se almacenan.</span>
          </div>
        </section>
      </div>
    </main>
  )
}

export default BoardGantt

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
      return { start: null, end: null, days: [] as Date[] }
    }
    const start = new Date(
      Math.min(...tasks.map((task) => parseDate(task.start_date as string).getTime())),
    )
    const end = new Date(
      Math.max(...tasks.map((task) => parseDate(task.end_date as string).getTime())),
    )
    const days = Array.from(
      { length: Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1 },
      (_, index) => {
        const day = new Date(start)
        day.setDate(day.getDate() + index)
        return day
      },
    )
    return { start, end, days }
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

  const labelWidth = 280
  const dayWidth = 42
  const rowHeight = 72
  const orderedTasks = [...tasks].sort((left, right) => {
    const startDifference =
      parseDate(left.start_date as string).getTime() -
      parseDate(right.start_date as string).getTime()

    return startDifference || left.position - right.position
  })
  const todayOffset =
    timeline.start && timeline.end
      ? (Date.now() - timeline.start.getTime()) / DAY_MS
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
              <div style={{ minWidth: labelWidth + timeline.days.length * dayWidth }}>
                <div
                  className="grid border-b border-white/10 bg-white/[0.03]"
                  style={{ gridTemplateColumns: `${labelWidth}px 1fr` }}
                >
                  <div className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Tarea
                  </div>
                  <div
                    className="grid"
                    style={{ gridTemplateColumns: `repeat(${timeline.days.length}, ${dayWidth}px)` }}
                  >
                    {timeline.days.map((day) => (
                      <div key={day.toISOString()} className="border-l border-white/5 px-1 py-3 text-center text-[10px] text-slate-400">
                        {day.getDate()}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="relative">
                  <svg
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0 z-20"
                    width={timeline.days.length * dayWidth}
                    height={orderedTasks.length * rowHeight}
                    style={{ left: labelWidth }}
                  >
                    {orderedTasks.slice(0, -1).map((task, index) => {
                      const nextTask = orderedTasks[index + 1]
                      const taskStart = parseDate(task.start_date as string)
                      const taskEnd = parseDate(task.end_date as string)
                      const nextStart = parseDate(nextTask.start_date as string)
                      const taskOffset = Math.round(
                        (taskStart.getTime() - (timeline.start as Date).getTime()) / DAY_MS,
                      )
                      const taskDuration =
                        Math.round((taskEnd.getTime() - taskStart.getTime()) / DAY_MS) + 1
                      const nextOffset = Math.round(
                        (nextStart.getTime() - (timeline.start as Date).getTime()) / DAY_MS,
                      )
                      const startX = taskOffset * dayWidth + taskDuration * dayWidth - 3
                      const endX = nextOffset * dayWidth + 3
                      const startY = index * rowHeight + rowHeight / 2
                      const endY = (index + 1) * rowHeight + rowHeight / 2
                      const bendX = Math.max(startX + 12, endX - 12)
                      const critical = task.critical && nextTask.critical

                      return (
                        <path
                          key={`${task.id}-${nextTask.id}`}
                          d={`M ${startX} ${startY} H ${bendX} V ${endY} H ${endX}`}
                          fill="none"
                          stroke={critical ? '#fb7185' : '#64748b'}
                          strokeWidth={critical ? 2 : 1.5}
                          strokeDasharray={critical ? undefined : '4 3'}
                          opacity={critical ? 0.95 : 0.7}
                        />
                      )
                    })}
                  </svg>

                  {todayOffset >= 0 && todayOffset <= timeline.days.length - 1 && (
                    <div
                      className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-lime-300"
                      style={{
                        left: labelWidth + todayOffset * dayWidth + dayWidth / 2,
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
                  const offset = Math.round((start.getTime() - (timeline.start as Date).getTime()) / DAY_MS)
                  const duration = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1
                  const barColor = task.critical ? 'bg-rose-400' : task.progress === 100 ? 'bg-emerald-400' : 'bg-slate-500'
                  const progressWidth = Math.max(0, Math.min(100, task.progress))

                  return (
                    <div
                      key={task.id}
                      className="grid min-h-[72px] border-b border-white/10"
                      style={{ gridTemplateColumns: `${labelWidth}px 1fr` }}
                    >
                      <div className="min-w-0 px-5 py-3">
                        <p className="truncate text-sm font-medium text-white">{task.title}</p>
                        <p className="truncate text-xs text-slate-500">
                          {task.columnName} · {task.progress}%
                        </p>
                      </div>
                      <div
                        className="relative grid items-center"
                        style={{ gridTemplateColumns: `repeat(${timeline.days.length}, ${dayWidth}px)` }}
                      >
                        {timeline.days.map((day) => (
                          <span key={day.toISOString()} className="h-full border-l border-white/5" />
                        ))}
                        <div
                          className={`absolute z-10 h-8 overflow-hidden rounded-md border ${task.critical ? 'border-rose-300/80' : 'border-white/20'} ${barColor}`}
                          style={{
                            left: offset * dayWidth + 3,
                            width: Math.max(duration * dayWidth - 6, 18),
                          }}
                          title={`${task.start_date} → ${task.end_date}`}
                        >
                          <div className="h-full bg-white/35" style={{ width: `${progressWidth}%` }} />
                          <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-slate-950">
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

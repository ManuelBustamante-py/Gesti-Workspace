import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import FlowChart from '../components/flow/FlowChart'
import { useAuth } from '../context/AuthContext'
import { useBoardData } from '../hooks/useBoardData'
import { useElementWidth, useIsNarrow } from '../hooks/useLayout'
import { supabase } from '../lib/supabase'
import {
  applyCompletionDates,
  buildDailyFlow,
  computeForecast,
  flowLabels,
  ganttDeadline,
  THROUGHPUT_WINDOW_DAYS,
  WIP_TREND_DAYS,
  type FlowForecast,
  type StatusEvent,
} from '../domain/cfd'
import { resolveColumnStatus } from '../domain/columnStatus'
import { formatDateKey, todayKey, weekdayNumber } from '../domain/dates'
import { getBoard, type Board } from '../services/boards'
import { getBoardStatusEvents } from '../services/flowHistory'

/** Historial máximo mostrado: 26 semanas. */
const MAX_HISTORY_DAYS = 182

const number = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 })
const longDate = (day: string) => formatDateKey(day, { day: 'numeric', month: 'long', year: 'numeric' })

function riskMessage(forecast: FlowForecast) {
  const pace = `${number.format(forecast.throughputPerWeek)} tareas/semana`
  switch (forecast.risk) {
    case 'complete':
      return { tone: 'success', icon: '🏆', title: 'Proyecto completado', text: 'Todas las tareas del tablero están en «Listo».' }
    case 'overdue':
      return {
        tone: 'danger',
        icon: '⛔',
        title: 'Fin planificado vencido',
        text: `El Gantt terminaba el ${longDate(forecast.deadline!)} y aún quedan ${forecast.remaining} tarea(s) por completar${forecast.projectedFinish ? `. Al ritmo actual (${pace}) terminaría el ${longDate(forecast.projectedFinish)}.` : '.'}`,
      }
    case 'at_risk':
      return {
        tone: 'danger',
        icon: '⚠',
        title: `Riesgo de retraso: ${forecast.daysLate} día(s)`,
        text: `Al ritmo actual (${pace}) el proyecto terminaría el ${longDate(forecast.projectedFinish!)}, después del fin planificado en el Gantt (${longDate(forecast.deadline!)}).${forecast.requiredPerWeek ? ` Para cumplir se necesitan ${number.format(forecast.requiredPerWeek)} tareas/semana.` : ''}`,
      }
    case 'no_velocity':
      return {
        tone: 'warning',
        icon: '⚠',
        title: 'Sin velocidad medible',
        text: `No se completó ninguna tarea en los últimos ${THROUGHPUT_WINDOW_DAYS} días, así que no es posible proyectar la entrega. Quedan ${forecast.remaining} tarea(s)${forecast.deadline ? ` y el Gantt termina el ${longDate(forecast.deadline)}` : ''}.`,
      }
    case 'no_deadline':
      return {
        tone: 'info',
        icon: 'ℹ',
        title: `Proyección: ${longDate(forecast.projectedFinish!)}`,
        text: `Al ritmo actual (${pace}). Añade fechas a las tareas para compararla con un plazo en el Gantt.`,
      }
    default:
      return {
        tone: 'success',
        icon: '✓',
        title: 'En plazo',
        text: `Al ritmo actual (${pace}) terminaría el ${longDate(forecast.projectedFinish!)}, ${Math.abs(forecast.daysLate ?? 0)} día(s) antes del fin planificado en el Gantt (${longDate(forecast.deadline!)}).`,
      }
  }
}

function BoardFlow() {
  const { boardId } = useParams<{ boardId: string }>()
  const { user } = useAuth()
  const narrow = useIsNarrow()
  const [chartRef, chartWidth] = useElementWidth<HTMLDivElement>()
  const [board, setBoard] = useState<Board | null>(null)
  const [boardError, setBoardError] = useState('')
  const [loadingBoard, setLoadingBoard] = useState(true)
  const [events, setEvents] = useState<StatusEvent[]>([])
  const [historySupported, setHistorySupported] = useState(true)
  const [loadingEvents, setLoadingEvents] = useState(true)
  const [eventsError, setEventsError] = useState('')
  const [showTable, setShowTable] = useState(false)

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

  const loadEvents = useCallback(async (targetBoardId: string) => {
    try {
      const result = await getBoardStatusEvents(targetBoardId)
      setEvents(result.events)
      setHistorySupported(result.supported)
      setEventsError('')
    } catch (err) {
      setEventsError(err instanceof Error ? err.message : 'No se pudo cargar el historial.')
    } finally {
      setLoadingEvents(false)
    }
  }, [])

  // El historial se actualiza en tiempo real cuando alguien mueve una tarea.
  useEffect(() => {
    if (!board) return
    void loadEvents(board.id)
    let timer: ReturnType<typeof setTimeout> | null = null
    const channel = supabase
      .channel(`flow-${board.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_status_events', filter: `board_id=eq.${board.id}` }, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => void loadEvents(board.id), 400)
      })
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [board, loadEvents])

  const { columns, tasksByColumn } = useBoardData(board?.id ?? null, Boolean(board))
  // Fechas de finalización confirmadas en las columnas «Completado».
  const completions = useMemo(() => {
    const result: Record<string, string> = {}
    columns.forEach((column) => {
      if (resolveColumnStatus(column) !== 'done') return
      ;(tasksByColumn[column.id] ?? []).forEach((task) => {
        if (task.completed_at) result[task.id] = task.completed_at
      })
    })
    return result
  }, [columns, tasksByColumn])
  const confirmedCount = Object.keys(completions).length
  const deadline = useMemo(() => ganttDeadline(Object.values(tasksByColumn).flat()), [tasksByColumn])
  const today = todayKey()
  const allPoints = useMemo(
    () => buildDailyFlow(applyCompletionDates(events, completions), today),
    [completions, events, today],
  )
  const forecast = useMemo(() => computeForecast(allPoints, deadline), [allPoints, deadline])
  const points = useMemo(() => allPoints.slice(-MAX_HISTORY_DAYS), [allPoints])
  const weeklyRows = useMemo(
    () => points.filter((point, index) => weekdayNumber(point.day) === 2 || index === points.length - 1).reverse(),
    [points],
  )

  if (loadingBoard) {
    return <main className="min-h-screen bg-[var(--bg-main)] p-6 text-slate-400">Cargando diagrama de flujo...</main>
  }

  if (!board || boardError) {
    return (
      <main className="min-h-screen bg-[var(--bg-main)] p-6 text-slate-300">
        <p className="alert-error rounded-lg p-4" role="alert">{boardError || 'Tablero no disponible.'}</p>
        <Link to="/dashboard" className="btn-ghost mt-4 inline-block px-4 py-2">Volver a tableros</Link>
      </main>
    )
  }

  const risk = forecast ? riskMessage(forecast) : null

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
            <p className="mt-2 text-sm text-slate-400">Diagrama de flujo acumulado (CFD) con proyección de entrega</p>
          </div>
          <Link to={`/dashboard/gantt/${board.id}`} className="btn-ghost px-4 py-2 text-sm">Diagrama Gantt</Link>
        </header>

        {!historySupported ? (
          <p className="alert-warning rounded-lg p-4 text-sm">
            El historial de estados aún no está activado. Aplica la migración <code>20261007120000_task_status_history.sql</code> en Supabase para ver el diagrama de flujo.
          </p>
        ) : loadingEvents ? (
          <p className="text-slate-400">Cargando historial...</p>
        ) : eventsError ? (
          <p className="alert-error rounded-lg p-4 text-sm" role="alert">{eventsError}</p>
        ) : !forecast ? (
          <p className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-400">
            Este tablero aún no tiene tareas. El diagrama aparecerá cuando se creen y muevan tareas.
          </p>
        ) : (
          <>
            {risk && (
              <section className={`flow-risk flow-risk-${risk.tone}`} role={risk.tone === 'danger' ? 'alert' : 'status'}>
                <span className="flow-risk-icon" aria-hidden="true">{risk.icon}</span>
                <div className="min-w-0">
                  <h2 className="font-semibold text-white">{risk.title}</h2>
                  <p className="mt-1 text-sm text-[var(--text-main)]">{risk.text}</p>
                </div>
              </section>
            )}
            {forecast.bottleneck && (
              <section className="flow-risk flow-risk-warning mt-3" role="status">
                <span className="flow-risk-icon" aria-hidden="true">⚠</span>
                <div className="min-w-0">
                  <h2 className="font-semibold text-white">Posible cuello de botella</h2>
                  <p className="mt-1 text-sm text-[var(--text-main)]">
                    El trabajo en progreso pasó de {forecast.wipBefore} a {forecast.wipNow} tareas en {WIP_TREND_DAYS} días sin que aumente al mismo ritmo lo completado. La banda «En progreso» se está ensanchando: revisa bloqueos antes de que afecten al Gantt.
                  </p>
                </div>
              </section>
            )}

            <div className="flow-metrics mt-4">
              <div className="stat-tile">
                <span className="stat-value">{number.format(forecast.throughputPerWeek)}</span>
                <span className="stat-label">Tareas/semana · últimos {forecast.windowDays} días</span>
              </div>
              <div className="stat-tile">
                <span className="stat-value">{forecast.remaining}</span>
                <span className="stat-label">Restantes de {forecast.current.total}</span>
              </div>
              <div className={`stat-tile ${forecast.bottleneck ? 'stat-tile-alert' : ''}`}>
                <span className="stat-value">{forecast.wipNow}</span>
                <span className="stat-label">En progreso · hace {WIP_TREND_DAYS} días: {forecast.wipBefore}</span>
              </div>
              <div className="stat-tile">
                <span className="stat-value">{forecast.cycleTimeDays !== null ? `${number.format(forecast.cycleTimeDays)} d` : '—'}</span>
                <span className="stat-label">Tiempo de ciclo estimado</span>
              </div>
              <div className={`stat-tile ${forecast.risk === 'at_risk' || forecast.risk === 'overdue' ? 'stat-tile-alert' : ''}`}>
                <span className="stat-value text-lg">{forecast.projectedFinish ? formatDateKey(forecast.projectedFinish, { day: 'numeric', month: 'short' }) : '—'}</span>
                <span className="stat-label">Fin proyectado</span>
              </div>
              <div className="stat-tile">
                <span className="stat-value text-lg">{forecast.deadline ? formatDateKey(forecast.deadline, { day: 'numeric', month: 'short' }) : '—'}</span>
                <span className="stat-label">Fin planificado (Gantt)</span>
              </div>
            </div>

            <section className="glass-panel mt-4 overflow-hidden rounded-2xl">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-white">Flujo acumulado</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Cada banda es la cantidad de tareas en ese estado cada día. Si «En progreso» se ensancha, el trabajo se está acumulando. A la derecha de «Hoy», la línea discontinua proyecta lo completado al ritmo real del equipo.
                  </p>
                </div>
                <button type="button" onClick={() => setShowTable((value) => !value)} className="btn-ghost px-3 py-1.5 text-sm" aria-pressed={showTable}>
                  {showTable ? 'Ver gráfico' : 'Ver tabla'}
                </button>
              </div>

              <ul className="flow-legend" aria-label="Leyenda">
                {(['todo', 'in_progress', 'done'] as const).map((status) => (
                  <li key={status}><span className={`flow-swatch flow-key-${status}`} aria-hidden="true" />{flowLabels[status]}</li>
                ))}
                <li><span className="flow-swatch-line flow-swatch-projection" aria-hidden="true" />Proyección de lo completado</li>
                <li><span className="flow-swatch-line flow-swatch-deadline" aria-hidden="true" />Fin planificado (Gantt)</li>
                <li><span className="flow-swatch-line flow-swatch-today" aria-hidden="true" />Hoy</li>
              </ul>

              <div ref={chartRef} className="px-2 pb-4 sm:px-4">
                {showTable ? (
                  <div className="overflow-x-auto">
                    <table className="flow-table">
                      <caption className="sr-only">Tareas por estado al inicio de cada semana</caption>
                      <thead>
                        <tr><th scope="col">Fecha</th><th scope="col">Listo</th><th scope="col">En progreso</th><th scope="col">Por hacer</th><th scope="col">Total</th></tr>
                      </thead>
                      <tbody>
                        {weeklyRows.map((point) => (
                          <tr key={point.day}>
                            <th scope="row">{formatDateKey(point.day)}{point.day === today ? ' (hoy)' : ''}</th>
                            <td>{point.done}</td><td>{point.in_progress}</td><td>{point.todo}</td><td>{point.total}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : chartWidth > 0 && points.length > 0 ? (
                  <FlowChart points={points} forecast={forecast} width={chartWidth} narrow={narrow} />
                ) : null}
              </div>

              <p className="border-t border-white/10 px-4 py-3 text-xs text-slate-500 sm:px-5">
                Velocidad = tareas que pasaron a «Listo» desde otro estado (menos las reabiertas) en los últimos {THROUGHPUT_WINDOW_DAYS} días; las creadas o importadas ya listas no cuentan. Con menos de una semana de historial se divide igualmente por 7 días para no exagerar el ritmo.{confirmedCount > 0 && ` Se usan las fechas de finalización confirmadas de ${confirmedCount} tarea(s).`} La proyección asume que ese ritmo se mantiene y que no se agregan tareas.
                El tiempo de ciclo se estima con la ley de Little (trabajo en progreso ÷ velocidad).
                {forecast.lowConfidence && ' Hay menos de 2 semanas de historial: la proyección es poco fiable todavía.'}
                {' '}El historial anterior a la activación de esta función se reconstruyó de forma aproximada con las fechas de creación y última actualización de cada tarea.
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  )
}

export default BoardFlow

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import BurndownChart from '../components/flow/BurndownChart'
import FlowChart from '../components/flow/FlowChart'
import FlowInterpretationPanel from '../components/flow/FlowInterpretationPanel'
import { useAuth } from '../hooks/useAuth'
import { useBoardData } from '../hooks/useBoardData'
import { useElementWidth, useIsNarrow } from '../hooks/useLayout'
import { supabase } from '../lib/supabase'
import {
  anchorInitialScope,
  applyStatusDates,
  buildDailyFlow,
  flowLabels,
  ganttDeadline,
  initialScopeTasks,
  THROUGHPUT_WINDOW_DAYS,
  WIP_TREND_DAYS,
  type FlowForecast,
  type StatusDate,
  type StatusEvent,
} from '../domain/cfd'
import { resolveColumnStatus } from '../domain/columnStatus'
import { formatDateKey, localDateToKey, todayKey, weekdayNumber } from '../domain/dates'
import { effortWeights, taskEffort } from '../domain/effort'
import { analyzeFlow, type PendingTaskBase } from '../domain/flowAnalysis'
import { activityNumbers } from '../domain/numbering'
import { boardWorkingDays } from '../domain/workSchedule'
import { getBoard, type Board } from '../services/boards'
import { getBoardStatusEvents } from '../services/flowHistory'
import type { FlowReportPendingTask } from '../lib/flowReport'


/** Unidad en que se mide el trabajo: puntos de esfuerzo o cantidad de tareas. */
type FlowUnit = 'points' | 'tasks'
type FlowView = 'burndown' | 'cfd'

const UNIT_LABELS: Record<FlowUnit, { short: string; long: string }> = {
  points: { short: 'pts', long: 'puntos' },
  tasks: { short: 'tareas', long: 'tareas' },
}

const number = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 })
const longDate = (day: string) => formatDateKey(day, { day: 'numeric', month: 'long', year: 'numeric' })

/** committed: el plazo es el fin comprometido del tablero y no el fin más tardío del Gantt. */
function riskMessage(forecast: FlowForecast, committed: boolean, unit: FlowUnit) {
  const deadlineName = committed ? 'fin comprometido' : 'fin planificado en el Gantt'
  const { short, long } = UNIT_LABELS[unit]
  const pace = `${number.format(forecast.throughputPerWeek)} ${short}/semana`
  const remaining = `${number.format(forecast.remaining)} ${long}`
  switch (forecast.risk) {
    case 'complete':
      return { tone: 'success', icon: '🏆', title: 'Proyecto completado', text: 'Todas las tareas del tablero están en «Listo».' }
    case 'overdue':
      return {
        tone: 'danger',
        icon: '⛔',
        title: committed ? 'Fin comprometido vencido' : 'Fin planificado vencido',
        text: `${committed ? 'El fin comprometido era' : 'El Gantt terminaba'} el ${longDate(forecast.deadline!)} y aún quedan ${remaining} por completar${forecast.projectedFinish ? `. Al ritmo actual (${pace}) terminaría el ${longDate(forecast.projectedFinish)}.` : '.'}`,
      }
    case 'at_risk':
      return {
        tone: 'danger',
        icon: '⚠',
        title: `Riesgo de retraso: ${forecast.daysLate} día(s)`,
        text: `Al ritmo actual (${pace}) el proyecto terminaría el ${longDate(forecast.projectedFinish!)}, después del ${deadlineName} (${longDate(forecast.deadline!)}).${forecast.requiredPerWeek ? ` Para cumplir se necesitan ${number.format(forecast.requiredPerWeek)} ${short}/semana.` : ''}`,
      }
    case 'no_velocity':
      return {
        tone: 'warning',
        icon: '⚠',
        title: 'Sin velocidad medible',
        text: `No se completó ninguna tarea en los últimos ${THROUGHPUT_WINDOW_DAYS} días, así que no es posible proyectar la entrega. Quedan ${remaining}${forecast.deadline ? ` y el ${deadlineName} es el ${longDate(forecast.deadline)}` : ''}.`,
      }
    case 'no_deadline':
      return {
        tone: 'info',
        icon: 'ℹ',
        title: `Proyección: ${longDate(forecast.projectedFinish!)}`,
        text: `Al ritmo actual (${pace}). Define un fin comprometido en «Editar» del tablero, o añade fechas a las tareas, para compararla con un plazo.`,
      }
    default:
      return {
        tone: 'success',
        icon: '✓',
        title: 'En plazo',
        text: `Al ritmo actual (${pace}) terminaría el ${longDate(forecast.projectedFinish!)}, ${Math.abs(forecast.daysLate ?? 0)} día(s) antes del ${deadlineName} (${longDate(forecast.deadline!)}).`,
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
  const [view, setView] = useState<FlowView>('burndown')
  // null: se elige sola (puntos si hay alguna tarea estimada).
  const [unitChoice, setUnitChoice] = useState<FlowUnit | null>(null)
  const [exporting, setExporting] = useState<'pdf' | 'html' | null>(null)

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
  // Fechas reales registradas: «Completada el» y «En esta columna desde».
  const statusDates = useMemo(() => {
    const result: Record<string, StatusDate> = {}
    columns.forEach((column) => {
      const status = resolveColumnStatus(column)
      ;(tasksByColumn[column.id] ?? []).forEach((task) => {
        const date = status === 'done' ? task.completed_at : task.column_entered_at
        if (date) result[task.id] = { status, date }
      })
    })
    return result
  }, [columns, tasksByColumn])
  const confirmedCount = Object.keys(statusDates).length
  // El fin comprometido del tablero manda; sin él, el fin más tardío de las tareas (Gantt).
  const committed = Boolean(board?.end_date)
  const allTasks = useMemo(() => Object.values(tasksByColumn).flat(), [tasksByColumn])
  const deadline = useMemo(() => board?.end_date ?? ganttDeadline(allTasks), [board?.end_date, allTasks])
  // Esfuerzo: cada tarea pesa sus puntos; las sin estimar, el promedio de las estimadas.
  const effort = useMemo(() => effortWeights(allTasks), [allTasks])
  const unit: FlowUnit = unitChoice ?? (effort.estimated > 0 ? 'points' : 'tasks')
  const unitLabel = UNIT_LABELS[unit]
  const today = todayKey()
  // Historial con fechas reales y con el plan inicial completo desde el inicio del
  // proyecto (o desde el primer día con historial, si este es anterior).
  const projectStart = board?.start_date ?? null
  const datedEvents = useMemo(() => {
    const dated = applyStatusDates(events, statusDates)
    if (dated.length === 0) return dated
    const firstDay = dated.reduce((min, event) => {
      const day = localDateToKey(new Date(event.occurred_at))
      return day < min ? day : min
    }, localDateToKey(new Date(dated[0].occurred_at)))
    const scopeStart = projectStart && projectStart < firstDay ? projectStart : firstDay
    return anchorInitialScope(dated, initialScopeTasks(events), scopeStart)
  }, [events, statusDates, projectStart])
  // Las dos series (puntos y tareas): la elegida se grafica y la otra sirve para contrastar la fecha.
  const pointsSeries = useMemo(
    () => (effort.estimated > 0 ? buildDailyFlow(datedEvents, today, (taskId) => effort.weights.get(taskId) ?? effort.fallback) : null),
    [datedEvents, today, effort],
  )
  const tasksSeries = useMemo(() => buildDailyFlow(datedEvents, today), [datedEvents, today])
  const workingDays = boardWorkingDays(board)
  const numbers = useMemo(() => activityNumbers(columns, tasksByColumn), [columns, tasksByColumn])
  const pendingBase = useMemo<PendingTaskBase[]>(
    () =>
      columns.flatMap((column) => {
        const status = resolveColumnStatus(column)
        if (status === 'done') return []
        return (tasksByColumn[column.id] ?? []).map((task) => ({
          id: task.id,
          number: numbers.get(task.id) ?? null,
          title: task.title,
          status,
          endDate: task.end_date,
        }))
      }),
    [columns, tasksByColumn, numbers],
  )
  // Análisis completo en cada unidad: la elegida se muestra; la otra sirve para
  // contrastar y para el informe interactivo, que permite alternarlas.
  const analyses = useMemo(() => {
    const common = { deadline, projectStart, workingDays, committed, pending: pendingBase }
    const byPoints = pointsSeries
      ? analyzeFlow({
        ...common,
        unit: UNIT_LABELS.points,
        allPoints: pointsSeries,
        other: { label: 'tareas', allPoints: tasksSeries },
        weightOf: (taskId) => effort.weights.get(taskId) ?? effort.fallback,
        effort,
      })
      : null
    const byTasks = analyzeFlow({
      ...common,
      unit: UNIT_LABELS.tasks,
      allPoints: tasksSeries,
      other: pointsSeries ? { label: 'puntos', allPoints: pointsSeries } : null,
      weightOf: () => 1,
    })
    return { points: byPoints, tasks: byTasks }
  }, [deadline, projectStart, workingDays, committed, pendingBase, pointsSeries, tasksSeries, effort])
  const analysis = (unit === 'points' ? analyses.points : null) ?? analyses.tasks
  const forecast = analysis?.forecast ?? null
  const points = useMemo(() => analysis?.points ?? [], [analysis])
  const burndown = analysis?.burndown ?? null
  const interpretation = analysis ? analysis.interpretations[view] : null
  const weeklyRows = useMemo(
    () => points.filter((point, index) => weekdayNumber(point.day) === 2 || index === points.length - 1).reverse(),
    [points],
  )

  /** Datos comunes de los informes; el generador elegido se carga solo al descargar. */
  async function handleDownloadReport(format: 'pdf' | 'html') {
    if (!board || !analysis) return
    setExporting(format)
    try {
      const metadata = user?.user_metadata as { full_name?: string; name?: string } | undefined
      const reportPending: FlowReportPendingTask[] = columns.flatMap((column) => {
        const status = resolveColumnStatus(column)
        if (status === 'done') return []
        return (tasksByColumn[column.id] ?? []).map((task) => ({
          number: numbers.get(task.id) ?? null,
          title: task.title,
          column: column.name,
          status,
          effort: taskEffort(task)?.value ?? null,
          endDate: task.end_date,
        }))
      })
      const common = {
        board: { name: board.name, description: board.description },
        author: metadata?.full_name || metadata?.name || user?.email?.split('@')[0] || '',
        deadlineName: committed ? 'Fin comprometido' : 'Fin planificado (Gantt)',
        workingDays,
        effort,
        pending: reportPending,
        confirmedCount,
      }
      if (format === 'pdf') {
        const { downloadFlowReport } = await import('../lib/flowReport')
        await downloadFlowReport({ ...common, analysis, measuredInPoints: analysis.unit.short === 'pts' })
      } else if (analyses.tasks) {
        const { downloadFlowReportHtml } = await import('../lib/flowReportHtml')
        downloadFlowReportHtml({
          ...common,
          analyses: { points: analyses.points, tasks: analyses.tasks },
          defaultUnit: analysis.unit.short === 'pts' ? 'points' : 'tasks',
        })
      }
    } catch (err) {
      window.alert(err instanceof Error ? `No se pudo generar el informe: ${err.message}` : 'No se pudo generar el informe.')
    } finally {
      setExporting(null)
    }
  }

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

  const risk = forecast ? riskMessage(forecast, committed, unit) : null
  const deadlineName = committed ? 'Fin comprometido' : 'Fin planificado (Gantt)'
  const unestimated = effort.total - effort.estimated
  const donePercent = forecast && forecast.current.total > 0 ? Math.round((forecast.current.done / forecast.current.total) * 100) : 0
  const behind = burndown?.deviation !== null && burndown?.deviation !== undefined && burndown.deviation > 0

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
            <p className="mt-2 text-sm text-slate-400">Burndown y flujo acumulado (CFD) con proyección de entrega</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {analysis && (
              <>
                <button type="button" onClick={() => void handleDownloadReport('pdf')} disabled={exporting !== null} className="btn-mint-primary px-4 py-2 text-sm font-semibold">
                  {exporting === 'pdf' ? 'Generando PDF…' : 'Descargar informe PDF'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownloadReport('html')}
                  disabled={exporting !== null}
                  className="btn-ghost px-4 py-2 text-sm"
                  title="Archivo HTML con gráficos interactivos: se abre en cualquier navegador y permite alternar puntos y tareas"
                >
                  {exporting === 'html' ? 'Generando…' : 'Informe interactivo (HTML)'}
                </button>
              </>
            )}
            <Link to={`/dashboard/gantt/${board.id}`} className="btn-ghost px-4 py-2 text-sm">Diagrama Gantt</Link>
          </div>
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
                    El trabajo en progreso pasó de {number.format(forecast.wipBefore)} a {number.format(forecast.wipNow)} {unitLabel.long} en {WIP_TREND_DAYS} días sin que aumente al mismo ritmo lo completado. La banda «En progreso» se está ensanchando: revisa bloqueos antes de que afecten al Gantt.
                  </p>
                </div>
              </section>
            )}

            <div className="flow-metrics mt-4">
              <div className="stat-tile">
                <span className="stat-value">{donePercent} %</span>
                <span className="stat-label">Completado · {number.format(forecast.current.done)} de {number.format(forecast.current.total)} {unitLabel.short}</span>
              </div>
              <div className="stat-tile">
                <span className="stat-value">{number.format(forecast.remaining)}</span>
                <span className="stat-label">{unitLabel.short} restantes{burndown && burndown.scopeAdded !== 0 ? ` · alcance ${burndown.scopeAdded > 0 ? '+' : '−'}${number.format(Math.abs(burndown.scopeAdded))}` : ''}</span>
              </div>
              <div className={`stat-tile ${behind ? 'stat-tile-alert' : ''}`}>
                <span className="stat-value">
                  {burndown?.deviation !== null && burndown?.deviation !== undefined
                    ? `${burndown.deviation > 0 ? '+' : burndown.deviation < 0 ? '−' : ''}${number.format(Math.abs(burndown.deviation))}`
                    : '—'}
                </span>
                <span className="stat-label">
                  {burndown?.deviation === null || burndown?.deviation === undefined
                    ? 'Vs. línea ideal · sin plazo'
                    : burndown.deviation > 0 ? `${unitLabel.short} por encima del ideal` : burndown.deviation < 0 ? `${unitLabel.short} de adelanto vs. ideal` : 'Justo en la línea ideal'}
                </span>
              </div>
              <div className="stat-tile">
                <span className="stat-value">{number.format(forecast.throughputPerWeek)}</span>
                <span className="stat-label">{unitLabel.short}/semana · últimos {forecast.windowDays} días</span>
              </div>
              <div className={`stat-tile ${forecast.bottleneck ? 'stat-tile-alert' : ''}`}>
                <span className="stat-value">{number.format(forecast.wipNow)}</span>
                <span className="stat-label">{unitLabel.short} en progreso · hace {WIP_TREND_DAYS} días: {number.format(forecast.wipBefore)}</span>
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
                <span className="stat-label">
                  {deadlineName}{burndown?.workingDaysLeft ? ` · ${burndown.workingDaysLeft} días hábiles` : ''}
                </span>
              </div>
            </div>

            <section className="effort-coverage mt-4" aria-label="Cobertura de la estimación">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[var(--text-main)]">
                  {effort.estimated === 0 ? (
                    <>Ninguna tarea tiene esfuerzo estimado: el progreso se mide contando tareas. Asigna puntos desde «Editar» en cada tarea para un cálculo más preciso.</>
                  ) : (
                    <>
                      <strong className="text-white">{effort.estimated} de {effort.total}</strong> tareas con esfuerzo estimado ({number.format(effort.estimatedPoints)} pts).
                      {unestimated > 0 && ` Las ${unestimated} sin estimar cuentan como ${number.format(effort.fallback)} pts (el promedio).`}
                    </>
                  )}
                </p>
                {effort.total > 0 && (
                  <div className="effort-meter mt-2" role="meter" aria-valuemin={0} aria-valuemax={effort.total} aria-valuenow={effort.estimated} aria-label="Tareas estimadas">
                    <span style={{ width: `${(effort.estimated / effort.total) * 100}%` }} />
                  </div>
                )}
              </div>
              <div className="flow-zoom-group" role="group" aria-label="Unidad de medida">
                {(['points', 'tasks'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`flow-zoom-preset ${unit === option ? 'flow-zoom-preset-active' : ''}`}
                    aria-pressed={unit === option}
                    disabled={option === 'points' && effort.estimated === 0}
                    onClick={() => setUnitChoice(option)}
                  >
                    {option === 'points' ? 'Puntos de esfuerzo' : 'Tareas'}
                  </button>
                ))}
              </div>
            </section>

            <section className="glass-panel mt-4 overflow-hidden rounded-2xl">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-white">{view === 'burndown' ? 'Burndown' : 'Flujo acumulado'}</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {view === 'burndown'
                      ? `Trabajo restante (${unitLabel.long}) cada día frente a la línea ideal, que baja en días hábiles desde el inicio hasta el ${deadlineName.toLowerCase()}. Si la línea real queda por encima, el equipo va atrasado; los triángulos marcan trabajo añadido.`
                      : `Cada banda es el trabajo (${unitLabel.long}) en ese estado cada día. Si «En progreso» se ensancha, el trabajo se está acumulando. A la derecha de «Hoy», la línea discontinua proyecta lo completado al ritmo real del equipo.`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flow-zoom-group" role="group" aria-label="Tipo de gráfico">
                    {([['burndown', 'Burndown'], ['cfd', 'Flujo acumulado']] as const).map(([option, label]) => (
                      <button
                        key={option}
                        type="button"
                        className={`flow-zoom-preset ${view === option ? 'flow-zoom-preset-active' : ''}`}
                        aria-pressed={view === option}
                        onClick={() => setView(option)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => setShowTable((value) => !value)} className={`flow-zoom-preset ${showTable ? 'flow-zoom-preset-active' : ''}`} aria-pressed={showTable}>
                    {showTable ? 'Ver gráfico' : 'Ver tabla'}
                  </button>
                </div>
              </div>

              <ul className="flow-legend" aria-label="Leyenda">
                {view === 'burndown' ? (
                  <>
                    <li><span className="flow-swatch-line burndown-swatch-actual" aria-hidden="true" />Restante real</li>
                    <li><span className="flow-swatch-line burndown-swatch-ideal" aria-hidden="true" />Línea ideal</li>
                    <li><span className="flow-swatch-line burndown-swatch-projection" aria-hidden="true" />Proyección al ritmo actual</li>
                    <li><span className="burndown-swatch-scope" aria-hidden="true" />Alcance añadido</li>
                    {workingDays.length < 7 && <li><span className="flow-swatch burndown-swatch-offday" aria-hidden="true" />Día no hábil</li>}
                  </>
                ) : (
                  <>
                    {(['todo', 'in_progress', 'done'] as const).map((status) => (
                      <li key={status}><span className={`flow-swatch flow-key-${status}`} aria-hidden="true" />{flowLabels[status]}</li>
                    ))}
                    <li><span className="flow-swatch-line flow-swatch-projection" aria-hidden="true" />Proyección de lo completado</li>
                  </>
                )}
                <li><span className="flow-swatch-line flow-swatch-deadline" aria-hidden="true" />{deadlineName}</li>
                <li><span className="flow-swatch-line flow-swatch-today" aria-hidden="true" />Hoy</li>
              </ul>

              <div ref={chartRef} className="px-2 pb-4 sm:px-4">
                {showTable ? (
                  <div className="overflow-x-auto">
                    <table className="flow-table">
                      <caption className="sr-only">Trabajo por estado al inicio de cada semana, en {unitLabel.long}</caption>
                      <thead>
                        <tr>
                          <th scope="col">Fecha</th><th scope="col">Listo</th><th scope="col">En progreso</th><th scope="col">Por hacer</th><th scope="col">Total</th>
                          <th scope="col">Restante</th><th scope="col">Ideal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {weeklyRows.map((point) => {
                          const ideal = burndown && point.day >= burndown.start ? burndown.idealAt(point.day) : null
                          return (
                            <tr key={point.day}>
                              <th scope="row">{formatDateKey(point.day)}{point.day === today ? ' (hoy)' : ''}</th>
                              <td>{number.format(point.done)}</td><td>{number.format(point.in_progress)}</td><td>{number.format(point.todo)}</td><td>{number.format(point.total)}</td>
                              <td>{number.format(Math.round((point.total - point.done) * 10) / 10)}</td><td>{ideal !== null ? number.format(ideal) : '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : chartWidth > 0 && points.length > 0 ? (
                  view === 'burndown' && burndown ? (
                    <BurndownChart
                      burndown={burndown}
                      forecast={forecast}
                      width={chartWidth}
                      narrow={narrow}
                      unit={unitLabel.short}
                      workingDays={workingDays}
                      deadlineLabel={committed ? 'Fin comprometido' : 'Fin Gantt'}
                    />
                  ) : (
                    <FlowChart points={points} forecast={forecast} width={chartWidth} narrow={narrow} deadlineLabel={committed ? 'Fin comprometido' : 'Fin Gantt'} />
                  )
                ) : null}
              </div>

              <p className="border-t border-white/10 px-4 py-3 text-xs text-slate-500 sm:px-5">
                {unit === 'points'
                  ? `Se mide en puntos de esfuerzo: cada tarea aporta sus puntos (campo «Esfuerzo» o la sección «Estimación» de su descripción)${unestimated > 0 ? ` y las no estimadas, el promedio (${number.format(effort.fallback)} pts)` : ''}. Así una tarea grande pesa más que una pequeña en la velocidad, lo restante y la proyección. `
                  : 'Se mide contando tareas: todas pesan lo mismo. '}
                Velocidad = trabajo que pasó a «Listo» desde otro estado (menos lo reabierto) en los últimos {THROUGHPUT_WINDOW_DAYS} días; lo creado o importado ya listo no cuenta. Con menos de una semana de historial se divide igualmente por 7 días para no exagerar el ritmo.{confirmedCount > 0 && ` Se usan las fechas reales registradas («Completada el» / «En esta columna desde») de ${confirmedCount} tarea(s).`} La proyección asume que ese ritmo se mantiene y que no se agrega trabajo.
                {burndown && ` El burndown empieza el ${longDate(burndown.start)}${board.start_date && burndown.start === board.start_date ? ' (inicio del proyecto)' : ' (primer día con historial)'} con ${number.format(burndown.baseline)} ${unitLabel.short}; las tareas que llegaron con el tablero (creación o importación inicial) cuentan en el alcance desde ese día, y solo lo agregado después aparece como alcance añadido. La línea ideal no se ajusta a ese alcance añadido, para que se vea como desviación.`}
                {' '}El tiempo de ciclo se estima con la ley de Little (trabajo en progreso ÷ velocidad).
                {forecast.lowConfidence && ' Hay menos de 2 semanas de historial: la proyección es poco fiable todavía.'}
                {' '}El historial anterior a la activación de esta función se reconstruyó de forma aproximada con las fechas de creación y última actualización de cada tarea.
              </p>
            </section>

            {interpretation && <FlowInterpretationPanel interpretation={interpretation} unit={unitLabel.short} unitLong={unitLabel.long} />}
          </>
        )}
      </div>
    </main>
  )
}

export default BoardFlow

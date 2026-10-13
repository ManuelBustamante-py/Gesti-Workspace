import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'

import { projectedRemainingAt, type Burndown, type BurndownPoint } from '../../domain/burndown'
import type { FlowForecast } from '../../domain/cfd'
import { niceScale } from '../../domain/chartZoom'
import { addDays, ALL_DAYS, diffDays, formatDateKey, isWorkingDay, weekdayNumber, type WorkingDays } from '../../domain/dates'

interface BurndownChartProps {
  burndown: Burndown
  forecast: FlowForecast
  width: number
  narrow: boolean
  /** Unidad del eje Y: «pts» o «tareas». */
  unit: string
  workingDays?: WorkingDays
  /** Nombre del plazo en el gráfico («Fin comprometido» o «Fin Gantt»). */
  deadlineLabel?: string
}

/** Con pocos días visibles, cada día real lleva su marcador. */
const MAX_DAYS_WITH_MARKERS = 45

const number = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 })
const shortDate = (day: string) => formatDateKey(day, { day: 'numeric', month: 'short' })
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function signed(value: number) {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${number.format(Math.abs(value))}`
}

/**
 * Burndown: trabajo restante (real) frente a la línea ideal hasta el plazo y la
 * proyección al ritmo medido. Los días no hábiles se sombrean: la línea ideal
 * no baja en ellos.
 */
function BurndownChart({ burndown, forecast, width, narrow, unit, workingDays = ALL_DAYS, deadlineLabel = 'Fin Gantt' }: BurndownChartProps) {
  const [hoverPos, setHoverPos] = useState<number | null>(null)

  const height = narrow ? 280 : 380
  const pad = { top: 28, right: narrow ? 16 : 110, bottom: 34, left: 44 }
  const innerWidth = Math.max(10, width - pad.left - pad.right)
  const innerHeight = height - pad.top - pad.bottom

  const { start, deadline, points, idealAt, baseline } = burndown
  const { today, projectedFinish } = forecast
  const current = points.at(-1)
  const remainingToday = current?.remaining ?? 0

  const end = useMemo(() => {
    const candidates = [addDays(today, 7)]
    if (deadline) candidates.push(addDays(deadline, 2))
    if (projectedFinish) candidates.push(addDays(projectedFinish, 2))
    const latest = candidates.reduce((max, day) => (day > max ? day : max))
    const limit = addDays(today, 365)
    return latest > limit ? limit : latest
  }, [deadline, projectedFinish, today])

  const totalDays = Math.max(1, diffDays(start, end))
  const posOf = (day: string) => diffDays(start, day)
  const xPos = (pos: number) => pad.left + (pos / totalDays) * innerWidth
  const x = (day: string) => xPos(posOf(day))
  const daySpacing = innerWidth / totalDays

  const yMax = Math.max(baseline, ...points.map((point) => point.remaining), 1)
  const scale = niceScale(0, yMax)
  const y = (value: number) => pad.top + innerHeight - ((value - scale.min) / (scale.max - scale.min)) * innerHeight

  const byDay = useMemo(() => new Map(points.map((point) => [point.day, point])), [points])

  // Línea ideal día a día: plana en los días no hábiles.
  const idealEnd = deadline && deadline <= end ? deadline : end
  const idealSegments: string[] = []
  if (deadline) {
    for (let day = start; day <= idealEnd; day = addDays(day, 1)) idealSegments.push(`${x(day)},${y(idealAt(day) ?? 0)}`)
  }
  const idealPath = idealSegments.length > 0 ? `M ${idealSegments.join(' L ')}` : ''

  const actualPath = points.length > 0 ? `M ${points.map((point) => `${x(point.day)},${y(point.remaining)}`).join(' L ')}` : ''
  const projectionEnd = projectedFinish ? (projectedFinish <= end ? projectedFinish : end) : null
  const projectionEndValue = projectionEnd ? projectedRemainingAt(projectionEnd, today, remainingToday, projectedFinish) ?? 0 : 0

  // Sombreado de días no hábiles (solo si se distinguen).
  const nonWorking: string[] = []
  if (workingDays.length < 7 && daySpacing >= 4) {
    for (let pos = 0; pos <= totalDays; pos += 1) {
      const day = addDays(start, pos)
      if (!isWorkingDay(day, workingDays)) nonWorking.push(day)
    }
  }

  // Eje X: cada día si hay espacio; si no, lunes espaciados según el ancho.
  const xTicks: string[] = []
  for (let pos = 0; pos <= totalDays; pos += 1) {
    const day = addDays(start, pos)
    if (daySpacing >= 46) xTicks.push(day)
    else if (weekdayNumber(day) === 2) {
      const tickEvery = Math.max(1, Math.ceil(56 / (daySpacing * 7)))
      if (Math.floor(pos / 7) % tickEvery === 0) xTicks.push(day)
    }
  }

  const showMarkers = points.length <= MAX_DAYS_WITH_MARKERS && daySpacing >= 8
  const scopeMarks = points.filter((point) => point.scopeChange > 0)

  // --- Detalle del día bajo el puntero ---------------------------------------
  const hover = (() => {
    if (hoverPos === null) return null
    const day = addDays(start, hoverPos)
    const point: BurndownPoint | null = byDay.get(day) ?? null
    const ideal = idealAt(day)
    const projected = day > today ? projectedRemainingAt(day, today, remainingToday, projectedFinish) : null
    return { day, point, ideal, projected }
  })()

  function showHover(clientX: number, target: SVGRectElement) {
    const bounds = target.getBoundingClientRect()
    if (bounds.width === 0) return
    const ratio = clamp((clientX - bounds.left) / bounds.width, 0, 1)
    setHoverPos(Math.round(ratio * totalDays))
  }

  function handlePointer(event: PointerEvent<SVGRectElement>) {
    showHover(event.clientX, event.currentTarget)
  }

  function handleKey(event: KeyboardEvent<SVGSVGElement>) {
    const step = event.shiftKey ? 7 : 1
    const base = hoverPos ?? posOf(today)
    let next: number | null = null
    if (event.key === 'ArrowRight') next = Math.min(totalDays, base + step)
    else if (event.key === 'ArrowLeft') next = Math.max(0, base - step)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = totalDays
    else if (event.key === 'Escape') setHoverPos(null)
    else return
    event.preventDefault()
    if (next !== null) setHoverPos(next)
  }

  const todayInRange = today >= start && today <= end
  const deadlineInRange = deadline !== null && deadline >= start && deadline <= end
  const tooltipLeft = hover ? Math.min(Math.max(x(hover.day) + 12, pad.left), width - 210) : 0

  // Etiquetas directas al final de cada línea (no en móvil: allí manda la leyenda).
  const actualLabelY = current ? y(current.remaining) : 0
  const idealTodayY = y(idealAt(today) ?? 0)
  const labelsCollide = deadline !== null && Math.abs(actualLabelY - idealTodayY) < 14

  return (
    <div className="flow-chart" style={{ height }}>
      <svg
        width={width}
        height={height}
        role="img"
        tabIndex={0}
        aria-label={`Burndown del ${shortDate(start)} al ${shortDate(end)}: quedan ${number.format(remainingToday)} ${unit}${burndown.deviation !== null ? `, ${signed(burndown.deviation)} ${unit} respecto de la línea ideal` : ''}. Usa las flechas para recorrer los días.`}
        onKeyDown={handleKey}
        onBlur={() => setHoverPos(null)}
        className="flow-chart-svg"
      >
        {nonWorking.map((day) => (
          <rect key={day} x={x(day) - daySpacing / 2} y={pad.top} width={daySpacing} height={innerHeight} className="burndown-offday" />
        ))}

        {scale.ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={pad.left + innerWidth} y1={y(tick)} y2={y(tick)} className="flow-grid" />
            <text x={pad.left - 8} y={y(tick)} className="flow-axis-label" textAnchor="end" dominantBaseline="middle">{tick}</text>
          </g>
        ))}
        <text x={12} y={pad.top + innerHeight / 2} className="flow-axis-label" textAnchor="middle" transform={`rotate(-90 12 ${pad.top + innerHeight / 2})`}>
          Restante ({unit})
        </text>
        {xTicks.map((day) => (
          <text key={day} x={x(day)} y={height - 12} className="flow-axis-label" textAnchor="middle">{shortDate(day)}</text>
        ))}

        {todayInRange && (
          <rect x={x(today)} y={pad.top} width={Math.max(0, x(end) - x(today))} height={innerHeight} className="flow-future" />
        )}

        {idealPath && <path d={idealPath} className="burndown-ideal" />}
        {actualPath && <path d={actualPath} className="burndown-actual" />}
        {projectionEnd && remainingToday > 0 && (
          <line x1={x(today)} y1={y(remainingToday)} x2={x(projectionEnd)} y2={y(projectionEndValue)} className="burndown-projection" />
        )}

        {showMarkers && points.map((point) => (
          <circle key={point.day} cx={x(point.day)} cy={y(point.remaining)} r={3.5} className="burndown-dot" />
        ))}
        {scopeMarks.map((point) => (
          <path
            key={`scope-${point.day}`}
            d={`M ${x(point.day)} ${y(point.remaining) - 13} l 4.5 7 h -9 Z`}
            className="burndown-scope-mark"
          >
            <title>{`${shortDate(point.day)}: alcance ${signed(point.scopeChange)} ${unit}`}</title>
          </path>
        ))}

        {deadlineInRange && (
          <g>
            <line x1={x(deadline!)} x2={x(deadline!)} y1={pad.top} y2={pad.top + innerHeight} className="flow-deadline" />
            <text x={x(deadline!) - 4} y={pad.top + 12} className="flow-annotation flow-annotation-deadline" textAnchor="end">
              {deadlineLabel} · {shortDate(deadline!)}
            </text>
          </g>
        )}

        {todayInRange && (
          <g>
            <line x1={x(today)} x2={x(today)} y1={pad.top} y2={pad.top + innerHeight} className="flow-today" />
            <text x={x(today)} y={pad.top + innerHeight + 14} className="flow-today-label" textAnchor="middle">Hoy</text>
          </g>
        )}

        {projectedFinish && projectedFinish <= end && remainingToday > 0 && (
          <g>
            <circle cx={x(projectedFinish)} cy={y(0)} r={5} className="burndown-finish-dot" />
            <text
              x={x(projectedFinish) + (narrow ? -8 : 8)}
              y={y(0) - 10}
              className="flow-annotation"
              textAnchor={narrow ? 'end' : 'start'}
            >
              Proyección · {shortDate(projectedFinish)}
            </text>
          </g>
        )}

        {!narrow && current && todayInRange && (
          <g>
            <text x={x(today) + 8} y={actualLabelY - (labelsCollide ? 8 : 0)} className="flow-direct-label" dominantBaseline="middle">
              Real · {number.format(current.remaining)}
            </text>
            {deadline && idealAt(today) !== null && (
              <text x={x(today) + 8} y={idealTodayY + (labelsCollide ? 8 : 0)} className="burndown-ideal-label" dominantBaseline="middle">
                Ideal · {number.format(idealAt(today)!)}
              </text>
            )}
          </g>
        )}

        {hover && (
          <g pointerEvents="none">
            <line x1={x(hover.day)} x2={x(hover.day)} y1={pad.top} y2={pad.top + innerHeight} className="flow-crosshair" />
            {hover.point && <circle cx={x(hover.day)} cy={y(hover.point.remaining)} r={5} className="burndown-dot burndown-dot-active" />}
            {hover.projected !== null && <circle cx={x(hover.day)} cy={y(hover.projected)} r={4} className="burndown-finish-dot" />}
          </g>
        )}

        <rect
          x={pad.left}
          y={pad.top}
          width={innerWidth}
          height={innerHeight}
          fill="transparent"
          className="flow-plot"
          onPointerMove={handlePointer}
          onPointerDown={handlePointer}
          onPointerLeave={() => setHoverPos(null)}
        />
      </svg>

      {hover && (
        <div className="flow-tooltip burndown-tooltip" style={{ left: tooltipLeft, top: pad.top }} role="status">
          <p className="flow-tooltip-date">
            {formatDateKey(hover.day, { weekday: 'short', day: 'numeric', month: 'short' })}
            {!isWorkingDay(hover.day, workingDays) && ' · no hábil'}
          </p>
          {hover.point ? (
            <>
              <p className="flow-tooltip-row">
                <span className="flow-key burndown-key-actual" aria-hidden="true" />
                <strong>{number.format(hover.point.remaining)}</strong> {unit} restantes
              </p>
              {hover.ideal !== null && (
                <p className="flow-tooltip-row">
                  <span className="flow-key burndown-key-ideal" aria-hidden="true" />
                  <strong>{number.format(hover.ideal)}</strong> ideal
                  <span className={hover.point.remaining - hover.ideal > 0 ? 'burndown-behind' : 'burndown-ahead'}>
                    ({signed(Math.round((hover.point.remaining - hover.ideal) * 10) / 10)})
                  </span>
                </p>
              )}
              {hover.point.completed !== 0 && (
                <p className="flow-tooltip-row text-[var(--text-muted)]">Completado ese día: {signed(hover.point.completed)} {unit}</p>
              )}
              {hover.point.scopeChange !== 0 && (
                <p className="flow-tooltip-row text-[var(--text-muted)]">Alcance: {signed(hover.point.scopeChange)} {unit}</p>
              )}
              {baseline > 0 && (
                <p className="flow-tooltip-row text-[var(--text-muted)]">
                  {number.format(Math.max(0, Math.round((1 - hover.point.remaining / baseline) * 100)))} % quemado del inicial
                </p>
              )}
            </>
          ) : (
            <>
              {hover.projected !== null && (
                <p className="flow-tooltip-row">
                  <span className="flow-key burndown-key-projection" aria-hidden="true" />
                  <strong>≈ {number.format(hover.projected)}</strong> {unit} (proyección)
                </p>
              )}
              {hover.ideal !== null && (
                <p className="flow-tooltip-row">
                  <span className="flow-key burndown-key-ideal" aria-hidden="true" />
                  <strong>{number.format(hover.ideal)}</strong> ideal
                </p>
              )}
              {hover.projected === null && hover.ideal === null && (
                <p className="flow-tooltip-row text-[var(--text-muted)]">Sin proyección</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default BurndownChart

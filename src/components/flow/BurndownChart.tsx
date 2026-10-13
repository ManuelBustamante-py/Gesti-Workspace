import { useId, useMemo, useState } from 'react'

import { projectedRemainingAt, type Burndown, type BurndownPoint } from '../../domain/burndown'
import type { FlowForecast } from '../../domain/cfd'
import { niceScale } from '../../domain/chartZoom'
import { addDays, ALL_DAYS, diffDays, formatDateKey, isWorkingDay, weekdayNumber, type WorkingDays } from '../../domain/dates'
import ChartZoomBar from './ChartZoomBar'
import { useChartZoom } from './useChartZoom'

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
 * no baja en ellos. Tiene el mismo zoom que el flujo acumulado; con zoom, el
 * eje Y se ajusta a lo visible.
 */
function BurndownChart({ burndown, forecast, width, narrow, unit, workingDays = ALL_DAYS, deadlineLabel = 'Fin Gantt' }: BurndownChartProps) {
  const [hoverPos, setHoverPos] = useState<number | null>(null)
  const clipId = `burndown-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

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
  const todayPos = posOf(today)
  const zoom = useChartZoom({ totalDays, todayPos, innerWidth, hoverPos, onHover: setHoverPos })
  const { view, zoomed, span, selection, svgRef, plotRef, plotHandlers, handleKey } = zoom

  const xPos = (pos: number) => pad.left + ((pos - view.from) / span) * innerWidth
  const x = (day: string) => xPos(posOf(day))
  const inView = (day: string) => posOf(day) >= view.from && posOf(day) <= view.to
  const daySpacing = innerWidth / span

  const byDay = useMemo(() => new Map(points.map((point) => [point.day, point])), [points])
  const projectedAt = (day: string) => projectedRemainingAt(day, today, remainingToday, projectedFinish)

  // Eje Y: completo sin zoom; con zoom, lo visible (real, ideal y proyección).
  let yLow = 0
  let yHigh = Math.max(baseline, ...points.map((point) => point.remaining), 1)
  if (zoomed) {
    const visible: number[] = []
    for (let pos = Math.floor(view.from); pos <= Math.ceil(view.to); pos += 1) {
      const day = addDays(start, pos)
      const point = byDay.get(day)
      if (point) visible.push(point.remaining)
      const ideal = idealAt(day)
      if (ideal !== null) visible.push(ideal)
      const projected = day >= today ? projectedAt(day) : null
      if (projected !== null) visible.push(projected)
    }
    if (visible.length > 0) {
      yLow = Math.min(...visible)
      yHigh = Math.max(...visible)
    }
  }
  const scale = niceScale(yLow, yHigh)
  const y = (value: number) => pad.top + innerHeight - ((value - scale.min) / (scale.max - scale.min)) * innerHeight
  const clampY = (value: number) => clamp(value, pad.top, pad.top + innerHeight)

  // Línea ideal día a día (plana en los días no hábiles), solo en el tramo visible.
  const firstVisible = addDays(start, Math.max(0, Math.floor(view.from)))
  const lastVisible = addDays(start, Math.min(totalDays, Math.ceil(view.to)))
  const idealEnd = deadline && deadline < lastVisible ? deadline : lastVisible
  const idealSegments: string[] = []
  if (deadline) {
    for (let day = firstVisible; day <= idealEnd; day = addDays(day, 1)) idealSegments.push(`${x(day)},${y(idealAt(day) ?? 0)}`)
  }
  const idealPath = idealSegments.length > 1 ? `M ${idealSegments.join(' L ')}` : ''

  const actualPath = points.length > 0 ? `M ${points.map((point) => `${x(point.day)},${y(point.remaining)}`).join(' L ')}` : ''
  const projectionEnd = projectedFinish ? (projectedFinish <= end ? projectedFinish : end) : null
  const projectionEndValue = projectionEnd ? projectedAt(projectionEnd) ?? 0 : 0

  // Sombreado de días no hábiles (solo si se distinguen).
  const nonWorking: string[] = []
  if (workingDays.length < 7 && daySpacing >= 4) {
    for (let pos = Math.floor(view.from); pos <= Math.ceil(view.to); pos += 1) {
      const day = addDays(start, pos)
      if (!isWorkingDay(day, workingDays)) nonWorking.push(day)
    }
  }

  // Eje X: cada día si hay espacio; si no, lunes espaciados según el ancho.
  const xTicks: string[] = []
  for (let pos = Math.ceil(view.from); pos <= Math.floor(view.to); pos += 1) {
    const day = addDays(start, pos)
    if (daySpacing >= 46) xTicks.push(day)
    else if (weekdayNumber(day) === 2) {
      const tickEvery = Math.max(1, Math.ceil(56 / (daySpacing * 7)))
      // Por número de semana absoluto: al desplazar, las marcas no saltan.
      if (Math.floor(pos / 7) % tickEvery === 0) xTicks.push(day)
    }
  }
  // La etiqueta «Hoy» va justo encima: se omite la fecha que chocaría con ella.
  const axisTicks = xTicks.filter((day) => !inView(today) || day === today || Math.abs(x(day) - x(today)) >= 26)

  const visiblePoints = points.filter((point) => inView(point.day))
  const showMarkers = visiblePoints.length <= MAX_DAYS_WITH_MARKERS && daySpacing >= 8
  const scopeMarks = visiblePoints.filter((point) => point.scopeChange > 0)

  // --- Detalle del día bajo el puntero (solo dentro de la ventana) ----------
  const hover = hoverPos === null || hoverPos < view.from || hoverPos > view.to ? null : (() => {
    const day = addDays(start, hoverPos)
    const point: BurndownPoint | null = byDay.get(day) ?? null
    return { day, point, ideal: idealAt(day), projected: day > today ? projectedAt(day) : null }
  })()

  const deadlineInRange = deadline !== null && deadline >= start && deadline <= end
  const tooltipLeft = hover ? Math.min(Math.max(x(hover.day) + 12, pad.left), width - 210) : 0

  // Etiquetas directas junto a «Hoy» (no en móvil: allí manda la leyenda).
  const actualLabelY = current ? clampY(y(current.remaining)) : 0
  const idealToday = idealAt(today)
  const idealTodayY = clampY(y(idealToday ?? 0))
  const labelsCollide = idealToday !== null && Math.abs(actualLabelY - idealTodayY) < 14

  return (
    <div>
      <ChartZoomBar zoom={zoom} start={start} totalDays={totalDays} narrow={narrow} />

      <div className="flow-chart" style={{ height }}>
        <svg
          ref={svgRef}
          width={width}
          height={height}
          role="img"
          tabIndex={0}
          aria-label={`Burndown del ${shortDate(firstVisible)} al ${shortDate(lastVisible)}: quedan ${number.format(remainingToday)} ${unit}${burndown.deviation !== null ? `, ${signed(burndown.deviation)} ${unit} respecto de la línea ideal` : ''}. Usa las flechas para recorrer los días, + y − para acercar o alejar y 0 para ver todo.`}
          onKeyDown={handleKey}
          onBlur={() => setHoverPos(null)}
          className="flow-chart-svg"
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={pad.left} y={pad.top} width={innerWidth} height={innerHeight} />
            </clipPath>
          </defs>

          {scale.ticks.map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={pad.left + innerWidth} y1={y(tick)} y2={y(tick)} className="flow-grid" />
              <text x={pad.left - 8} y={y(tick)} className="flow-axis-label" textAnchor="end" dominantBaseline="middle">{tick}</text>
            </g>
          ))}
          <text x={12} y={pad.top + innerHeight / 2} className="flow-axis-label" textAnchor="middle" transform={`rotate(-90 12 ${pad.top + innerHeight / 2})`}>
            Restante ({unit})
          </text>
          {axisTicks.map((day) => (
            <text key={day} x={x(day)} y={height - 12} className="flow-axis-label" textAnchor="middle">{shortDate(day)}</text>
          ))}

          {/* Todo lo que depende del rango visible se recorta al área del gráfico. */}
          <g clipPath={`url(#${clipId})`}>
            {nonWorking.map((day) => (
              <rect key={day} x={x(day) - daySpacing / 2} y={pad.top} width={daySpacing} height={innerHeight} className="burndown-offday" />
            ))}
            {today <= end && (
              <rect x={x(today)} y={pad.top} width={Math.max(0, x(end) - x(today))} height={innerHeight} className="flow-future" />
            )}

            {idealPath && <path d={idealPath} className="burndown-ideal" />}
            {actualPath && <path d={actualPath} className="burndown-actual" />}
            {projectionEnd && remainingToday > 0 && (
              <line x1={x(today)} y1={y(remainingToday)} x2={x(projectionEnd)} y2={y(projectionEndValue)} className="burndown-projection" />
            )}

            {showMarkers && visiblePoints.map((point) => (
              <circle key={point.day} cx={x(point.day)} cy={y(point.remaining)} r={3.5} className="burndown-dot" />
            ))}
            {scopeMarks.map((point) => (
              <path key={`scope-${point.day}`} d={`M ${x(point.day)} ${y(point.remaining) - 13} l 4.5 7 h -9 Z`} className="burndown-scope-mark">
                <title>{`${shortDate(point.day)}: alcance ${signed(point.scopeChange)} ${unit}`}</title>
              </path>
            ))}

            {deadlineInRange && (
              <line x1={x(deadline!)} x2={x(deadline!)} y1={pad.top} y2={pad.top + innerHeight} className="flow-deadline" />
            )}

            {/* Tramo que se está seleccionando para acercar */}
            {selection && (
              <rect
                x={xPos(selection.from)}
                y={pad.top}
                width={Math.max(0, xPos(selection.to) - xPos(selection.from))}
                height={innerHeight}
                className="flow-selection"
              />
            )}
          </g>

          {deadlineInRange && inView(deadline!) && (
            <text x={x(deadline!) - 4} y={pad.top + 12} className="flow-annotation flow-annotation-deadline" textAnchor="end">
              {deadlineLabel} · {shortDate(deadline!)}
            </text>
          )}

          {inView(today) && (
            <g>
              <line x1={x(today)} x2={x(today)} y1={pad.top} y2={pad.top + innerHeight} className="flow-today" />
              <text x={x(today)} y={pad.top + innerHeight + 14} className="flow-today-label" textAnchor="middle">Hoy</text>
            </g>
          )}

          {projectedFinish && projectedFinish <= end && remainingToday > 0 && inView(projectedFinish) && (
            <g>
              <circle cx={x(projectedFinish)} cy={clampY(y(0))} r={5} className="burndown-finish-dot" />
              <text x={x(projectedFinish) + (narrow ? -8 : 8)} y={clampY(y(0)) - 10} className="flow-annotation" textAnchor={narrow ? 'end' : 'start'}>
                Proyección · {shortDate(projectedFinish)}
              </text>
            </g>
          )}

          {!narrow && current && inView(today) && (
            <g>
              <text x={x(today) + 8} y={actualLabelY - (labelsCollide ? 8 : 0)} className="flow-direct-label" dominantBaseline="middle">
                Real · {number.format(current.remaining)}
              </text>
              {idealToday !== null && (
                <text x={x(today) + 8} y={idealTodayY + (labelsCollide ? 8 : 0)} className="burndown-ideal-label" dominantBaseline="middle">
                  Ideal · {number.format(idealToday)}
                </text>
              )}
            </g>
          )}

          {hover && (
            <g pointerEvents="none">
              <line x1={x(hover.day)} x2={x(hover.day)} y1={pad.top} y2={pad.top + innerHeight} className="flow-crosshair" />
              {hover.point && <circle cx={x(hover.day)} cy={clampY(y(hover.point.remaining))} r={5} className="burndown-dot burndown-dot-active" />}
              {hover.projected !== null && <circle cx={x(hover.day)} cy={clampY(y(hover.projected))} r={4} className="burndown-finish-dot" />}
            </g>
          )}

          <rect
            ref={plotRef}
            x={pad.left}
            y={pad.top}
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            className="flow-plot"
            {...plotHandlers}
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
    </div>
  )
}

export default BurndownChart

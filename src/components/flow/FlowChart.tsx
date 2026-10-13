import { useId, useMemo, useState } from 'react'

import { addDays, diffDays, formatDateKey, weekdayNumber } from '../../domain/dates'
import { flowLabels, type FlowForecast, type FlowPoint, type FlowStatus } from '../../domain/cfd'
import { niceScale } from '../../domain/chartZoom'
import ChartZoomBar from './ChartZoomBar'
import { useChartZoom } from './useChartZoom'

/** De abajo hacia arriba, como es habitual en un CFD: lo terminado es la base. */
const STACK: FlowStatus[] = ['done', 'in_progress', 'todo']

interface FlowChartProps {
  points: FlowPoint[]
  forecast: FlowForecast
  width: number
  narrow: boolean
  /** Nombre del plazo en el gráfico («Fin comprometido» o «Fin Gantt»). */
  deadlineLabel?: string
}

type HoverInfo = { day: string; point: FlowPoint | null; projectedDone: number | null }

function shortDate(day: string) {
  return formatDateKey(day, { day: 'numeric', month: 'short' })
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Diagrama de flujo acumulado con proyección. Historial a la izquierda de «Hoy»,
 * proyección a la derecha, fin planificado del Gantt como línea vertical.
 * Se puede acercar en el tiempo (arrastrando, con Ctrl + rueda o con los
 * botones); con zoom, el eje Y se ajusta a lo visible para ver el detalle.
 */
function FlowChart({ points, forecast, width, narrow, deadlineLabel = 'Fin Gantt' }: FlowChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const clipId = `flow-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  const height = narrow ? 280 : 380
  const pad = { top: 28, right: narrow ? 16 : 120, bottom: 34, left: 40 }
  const innerWidth = Math.max(10, width - pad.left - pad.right)
  const innerHeight = height - pad.top - pad.bottom

  const { today, current, projectedFinish, deadline } = forecast
  const start = points[0].day
  const end = useMemo(() => {
    const candidates = [today, addDays(today, 14)]
    if (deadline) candidates.push(addDays(deadline, 3))
    if (projectedFinish) candidates.push(addDays(projectedFinish, 3))
    const latest = candidates.reduce((max, day) => (day > max ? day : max))
    // La proyección se muestra como máximo un año hacia el futuro.
    const limit = addDays(today, 365)
    return latest > limit ? limit : latest
  }, [deadline, projectedFinish, today])

  const totalDays = Math.max(1, diffDays(start, end))
  const todayPos = diffDays(start, today)
  const zoom = useChartZoom({ totalDays, todayPos, innerWidth, hoverPos: hoverIndex, onHover: setHoverIndex })
  const { view, zoomed, span, selection, svgRef, plotRef, plotHandlers, handleKey } = zoom

  const posOf = (day: string) => diffDays(start, day)
  const xPos = (pos: number) => pad.left + ((pos - view.from) / span) * innerWidth
  const x = (day: string) => xPos(posOf(day))
  const inView = (day: string) => posOf(day) >= view.from && posOf(day) <= view.to

  const projectionEnd = projectedFinish && projectedFinish <= end ? projectedFinish : projectedFinish ? end : null
  const projectedDoneAt = (day: string) => {
    if (!projectedFinish || day < today) return null
    const span = Math.max(1, diffDays(today, projectedFinish))
    const progress = Math.min(1, diffDays(today, day) / span)
    return Math.round((current.done + (current.total - current.done) * progress) * 10) / 10
  }

  // Eje Y: completo sin zoom; con zoom se ajusta a lo visible para ver el detalle.
  let yLow = 0
  let yHigh = Math.max(...points.map((point) => point.total), current.total, 1)
  if (zoomed) {
    const visible: number[] = []
    points.forEach((point) => {
      const pos = posOf(point.day)
      if (pos >= Math.floor(view.from) && pos <= Math.ceil(view.to)) visible.push(point.done, point.total)
    })
    if (view.to > todayPos) {
      const firstFuture = addDays(start, Math.max(Math.ceil(view.from), todayPos))
      visible.push(current.total, projectedDoneAt(firstFuture) ?? current.done)
    }
    if (visible.length > 0) {
      yLow = Math.min(...visible)
      yHigh = Math.max(...visible)
    }
  }
  const scale = niceScale(yLow, yHigh)
  const y = (value: number) => pad.top + innerHeight - ((value - scale.min) / (scale.max - scale.min)) * innerHeight
  const clampY = (value: number) => clamp(value, pad.top, pad.top + innerHeight)

  // Bordes superiores acumulados de cada banda.
  const levels = points.map((point) => ({
    done: point.done,
    in_progress: point.done + point.in_progress,
    todo: point.total,
  }))
  const bandPath = (status: FlowStatus) => {
    const lowerKey = STACK[STACK.indexOf(status) - 1]
    const upper = levels.map((level, index) => `${x(points[index].day)},${y(level[status])}`)
    const lower = levels
      .map((level, index) => `${x(points[index].day)},${y(lowerKey ? level[lowerKey] : 0)}`)
      .reverse()
    return `M ${upper.join(' L ')} L ${lower.join(' L ')} Z`
  }
  const boundary = (status: FlowStatus) =>
    `M ${levels.map((level, index) => `${x(points[index].day)},${y(level[status])}`).join(' L ')}`

  // Eje X: cada día si hay espacio; si no, lunes espaciados según el ancho.
  const daySpacing = innerWidth / span
  const xTicks: string[] = []
  for (let pos = Math.ceil(view.from); pos <= Math.floor(view.to); pos += 1) {
    const day = addDays(start, pos)
    if (daySpacing >= 46) {
      xTicks.push(day)
    } else if (weekdayNumber(day) === 2) {
      const tickEvery = Math.max(1, Math.ceil(56 / (daySpacing * 7)))
      // Por número de semana absoluto: al desplazar, las marcas no saltan.
      if (Math.floor(pos / 7) % tickEvery === 0) xTicks.push(day)
    }
  }

  // Un día recorrido que quedó fuera de la ventana (tras acercar) no se muestra.
  const hover: HoverInfo | null = hoverIndex === null || hoverIndex < view.from || hoverIndex > view.to ? null : (() => {
    const day = addDays(start, hoverIndex)
    const point = points.find((item) => item.day === day) ?? null
    return { day, point, projectedDone: day > today ? projectedDoneAt(day) : null }
  })()

  // Etiquetas directas al final del historial, solo si la banda es lo bastante alta.
  const lastLevel = levels[levels.length - 1]
  const directLabels = STACK.map((status) => {
    const lowerKey = STACK[STACK.indexOf(status) - 1]
    const top = clampY(y(lastLevel[status]))
    const bottom = clampY(y(lowerKey ? lastLevel[lowerKey] : 0))
    return { status, middle: (top + bottom) / 2, fits: bottom - top >= 14, value: current[status] }
  })

  const tooltipLeft = hover ? Math.min(Math.max(x(hover.day) + 12, pad.left), width - 190) : 0
  const viewStartDay = addDays(start, Math.round(view.from))
  const viewEndDay = addDays(start, Math.round(view.to))

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
          aria-label={`Diagrama de flujo acumulado del ${shortDate(viewStartDay)} al ${shortDate(viewEndDay)}. Usa las flechas para recorrer los días, + y − para acercar o alejar y 0 para ver todo.`}
          onKeyDown={handleKey}
          onBlur={() => setHoverIndex(null)}
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
              <text x={pad.left - 8} y={y(tick)} className="flow-axis-label" textAnchor="end" dominantBaseline="middle">
                {tick}
              </text>
            </g>
          ))}
          {xTicks.filter((day) => !inView(today) || day === today || Math.abs(x(day) - x(today)) >= 26).map((day) => (
            <text key={day} x={x(day)} y={height - 12} className="flow-axis-label" textAnchor="middle">
              {shortDate(day)}
            </text>
          ))}

          {/* Todo lo que depende del rango visible se recorta al área del gráfico. */}
          <g clipPath={`url(#${clipId})`}>
            {/* Zona de proyección (futuro) */}
            <rect x={x(today)} y={pad.top} width={Math.max(0, x(end) - x(today))} height={innerHeight} className="flow-future" />

            {/* Bandas acumuladas con separación de 2 px en el color de fondo */}
            {STACK.map((status) => (
              <path key={status} d={bandPath(status)} className={`flow-band flow-band-${status}`} />
            ))}
            <path d={boundary('done')} className="flow-gap" />
            <path d={boundary('in_progress')} className="flow-gap" />

            {/* Alcance actual proyectado y línea de entrega estimada */}
            <line x1={x(today)} x2={x(end)} y1={y(current.total)} y2={y(current.total)} className="flow-scope" />
            {projectionEnd && current.done < current.total && (
              <line
                x1={x(today)}
                y1={y(current.done)}
                x2={x(projectionEnd)}
                y2={y(projectedFinish === projectionEnd ? current.total : projectedDoneAt(projectionEnd) ?? current.total)}
                className="flow-projection"
              />
            )}

            {/* Fin planificado del Gantt */}
            {deadline && deadline >= start && deadline <= end && (
              <line x1={x(deadline)} x2={x(deadline)} y1={pad.top} y2={pad.top + innerHeight} className="flow-deadline" />
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

          {todayPos <= view.to && (
            <text x={Math.max(x(today), pad.left) + 6} y={pad.top - 10} className="flow-annotation">Proyección →</text>
          )}

          {/* Hoy */}
          {inView(today) && (
            <g>
              <line x1={x(today)} x2={x(today)} y1={pad.top} y2={pad.top + innerHeight} className="flow-today" />
              <text x={x(today)} y={pad.top + innerHeight + 14} className="flow-today-label" textAnchor="middle">Hoy</text>
            </g>
          )}

          {deadline && deadline >= start && deadline <= end && inView(deadline) && (
            <text x={x(deadline) - 4} y={pad.top + 12} className="flow-annotation flow-annotation-deadline" textAnchor="end">
              {deadlineLabel} · {shortDate(deadline)}
            </text>
          )}

          {/* Fin proyectado */}
          {projectedFinish && projectedFinish <= end && inView(projectedFinish) && current.done < current.total && (
            <g>
              <circle cx={x(projectedFinish)} cy={y(current.total)} r={5} className="flow-finish-dot" />
              <text
                x={x(projectedFinish) + (narrow ? -8 : 8)}
                y={y(current.total) - 10}
                className="flow-annotation"
                textAnchor={narrow ? 'end' : 'start'}
              >
                Proyección · {shortDate(projectedFinish)}
              </text>
            </g>
          )}

          {/* Etiquetas directas (no en móvil: allí manda la leyenda) */}
          {!narrow &&
            inView(today) &&
            directLabels.map(({ status, middle, fits, value }) =>
              fits ? (
                <text key={status} x={x(today) + 8} y={middle} className="flow-direct-label" dominantBaseline="middle">
                  {flowLabels[status]} · {value}
                </text>
              ) : null,
            )}

          {/* Línea de seguimiento */}
          {hover && (
            <g pointerEvents="none">
              <line x1={x(hover.day)} x2={x(hover.day)} y1={pad.top} y2={pad.top + innerHeight} className="flow-crosshair" />
              {hover.projectedDone !== null && (
                <circle cx={x(hover.day)} cy={clampY(y(hover.projectedDone))} r={4} className="flow-finish-dot" />
              )}
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
          <div className="flow-tooltip" style={{ left: tooltipLeft, top: pad.top }} role="status">
            <p className="flow-tooltip-date">{formatDateKey(hover.day, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
            {hover.point ? (
              <>
                {[...STACK].reverse().map((status) => (
                  <p key={status} className="flow-tooltip-row">
                    <span className={`flow-key flow-key-${status}`} aria-hidden="true" />
                    <strong>{hover.point![status]}</strong> {flowLabels[status]}
                  </p>
                ))}
                <p className="flow-tooltip-row text-[var(--text-muted)]">Total {hover.point.total}</p>
              </>
            ) : hover.projectedDone !== null ? (
              <p className="flow-tooltip-row">
                <span className="flow-key flow-key-projection" aria-hidden="true" />
                <strong>≈ {hover.projectedDone}</strong> listas (proyección)
              </p>
            ) : (
              <p className="flow-tooltip-row text-[var(--text-muted)]">Sin proyección</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default FlowChart

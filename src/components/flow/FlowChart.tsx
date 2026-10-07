import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'

import { addDays, diffDays, formatDateKey, weekdayNumber } from '../../domain/dates'
import { flowLabels, type FlowForecast, type FlowPoint, type FlowStatus } from '../../domain/cfd'

/** De abajo hacia arriba, como es habitual en un CFD: lo terminado es la base. */
const STACK: FlowStatus[] = ['done', 'in_progress', 'todo']

interface FlowChartProps {
  points: FlowPoint[]
  forecast: FlowForecast
  width: number
  narrow: boolean
}

type HoverInfo = { day: string; point: FlowPoint | null; projectedDone: number | null }

function niceMax(value: number) {
  if (value <= 4) return 4
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => value / candidate <= 5) ?? magnitude * 10
  return Math.ceil(value / step) * step
}

function shortDate(day: string) {
  return formatDateKey(day, { day: 'numeric', month: 'short' })
}

/**
 * Diagrama de flujo acumulado con proyección. Historial a la izquierda de «Hoy»,
 * proyección a la derecha, fin planificado del Gantt como línea vertical.
 */
function FlowChart({ points, forecast, width, narrow }: FlowChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

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
  const yMax = niceMax(Math.max(...points.map((point) => point.total), current.total, 1))
  const x = (day: string) => pad.left + (diffDays(start, day) / totalDays) * innerWidth
  const y = (value: number) => pad.top + innerHeight - (value / yMax) * innerHeight

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

  const projectionEnd = projectedFinish && projectedFinish <= end ? projectedFinish : projectedFinish ? end : null
  const projectedDoneAt = (day: string) => {
    if (!projectedFinish || day < today) return null
    const span = Math.max(1, diffDays(today, projectedFinish))
    const progress = Math.min(1, diffDays(today, day) / span)
    return Math.round((current.done + (current.total - current.done) * progress) * 10) / 10
  }

  // Ejes: líneas horizontales y una marca por semana (lunes) según el espacio.
  const yTicks = Array.from({ length: 5 }, (_, index) => (yMax / 4) * index)
  const mondays: string[] = []
  for (let day = start; day <= end; day = addDays(day, 1)) if (weekdayNumber(day) === 2) mondays.push(day)
  const weekSpacing = (7 / totalDays) * innerWidth
  const tickEvery = Math.max(1, Math.ceil(56 / Math.max(weekSpacing, 1)))
  const xTicks = mondays.filter((_, index) => index % tickEvery === 0)

  const allDays = totalDays + 1
  const hover: HoverInfo | null = hoverIndex === null ? null : (() => {
    const day = addDays(start, hoverIndex)
    const point = points.find((item) => item.day === day) ?? null
    return { day, point, projectedDone: day > today ? projectedDoneAt(day) : null }
  })()

  function handlePointer(event: PointerEvent<SVGRectElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - bounds.left) / bounds.width
    setHoverIndex(Math.min(allDays - 1, Math.max(0, Math.round(ratio * totalDays))))
  }

  function handleKey(event: KeyboardEvent<SVGSVGElement>) {
    const step = event.shiftKey ? 7 : 1
    const base = hoverIndex ?? diffDays(start, today)
    if (event.key === 'ArrowRight') setHoverIndex(Math.min(allDays - 1, base + step))
    else if (event.key === 'ArrowLeft') setHoverIndex(Math.max(0, base - step))
    else if (event.key === 'Home') setHoverIndex(0)
    else if (event.key === 'End') setHoverIndex(allDays - 1)
    else if (event.key === 'Escape') setHoverIndex(null)
    else return
    event.preventDefault()
  }

  // Etiquetas directas al final del historial, solo si la banda es lo bastante alta.
  const lastLevel = levels[levels.length - 1]
  const directLabels = STACK.map((status) => {
    const lowerKey = STACK[STACK.indexOf(status) - 1]
    const top = y(lastLevel[status])
    const bottom = y(lowerKey ? lastLevel[lowerKey] : 0)
    return { status, middle: (top + bottom) / 2, fits: bottom - top >= 14, value: current[status] }
  })

  const tooltipLeft = hover ? Math.min(Math.max(x(hover.day) + 12, pad.left), width - 190) : 0

  return (
    <div className="flow-chart" style={{ height }}>
      <svg
        width={width}
        height={height}
        role="img"
        tabIndex={0}
        aria-label={`Diagrama de flujo acumulado desde ${shortDate(start)} con proyección hasta ${shortDate(end)}. Usa las flechas para recorrer los días.`}
        onKeyDown={handleKey}
        onBlur={() => setHoverIndex(null)}
        className="flow-chart-svg"
      >
        {/* Zona de proyección (futuro) */}
        <rect x={x(today)} y={pad.top} width={Math.max(0, x(end) - x(today))} height={innerHeight} className="flow-future" />
        <text x={x(today) + 6} y={pad.top - 10} className="flow-annotation">Proyección →</text>

        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={pad.left + innerWidth} y1={y(tick)} y2={y(tick)} className="flow-grid" />
            <text x={pad.left - 8} y={y(tick)} className="flow-axis-label" textAnchor="end" dominantBaseline="middle">
              {Math.round(tick)}
            </text>
          </g>
        ))}
        {xTicks.map((day) => (
          <text key={day} x={x(day)} y={height - 12} className="flow-axis-label" textAnchor="middle">
            {shortDate(day)}
          </text>
        ))}

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

        {/* Hoy */}
        <line x1={x(today)} x2={x(today)} y1={pad.top} y2={pad.top + innerHeight} className="flow-today" />
        <text x={x(today)} y={pad.top + innerHeight + 14} className="flow-today-label" textAnchor="middle">Hoy</text>

        {/* Fin planificado del Gantt */}
        {deadline && deadline >= start && deadline <= end && (
          <g>
            <line x1={x(deadline)} x2={x(deadline)} y1={pad.top} y2={pad.top + innerHeight} className="flow-deadline" />
            <text x={x(deadline) - 4} y={pad.top + 12} className="flow-annotation flow-annotation-deadline" textAnchor="end">
              Fin Gantt · {shortDate(deadline)}
            </text>
          </g>
        )}

        {/* Fin proyectado */}
        {projectedFinish && projectedFinish <= end && current.done < current.total && (
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
              <circle cx={x(hover.day)} cy={y(hover.projectedDone)} r={4} className="flow-finish-dot" />
            )}
          </g>
        )}

        <rect
          x={pad.left}
          y={pad.top}
          width={innerWidth}
          height={innerHeight}
          fill="transparent"
          onPointerMove={handlePointer}
          onPointerDown={handlePointer}
          onPointerLeave={() => setHoverIndex(null)}
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
  )
}

export default FlowChart

/**
 * Ventana visible de un gráfico temporal, en días desde el inicio del eje
 * (puede tener decimales). `total` es el largo completo del eje en días.
 */
export interface ChartView {
  from: number
  to: number
}

/** Lo más cerca que se puede acercar: una semana (o todo, si el eje es más corto). */
export const MIN_VIEW_DAYS = 7

export function fullView(total: number): ChartView {
  return { from: 0, to: total }
}

export function isFullView(view: ChartView, total: number) {
  return view.from <= 0 && view.to >= total
}

/** Ajusta la ventana al eje: largo mínimo, sin salirse por ningún lado. */
export function clampView(view: ChartView, total: number): ChartView {
  const minSpan = Math.min(MIN_VIEW_DAYS, total)
  const span = Math.min(total, Math.max(minSpan, view.to - view.from))
  const from = Math.min(Math.max(0, view.from), total - span)
  return { from, to: from + span }
}

/**
 * Acerca (factor < 1) o aleja (factor > 1) manteniendo `anchor` en el mismo
 * lugar de la pantalla, como al hacer zoom con la rueda sobre un punto.
 */
export function zoomView(view: ChartView, factor: number, anchor: number, total: number): ChartView {
  const span = view.to - view.from
  const ratio = span > 0 ? (anchor - view.from) / span : 0.5
  const minSpan = Math.min(MIN_VIEW_DAYS, total)
  const nextSpan = Math.min(total, Math.max(minSpan, span * factor))
  const from = anchor - ratio * nextSpan
  return clampView({ from, to: from + nextSpan }, total)
}

/** Desplaza la ventana `days` días (negativo: hacia el pasado). */
export function panView(view: ChartView, days: number, total: number): ChartView {
  return clampView({ from: view.from + days, to: view.to + days }, total)
}

/** Ventana entre dos puntos en cualquier orden (selección arrastrando). */
export function rangeView(a: number, b: number, total: number): ChartView {
  return clampView({ from: Math.min(a, b), to: Math.max(a, b) }, total)
}

/**
 * Escala del eje Y con pasos enteros «redondos» (1, 2, 5, 10, 20…) que cubre
 * [min, max] en unas `divisions` divisiones. Nunca baja de 0.
 */
export function niceScale(min: number, max: number, divisions = 5) {
  const low = Math.max(0, Math.min(min, max))
  const high = Math.max(low + 1, max)
  const raw = (high - low) / divisions
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = Math.max(1, [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw) ?? magnitude * 10)
  const scaleMin = Math.floor(low / step) * step
  let scaleMax = Math.ceil(high / step) * step
  if (scaleMax <= scaleMin) scaleMax = scaleMin + step
  const ticks: number[] = []
  for (let tick = scaleMin; tick <= scaleMax + step / 2; tick += step) ticks.push(tick)
  return { min: scaleMin, max: scaleMax, ticks }
}

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

import { clampView, fullView, isFullView, panView, rangeView, zoomView, type ChartView } from '../../domain/chartZoom'

/** Cada «+» deja visible el 60 % del rango; cada «−» lo deshace. */
export const ZOOM_IN = 0.6
/** Píxeles que hay que arrastrar para que cuente como selección y no como clic. */
const DRAG_THRESHOLD = 6

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Zoom temporal compartido por los gráficos de flujo: arrastrar para acercar un
 * tramo, Ctrl + rueda (o pellizco), rueda horizontal o Mayús + rueda para
 * desplazar, botones y teclado. La ventana se guarda en días, así que
 * sobrevive a cambios de ancho.
 *
 * `hoverPos` es el día bajo el puntero (lo maneja el gráfico): sirve de ancla
 * al acercar con botones o teclado.
 */
export function useChartZoom({
  totalDays,
  todayPos,
  innerWidth,
  hoverPos,
  onHover,
}: {
  totalDays: number
  todayPos: number
  innerWidth: number
  hoverPos: number | null
  onHover: (pos: number | null) => void
}) {
  // null = todo el eje.
  const [rawView, setRawView] = useState<ChartView | null>(null)
  const [selection, setSelection] = useState<ChartView | null>(null)
  const dragRef = useRef<{ startPos: number; startX: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const plotRef = useRef<SVGRectElement>(null)

  const view = rawView ? clampView(rawView, totalDays) : fullView(totalDays)
  const zoomed = !isFullView(view, totalDays)
  const span = view.to - view.from

  const updateView = (next: (current: ChartView) => ChartView) =>
    setRawView((current) => {
      const result = next(current ? clampView(current, totalDays) : fullView(totalDays))
      return isFullView(result, totalDays) ? null : result
    })

  const zoomBy = (factor: number) => {
    const anchor = hoverPos ?? (view.from + view.to) / 2
    updateView((currentView) => zoomView(currentView, factor, anchor, totalDays))
  }
  const panBy = (fraction: number) => updateView((currentView) => panView(currentView, (currentView.to - currentView.from) * fraction, totalDays))
  const resetZoom = () => setRawView(null)
  const applyPreset = (preset: ChartView | null) => setRawView(preset && !isFullView(preset, totalDays) ? preset : null)

  const presets: Array<{ label: string; view: ChartView | null }> = [
    { label: 'Todo', view: null },
    { label: 'Último mes', view: rangeView(todayPos - 30, todayPos + 7, totalDays) },
    { label: 'Proyección', view: rangeView(todayPos - 7, totalDays, totalDays) },
  ]
  const isActivePreset = (preset: ChartView | null) =>
    preset ? zoomed && Math.abs(view.from - preset.from) < 0.01 && Math.abs(view.to - preset.to) < 0.01 : !zoomed

  /** Posición (en días) bajo el puntero, dentro del área del gráfico. */
  const posAt = (clientX: number, currentView: ChartView = view) => {
    const bounds = plotRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width === 0) return currentView.from
    const ratio = clamp((clientX - bounds.left) / bounds.width, 0, 1)
    return currentView.from + ratio * (currentView.to - currentView.from)
  }

  // React registra la rueda como pasiva: hace falta un listener propio para
  // poder cancelar el scroll de la página.
  const wheelRef = useRef<(event: WheelEvent) => void>(() => undefined)
  useEffect(() => {
    wheelRef.current = (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        const factor = Math.exp(clamp(event.deltaY, -100, 100) * 0.004)
        updateView((currentView) => zoomView(currentView, factor, posAt(event.clientX, currentView), totalDays))
      } else if (zoomed && (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))) {
        event.preventDefault()
        const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY
        const bounds = plotRef.current?.getBoundingClientRect()
        const pixels = bounds?.width || innerWidth
        updateView((currentView) => panView(currentView, (delta / pixels) * (currentView.to - currentView.from), totalDays))
      }
    }
  })
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const listener = (event: WheelEvent) => wheelRef.current(event)
    svg.addEventListener('wheel', listener, { passive: false })
    return () => svg.removeEventListener('wheel', listener)
  }, [])

  const showHover = (clientX: number) => onHover(clamp(Math.round(posAt(clientX)), 0, totalDays))

  const plotHandlers = {
    onPointerDown(event: PointerEvent<SVGRectElement>) {
      showHover(event.clientX)
      // Arrastrar para seleccionar solo con mouse: en pantallas táctiles el dedo
      // sigue desplazando la página y un toque muestra el detalle del día.
      if (event.pointerType === 'mouse' && event.button === 0) {
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = { startPos: posAt(event.clientX), startX: event.clientX }
      }
    },
    onPointerMove(event: PointerEvent<SVGRectElement>) {
      showHover(event.clientX)
      const drag = dragRef.current
      if (drag && Math.abs(event.clientX - drag.startX) > DRAG_THRESHOLD) {
        const pos = posAt(event.clientX)
        setSelection({ from: Math.min(drag.startPos, pos), to: Math.max(drag.startPos, pos) })
      }
    },
    onPointerUp(event: PointerEvent<SVGRectElement>) {
      const drag = dragRef.current
      dragRef.current = null
      setSelection(null)
      if (drag && Math.abs(event.clientX - drag.startX) > DRAG_THRESHOLD) {
        const pos = posAt(event.clientX)
        updateView(() => rangeView(drag.startPos, pos, totalDays))
      }
    },
    onPointerCancel() {
      dragRef.current = null
      setSelection(null)
    },
    onPointerLeave() {
      if (!dragRef.current) onHover(null)
    },
    onDoubleClick: resetZoom,
  }

  /** Flechas, Inicio/Fin, + / − / 0 y Escape. Devuelve true si atendió la tecla. */
  function handleKey(event: KeyboardEvent<SVGSVGElement>) {
    const step = event.shiftKey ? 7 : 1
    const base = hoverPos ?? clamp(todayPos, Math.ceil(view.from), Math.floor(view.to))
    let next: number | null = null
    if (event.key === 'ArrowRight') next = Math.min(totalDays, base + step)
    else if (event.key === 'ArrowLeft') next = Math.max(0, base - step)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = totalDays
    else if (event.key === '+' || event.key === '=') zoomBy(ZOOM_IN)
    else if (event.key === '-' || event.key === '_') zoomBy(1 / ZOOM_IN)
    else if (event.key === '0') resetZoom()
    else if (event.key === 'Escape') onHover(null)
    else return false
    event.preventDefault()
    if (next === null) return true
    onHover(next)
    // Si el día recorrido sale de la ventana, la ventana lo acompaña.
    if (next < view.from) updateView((currentView) => panView(currentView, next - currentView.from, totalDays))
    else if (next > view.to) updateView((currentView) => panView(currentView, next - currentView.to, totalDays))
    return true
  }

  return {
    view,
    zoomed,
    span,
    selection,
    svgRef,
    plotRef,
    presets,
    isActivePreset,
    applyPreset,
    zoomBy,
    panBy,
    resetZoom,
    plotHandlers,
    handleKey,
  }
}

export type ChartZoom = ReturnType<typeof useChartZoom>

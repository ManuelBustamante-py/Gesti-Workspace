import { addDays, formatDateKey } from '../../domain/dates'
import { MIN_VIEW_DAYS } from '../../domain/chartZoom'
import { ZOOM_IN, type ChartZoom } from './useChartZoom'

const shortDate = (day: string) => formatDateKey(day, { day: 'numeric', month: 'short' })

/** Barra de zoom de los gráficos de flujo: acercar, alejar, desplazar y rangos rápidos. */
function ChartZoomBar({ zoom, start, totalDays, narrow }: { zoom: ChartZoom; start: string; totalDays: number; narrow: boolean }) {
  const { view, zoomed, span } = zoom
  const minSpan = Math.min(MIN_VIEW_DAYS, totalDays)

  return (
    <div className="flow-zoom-bar">
      <div className="flow-zoom-group" role="group" aria-label="Zoom del gráfico">
        <button type="button" className="flow-zoom-button" onClick={() => zoom.zoomBy(ZOOM_IN)} disabled={span <= minSpan + 0.01} aria-label="Acercar" title="Acercar (+)">+</button>
        <button type="button" className="flow-zoom-button" onClick={() => zoom.zoomBy(1 / ZOOM_IN)} disabled={!zoomed} aria-label="Alejar" title="Alejar (−)">−</button>
        <button type="button" className="flow-zoom-button" onClick={() => zoom.panBy(-0.5)} disabled={!zoomed || view.from <= 0} aria-label="Ver días anteriores" title="Días anteriores">◀</button>
        <button type="button" className="flow-zoom-button" onClick={() => zoom.panBy(0.5)} disabled={!zoomed || view.to >= totalDays} aria-label="Ver días siguientes" title="Días siguientes">▶</button>
      </div>
      <div className="flow-zoom-group" role="group" aria-label="Rango visible">
        {zoom.presets.map((preset) => {
          const active = zoom.isActivePreset(preset.view)
          return (
            <button
              key={preset.label}
              type="button"
              className={`flow-zoom-preset ${active ? 'flow-zoom-preset-active' : ''}`}
              aria-pressed={active}
              onClick={() => zoom.applyPreset(preset.view)}
            >
              {preset.label}
            </button>
          )
        })}
      </div>
      <span className="flow-zoom-range" aria-live="polite">
        {shortDate(addDays(start, Math.round(view.from)))} – {shortDate(addDays(start, Math.round(view.to)))}
      </span>
      {!narrow && <span className="flow-zoom-hint">Arrastra sobre el gráfico para acercar · Ctrl + rueda · doble clic restablece</span>}
    </div>
  )
}

export default ChartZoomBar

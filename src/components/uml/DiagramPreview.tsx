import { useEffect, useMemo, useRef, useState } from 'react'

import { diagramError, svgSize } from '../../domain/diagramSvg'
import { renderPlantUml } from '../../lib/plantuml'

export type RenderState =
  | { status: 'loading' }
  | { status: 'ready'; svg: string; error: { line: number | null; message: string } | null }
  | { status: 'failed'; message: string }

interface DiagramPreviewProps {
  source: string
  /** Avisa cada nuevo dibujo (para exportar y marcar la línea con error). */
  onRendered?: (state: RenderState) => void
}

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
const RENDER_DELAY_MS = 350

/**
 * Vista previa en vivo. El SVG se muestra como imagen (<img>), no insertado en
 * la página: si un diagrama compartido trae enlaces javascript: o scripts, no
 * se ejecutan.
 */
function DiagramPreview({ source, onRendered }: DiagramPreviewProps) {
  const [state, setState] = useState<RenderState>({ status: 'loading' })
  const [lastSvg, setLastSvg] = useState<string | null>(null)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const onRenderedRef = useRef(onRendered)
  useEffect(() => {
    onRenderedRef.current = onRendered
  }, [onRendered])

  // Se dibuja un momento después de dejar de escribir; un dibujo viejo nunca pisa a uno nuevo.
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      renderPlantUml(source)
        .then((svg) => {
          if (cancelled) return
          const next: RenderState = { status: 'ready', svg, error: diagramError(svg) }
          setState(next)
          setLastSvg(svg)
          onRenderedRef.current?.(next)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          const next: RenderState = { status: 'failed', message: error instanceof Error ? error.message : String(error) }
          setState(next)
          onRenderedRef.current?.(next)
        })
    }, RENDER_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [source])

  // Mientras se dibuja de nuevo se mantiene el último diagrama: no parpadea al escribir.
  const svg = lastSvg
  const image = useMemo(() => (svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null), [svg])
  const size = useMemo(() => (svg ? svgSize(svg) : null), [svg])

  const zoomIndex = zoom === 'fit' ? -1 : ZOOM_STEPS.indexOf(zoom)
  const stepZoom = (direction: 1 | -1) => {
    const current = zoom === 'fit' ? 1 : zoom
    const next = direction > 0 ? ZOOM_STEPS.find((step) => step > current) : [...ZOOM_STEPS].reverse().find((step) => step < current)
    if (next) setZoom(next)
  }

  return (
    <div className="uml-preview">
      <div className="uml-preview-bar">
        <span className="uml-preview-status" role="status">
          {state.status === 'loading' && !svg && 'Cargando el motor de diagramas…'}
          {state.status === 'ready' && state.error && (
            <span className="text-[#f3a3b3]">
              ⚠ {state.error.message}{state.error.line ? ` en la línea ${state.error.line}` : ''}
            </span>
          )}
          {state.status === 'ready' && !state.error && <span className="text-[var(--text-muted)]">Vista previa al día</span>}
          {state.status === 'failed' && <span className="text-[#f3a3b3]">⚠ {state.message}</span>}
        </span>
        <div className="flex items-center gap-1" role="group" aria-label="Zoom de la vista previa">
          <button type="button" className="flow-zoom-button" onClick={() => stepZoom(-1)} disabled={zoomIndex === 0} aria-label="Alejar">−</button>
          <button type="button" className="flow-zoom-preset" onClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')} title="Alternar entre ajustar y tamaño real">
            {zoom === 'fit' ? 'Ajustado' : `${Math.round(zoom * 100)}%`}
          </button>
          <button type="button" className="flow-zoom-button" onClick={() => stepZoom(1)} disabled={zoomIndex === ZOOM_STEPS.length - 1} aria-label="Acercar">+</button>
        </div>
      </div>
      <div className="uml-preview-canvas">
        {image && size ? (
          <img
            src={image}
            alt="Vista previa del diagrama"
            className={zoom === 'fit' ? 'uml-preview-fit' : undefined}
            style={zoom === 'fit' ? undefined : { width: size.width * zoom, maxWidth: 'none' }}
            draggable={false}
          />
        ) : (
          <p className="p-6 text-sm text-slate-500">{state.status === 'failed' ? 'No se pudo dibujar el diagrama.' : 'Dibujando…'}</p>
        )}
      </div>
    </div>
  )
}

export default DiagramPreview

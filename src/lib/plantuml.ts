/**
 * Motor de PlantUML en el navegador (@plantuml/core, PlantUML compilado a
 * JavaScript con TeaVM, licencia MIT). Sin servidor ni API externa: los
 * archivos se sirven desde este mismo sitio y se cargan solo al abrir un
 * diagrama (~4 MB el motor y ~1,4 MB Graphviz).
 */
import plantumlUrl from '@plantuml/core/plantuml.js?url'
import vizUrl from '@plantuml/core/viz-global.js?url'
import themesUrl from '@plantuml/core/themes.js?url'
import emojiUrl from '@plantuml/core/emoji.js?url'
import openiconicUrl from '@plantuml/core/openiconic.js?url'

type RenderToString = (lines: string[], onSuccess: (svg: string) => void, onError: (error: unknown) => void) => void

declare global {
  interface Window {
    /** Gancho del motor para cargar recursos bajo demanda (emoji.js, openiconic.js…). */
    PLANTUML_STDLIB_LOADER?: (name: string, ok: () => void, fail: (message: string) => void) => boolean | void
  }
}

/** Recursos opcionales que el motor pide solo si un diagrama los usa (<:emoji:>, <&icono>). */
const ON_DEMAND_FILES: Record<string, string> = {
  'emoji.js': emojiUrl,
  'openiconic.js': openiconicUrl,
}

const scripts = new Map<string, Promise<void>>()

/** Carga un script clásico una sola vez (el motor se comunica por variables globales). */
function loadScript(url: string) {
  let pending = scripts.get(url)
  if (!pending) {
    pending = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = url
      script.async = false
      script.onload = () => resolve()
      script.onerror = () => {
        scripts.delete(url)
        reject(new Error('No se pudo cargar el motor de diagramas. Revisa tu conexión y vuelve a intentarlo.'))
      }
      document.head.appendChild(script)
    })
    scripts.set(url, pending)
  }
  return pending
}

let engine: Promise<RenderToString> | null = null

function loadEngine() {
  engine ??= (async () => {
    // El motor pide emoji.js y openiconic.js por nombre: se le entregan los
    // archivos de este sitio. Lo que no viene incluido falla con un mensaje claro.
    window.PLANTUML_STDLIB_LOADER = (name, ok, fail) => {
      const url = ON_DEMAND_FILES[name]
      if (!url) {
        fail(`«${name}» no está incluido en el motor de diagramas de la plataforma.`)
        return true
      }
      loadScript(url).then(ok, (error: Error) => fail(error.message))
      return true
    }
    // Graphviz y los temas deben existir antes que el motor.
    await Promise.all([loadScript(vizUrl), loadScript(themesUrl)])
    const module = (await import(/* @vite-ignore */ plantumlUrl)) as { renderToString: RenderToString }
    return module.renderToString
  })().catch((error) => {
    engine = null
    throw error
  })
  return engine
}

// El motor no es reentrante: los dibujos se hacen de a uno, en orden.
let queue: Promise<unknown> = Promise.resolve()

export function renderPlantUml(source: string): Promise<string> {
  const job = queue.then(async () => {
    const render = await loadEngine()
    return new Promise<string>((resolve, reject) => {
      try {
        render(source.split(/\r\n|\r|\n/), resolve, (error) => reject(new Error(String(error))))
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  })
  queue = job.catch(() => undefined)
  return job
}

/** Precarga el motor (al abrir la sección de diagramas) para que el primer dibujo sea rápido. */
export function preloadPlantUml() {
  void loadEngine().catch(() => undefined)
}

/** Texto visible de un SVG (sin etiquetas ni entidades básicas). */
function svgText(svg: string) {
  return svg
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}

/**
 * Si PlantUML dibujó un error (lo hace dentro del propio SVG), devuelve la
 * línea y el motivo; null si el diagrama es válido.
 */
export function diagramError(svg: string): { line: number | null; message: string } | null {
  const text = svgText(svg)
  if (/Syntax Error\?/.test(text)) {
    const line = /\(line (\d+)\)/.exec(text)
    return { line: line ? Number(line[1]) : null, message: 'Error de sintaxis' }
  }
  if (/Diagram not supported by this release|is not recognized/.test(text)) {
    return { line: 1, message: 'Tipo de diagrama no soportado por el motor' }
  }
  return null
}

/** Tamaño natural del SVG en píxeles (atributos width/height o viewBox). */
export function svgSize(svg: string): { width: number; height: number } {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? ''
  const attribute = (name: string) => Number.parseFloat(new RegExp(`\\b${name}="([\\d.]+)`).exec(root)?.[1] ?? '')
  let width = attribute('width')
  let height = attribute('height')
  if (!(width > 0 && height > 0)) {
    const viewBox = /\bviewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(root)
    width = Number(viewBox?.[1] ?? 0)
    height = Number(viewBox?.[2] ?? 0)
  }
  return { width: width > 0 ? width : 800, height: height > 0 ? height : 600 }
}

/**
 * Limpia un SVG antes de descargarlo: un diagrama compartido podría traer
 * scripts o enlaces javascript: que se ejecutarían al abrir el archivo.
 */
export function sanitizeSvg(svg: string) {
  return svg
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(xlink:)?href\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '')
}

/** Nombre de archivo seguro a partir del nombre del diagrama. */
export function diagramFileName(name: string, extension: string) {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
  return `${base || 'diagrama'}.${extension}`
}

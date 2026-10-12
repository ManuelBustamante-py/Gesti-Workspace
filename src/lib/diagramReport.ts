import type { jsPDF as JsPdf } from 'jspdf'

import type { Finding, Interpretation } from '../domain/uml/interpret'
import { svgToCanvas } from './diagramExport'

export type ReportImage = { dataUrl: string; width: number; height: number }

export type DiagramReportInput = {
  name: string
  typeName: string
  generatedAt: Date
  image: ReportImage | null
  interpretation: Interpretation | null
  /** Por qué no hay interpretación (tipo sin análisis, código ilegible). */
  unavailable?: string
}

const PAGE_MARGIN = 48
const FOOTER = 28
const COLORS = {
  text: [33, 37, 41],
  muted: [108, 117, 125],
  rule: [222, 226, 230],
  accent: [74, 88, 92],
  warning: [200, 70, 95],
  info: [190, 140, 50],
  ok: [46, 140, 90],
} as const
const LEVEL_TITLES: Record<Finding['level'], string> = { warning: 'A revisar', info: 'Sugerencias', ok: 'Correcto' }

/**
 * Las fuentes estándar del PDF usan WinAnsi: tildes, ñ, «» y comillas sí;
 * flechas y símbolos no. Se reemplazan por equivalentes legibles.
 */
const REPLACEMENTS: Record<string, string> = { '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '≈': '~', '≤': '<=', '≥': '>=', '≠': '!=', '✓': '', '⚠': '', 'ℹ': '', '·': '·', ' ': ' ' }
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
export function pdfText(text: string) {
  return [...text.replace(/\r/g, '')]
    .map((char) => REPLACEMENTS[char] ?? (char.charCodeAt(0) <= 0xff || WIN_ANSI_EXTRA.has(char) ? char : '?'))
    .join('')
    .replace(/[ \t]+$/gm, '')
}

const dateFormat = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Arma el informe: encabezado, imagen del diagrama y la interpretación estructurada. */
export function buildDiagramReport(JsPDF: typeof JsPdf, input: DiagramReportInput): JsPdf {
  const wide = input.image ? input.image.width > input.image.height * 1.15 : false
  const doc = new JsPDF({ unit: 'pt', format: 'a4', orientation: wide ? 'landscape' : 'portrait' })
  let pageWidth = doc.internal.pageSize.getWidth()
  let pageHeight = doc.internal.pageSize.getHeight()
  let contentWidth = pageWidth - PAGE_MARGIN * 2
  let y = PAGE_MARGIN

  const color = (rgb: readonly number[]) => doc.setTextColor(rgb[0], rgb[1], rgb[2])
  const newPage = () => {
    // El texto sigue en vertical aunque la imagen haya ido en una hoja apaisada.
    doc.addPage('a4', 'portrait')
    pageWidth = doc.internal.pageSize.getWidth()
    pageHeight = doc.internal.pageSize.getHeight()
    contentWidth = pageWidth - PAGE_MARGIN * 2
    y = PAGE_MARGIN
  }
  const ensure = (height: number) => {
    if (y + height > pageHeight - PAGE_MARGIN - FOOTER) newPage()
  }
  /** Párrafo con salto de línea y de página; `indent` desplaza todo el bloque. */
  const paragraph = (text: string, options: { size?: number; bold?: boolean; italic?: boolean; rgb?: readonly number[]; indent?: number; gap?: number } = {}) => {
    const size = options.size ?? 10
    const indent = options.indent ?? 0
    doc.setFont('helvetica', options.bold ? 'bold' : options.italic ? 'italic' : 'normal')
    doc.setFontSize(size)
    color(options.rgb ?? COLORS.text)
    const lineHeight = size * 1.38
    const lines = doc.splitTextToSize(pdfText(text), contentWidth - indent) as string[]
    for (const line of lines) {
      ensure(lineHeight)
      doc.text(line, PAGE_MARGIN + indent, y + size)
      y += lineHeight
    }
    y += options.gap ?? 4
    return lines.length
  }
  const heading = (text: string) => {
    ensure(40)
    y += 10
    paragraph(text, { size: 13, bold: true, rgb: COLORS.accent, gap: 2 })
    doc.setDrawColor(COLORS.rule[0], COLORS.rule[1], COLORS.rule[2])
    doc.setLineWidth(0.8)
    doc.line(PAGE_MARGIN, y, PAGE_MARGIN + contentWidth, y)
    y += 10
  }
  /** Ítem con viñeta de color (o número) y sangría colgante. */
  const item = (text: string, marker: { rgb: readonly number[]; label?: string }, indent = 0) => {
    const size = 10
    const textIndent = indent + (marker.label ? 22 : 14)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(size)
    const lines = doc.splitTextToSize(pdfText(text), contentWidth - textIndent) as string[]
    ensure(size * 1.38)
    if (marker.label) {
      doc.setFont('helvetica', 'bold')
      color(marker.rgb)
      doc.text(marker.label, PAGE_MARGIN + indent + 16, y + size, { align: 'right' })
      doc.setFont('helvetica', 'normal')
    } else {
      doc.setFillColor(marker.rgb[0], marker.rgb[1], marker.rgb[2])
      doc.circle(PAGE_MARGIN + indent + 4, y + size * 0.62, 2.6, 'F')
    }
    color(COLORS.text)
    for (const line of lines) {
      ensure(size * 1.38)
      doc.text(line, PAGE_MARGIN + textIndent, y + size)
      y += size * 1.38
    }
    y += 3
  }

  // --- Encabezado ---------------------------------------------------------------------
  paragraph('INFORME DEL DIAGRAMA', { size: 8, bold: true, rgb: COLORS.muted, gap: 0 })
  paragraph(input.name, { size: 20, bold: true, gap: 0 })
  paragraph(`${input.typeName} · Generado el ${dateFormat.format(input.generatedAt)}`, { size: 9, rgb: COLORS.muted, gap: 10 })

  // --- Imagen -------------------------------------------------------------------------
  if (input.image) {
    const available = pageHeight - y - PAGE_MARGIN - FOOTER
    const scale = Math.min(contentWidth / input.image.width, available / input.image.height, 1.5)
    const width = input.image.width * scale
    const height = input.image.height * scale
    const x = PAGE_MARGIN + (contentWidth - width) / 2
    doc.addImage(input.image.dataUrl, 'PNG', x, y, width, height, undefined, 'FAST')
    doc.setDrawColor(COLORS.rule[0], COLORS.rule[1], COLORS.rule[2])
    doc.setLineWidth(0.6)
    doc.rect(x - 6, y - 6, width + 12, height + 12)
    y += height + 18
    if (wide) newPage()
  } else {
    paragraph('No se pudo incluir la imagen del diagrama.', { italic: true, rgb: COLORS.muted })
  }

  // --- Interpretación -------------------------------------------------------------------
  const interpretation = input.interpretation
  heading('Lo que dice el diagrama')
  if (!interpretation) paragraph(input.unavailable ?? 'Este tipo de diagrama no tiene interpretación automática.', { italic: true, rgb: COLORS.muted })
  else {
    for (const sentence of interpretation.summary) {
      if (sentence.startsWith('•')) item(sentence.replace(/^•\s*/, ''), { rgb: COLORS.accent })
      else paragraph(sentence)
    }
    if (interpretation.steps?.length) {
      y += 4
      paragraph('Recorrido paso a paso', { size: 11, bold: true, rgb: COLORS.accent, gap: 2 })
      for (const step of interpretation.steps) {
        const indent = step.depth * 16
        if (step.kind === 'group') {
          y += 2
          paragraph(step.text, { bold: true, italic: false, rgb: COLORS.info, indent, gap: 2 })
        } else item(step.text, { rgb: COLORS.muted, label: `${step.number}.` }, indent)
      }
    }
  }

  heading('Coherencia')
  if (interpretation) {
    const findings = interpretation.findings
    const warnings = findings.filter((finding) => finding.level === 'warning').length
    const infos = findings.filter((finding) => finding.level === 'info').length
    paragraph(
      findings.length === 0 ? 'No se encontraron incoherencias con las reglas de la notación.' : `${warnings} a revisar · ${infos} sugerencia${infos === 1 ? '' : 's'}`,
      { bold: true, rgb: findings.length === 0 || (!warnings && !infos) ? COLORS.ok : warnings ? COLORS.warning : COLORS.info, gap: 6 },
    )
    for (const level of ['warning', 'info', 'ok'] as const) {
      const group = findings.filter((finding) => finding.level === level)
      if (!group.length) continue
      paragraph(`${LEVEL_TITLES[level]} (${group.length})`, { size: 10.5, bold: true, rgb: COLORS[level], gap: 2 })
      for (const finding of group) item(finding.text, { rgb: COLORS[level] })
      y += 4
    }
  } else paragraph('Sin interpretación, no hay revisión de coherencia.', { italic: true, rgb: COLORS.muted })
  y += 6
  paragraph('Análisis automático según las reglas de la notación: revisa que coincida con lo que quieres expresar.', { size: 8.5, italic: true, rgb: COLORS.muted })

  // --- Pie de página ----------------------------------------------------------------------
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    const width = doc.internal.pageSize.getWidth()
    const height = doc.internal.pageSize.getHeight()
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    color(COLORS.muted)
    doc.text(pdfText(`Gesti - Workspace · ${input.name}`), PAGE_MARGIN, height - PAGE_MARGIN / 2 - 4)
    doc.text(`Página ${page} de ${pages}`, width - PAGE_MARGIN, height - PAGE_MARGIN / 2 - 4, { align: 'right' })
  }
  return doc
}

/** Genera y descarga el informe en PDF. jsPDF se carga solo al usarlo. */
export async function downloadDiagramReport(svg: string | null, input: Omit<DiagramReportInput, 'image'>, fileName: string) {
  const [{ jsPDF }, image] = await Promise.all([
    import('jspdf'),
    svg
      ? svgToCanvas(svg, 2)
          .then(({ canvas, width, height }) => ({ dataUrl: canvas.toDataURL('image/png'), width, height }))
          // Sin imagen el informe sigue siendo útil: se avisa dentro del PDF.
          .catch(() => null)
      : Promise.resolve(null),
  ])
  buildDiagramReport(jsPDF, { ...input, image }).save(fileName)
}

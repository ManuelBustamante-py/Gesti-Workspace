import type { jsPDF as JsPdf } from 'jspdf'

import type { Finding, Interpretation, InterpretationFact } from '../domain/uml/interpret'
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
const REPLACEMENTS: Record<string, string> = { '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '≈': '~', '≤': '<=', '≥': '>=', '≠': '!=', ' ': ' ' }
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
export function pdfText(text: string) {
  return [...text.replace(/\r/g, '')]
    // Los demás símbolos (✓ ⚠ ◆ ● ◇…) se omiten: el texto que los acompaña ya dice lo mismo.
    .map((char) => REPLACEMENTS[char] ?? (char.charCodeAt(0) <= 0xff || WIN_ANSI_EXTRA.has(char) ? char : ''))
    .join('')
    .replace(/ {2,}/g, ' ')
    .replace(/^ +/gm, '')
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
    // Un título nunca queda solo al pie: debe caber junto a algo de su contenido.
    ensure(80)
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

  /** Cifras clave en recuadros, hasta cuatro por fila. */
  const facts = (items: InterpretationFact[]) => {
    const perRow = Math.min(4, items.length)
    const gap = 8
    const width = (contentWidth - gap * (perRow - 1)) / perRow
    const height = 38
    for (let start = 0; start < items.length; start += perRow) {
      ensure(height + gap)
      items.slice(start, start + perRow).forEach((entry, index) => {
        const x = PAGE_MARGIN + index * (width + gap)
        doc.setFillColor(246, 247, 248)
        doc.setDrawColor(COLORS.rule[0], COLORS.rule[1], COLORS.rule[2])
        doc.roundedRect(x, y, width, height, 4, 4, 'FD')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7)
        color(COLORS.muted)
        doc.text(pdfText(entry.label.toUpperCase()), x + 8, y + 13, { maxWidth: width - 16 })
        doc.setFontSize(13)
        color(COLORS.text)
        doc.text(pdfText(entry.value), x + 8, y + 30, { maxWidth: width - 16 })
      })
      y += height + gap
    }
    y += 4
  }

  /** Tabla con encabezado sombreado, filas alternadas y encabezado repetido al cambiar de página. */
  const drawTable = (columns: string[], rows: string[][]) => {
    const size = 8.5
    const pad = 4
    const lineHeight = size * 1.3
    doc.setFontSize(size)
    // Cada columna mide al menos su palabra más larga (para no cortar nombres); el resto
    // del ancho se reparte según la línea más larga de cada columna.
    const measure = (index: number, unit: (text: string) => string[]) => {
      let widest = 0
      doc.setFont('helvetica', 'bold')
      for (const piece of unit(pdfText(columns[index]))) widest = Math.max(widest, doc.getTextWidth(piece))
      for (const row of rows) {
        doc.setFont('helvetica', index === 0 ? 'bold' : 'normal')
        for (const piece of unit(pdfText(row[index] ?? ''))) widest = Math.max(widest, doc.getTextWidth(piece))
      }
      // +1: margen para que la palabra más larga no se corte por redondeo.
      return widest + pad * 2 + 1
    }
    const minimum = columns.map((_, index) => Math.min(150, measure(index, (text) => text.split(/\s+/))))
    const natural = columns.map((_, index) => Math.min(240, measure(index, (text) => text.split('\n'))))
    const minTotal = minimum.reduce((sum, value) => sum + value, 0)
    let widths: number[]
    if (minTotal >= contentWidth) widths = minimum.map((value) => (value / minTotal) * contentWidth)
    else {
      const weights = natural.map((value, index) => Math.max(0, value - minimum[index]))
      const weightTotal = weights.reduce((sum, value) => sum + value, 0)
      const extra = contentWidth - minTotal
      widths = minimum.map((value, index) => value + (weightTotal ? (extra * weights[index]) / weightTotal : extra / columns.length))
    }
    /** Corta con la misma fuente con que se dibuja (encabezado y primera columna van en negrita). */
    const wrap = (text: string, index: number, header: boolean) => {
      doc.setFont('helvetica', header || index === 0 ? 'bold' : 'normal')
      doc.setFontSize(size)
      return doc.splitTextToSize(pdfText(text), widths[index] - pad * 2) as string[]
    }
    const drawRow = (cells: string[], header: boolean, shaded: boolean) => {
      const lines = cells.map((cell, index) => wrap(cell, index, header))
      const height = Math.max(...lines.map((cellLines) => cellLines.length)) * lineHeight + pad * 2
      if (shaded || header) {
        if (header) doc.setFillColor(236, 239, 241)
        else doc.setFillColor(249, 250, 251)
        doc.rect(PAGE_MARGIN, y, contentWidth, height, 'F')
      }
      let x = PAGE_MARGIN
      lines.forEach((cellLines, index) => {
        doc.setFont('helvetica', header || index === 0 ? 'bold' : 'normal')
        color(header ? COLORS.muted : cells[index] === '—' ? COLORS.muted : COLORS.text)
        cellLines.forEach((line, lineIndex) => doc.text(line, x + pad, y + pad + size + lineIndex * lineHeight - 1))
        x += widths[index]
      })
      doc.setDrawColor(COLORS.rule[0], COLORS.rule[1], COLORS.rule[2])
      doc.setLineWidth(0.5)
      doc.line(PAGE_MARGIN, y + height, PAGE_MARGIN + contentWidth, y + height)
      y += height
      return height
    }
    const rowHeight = (cells: string[], header: boolean) => Math.max(...cells.map((cell, index) => wrap(cell, index, header).length)) * lineHeight + pad * 2
    ensure(rowHeight(columns, true) + (rows[0] ? rowHeight(rows[0], false) : 0))
    drawRow(columns, true, false)
    rows.forEach((row, index) => {
      const height = rowHeight(row, false)
      if (y + height > pageHeight - PAGE_MARGIN - FOOTER) {
        newPage()
        drawRow(columns, true, false)
      }
      drawRow(row, false, index % 2 === 1)
    })
    y += 8
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
    const [lead, ...rest] = interpretation.summary
    if (lead) paragraph(lead, { size: 10.5, gap: 8 })
    if (interpretation.facts?.length) facts(interpretation.facts)
    if (interpretation.sections?.length) {
      for (const section of interpretation.sections) {
        ensure(40)
        y += 6
        paragraph(section.title, { size: 11, bold: true, rgb: COLORS.accent, gap: 4 })
        for (const block of section.blocks) {
          if (block.kind === 'text') paragraph(block.text)
          else if (block.kind === 'list') block.items.forEach((text, index) => item(text, { rgb: COLORS.accent }, (block.depths?.[index] ?? 0) * 14))
          else if (block.kind === 'table') drawTable(block.columns, block.rows)
          else {
            for (const step of block.steps) {
              const indent = step.depth * 16
              if (step.kind === 'group') {
                y += 2
                paragraph(step.text, { bold: true, rgb: COLORS.info, indent, gap: 2 })
              } else item(step.text, { rgb: COLORS.muted, label: `${step.number}.` }, indent)
            }
          }
        }
      }
    } else {
      for (const sentence of rest) {
        if (sentence.trimStart().startsWith('•')) item(sentence.trim().replace(/^•\s*/, ''), { rgb: COLORS.accent })
        else paragraph(sentence)
      }
    }
  }

  heading('Coherencia')
  if (interpretation) {
    const findings = interpretation.findings
    const warnings = findings.filter((finding) => finding.level === 'warning').length
    const infos = findings.filter((finding) => finding.level === 'info').length
    paragraph(
      findings.length === 0 ? 'No se encontraron incoherencias con las reglas de la notación.' : !warnings && !infos ? 'Sin observaciones.' : `${warnings} a revisar · ${infos} sugerencia${infos === 1 ? '' : 's'}`,
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

import type { jsPDF as JsPdf } from 'jspdf'

import type { Finding, Interpretation, InterpretationFact } from '../domain/uml/interpret'

/**
 * Maquetación compartida de los informes PDF (por diagrama y de coherencia):
 * párrafos, títulos, viñetas, cifras, tablas e imágenes con salto de página.
 */

export type ReportImage = { dataUrl: string; width: number; height: number }

export const PAGE_MARGIN = 48
const FOOTER = 28
export const COLORS = {
  text: [33, 37, 41],
  muted: [108, 117, 125],
  rule: [222, 226, 230],
  accent: [74, 88, 92],
  warning: [200, 70, 95],
  info: [190, 140, 50],
  ok: [46, 140, 90],
  blue: [70, 120, 190],
} as const
export type Rgb = readonly number[]
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

export const reportDate = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function createPdfLayout(doc: JsPdf) {
  let pageWidth = doc.internal.pageSize.getWidth()
  let pageHeight = doc.internal.pageSize.getHeight()
  let contentWidth = pageWidth - PAGE_MARGIN * 2
  let y = PAGE_MARGIN

  const color = (rgb: Rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2])
  const newPage = (orientation: 'portrait' | 'landscape' = 'portrait') => {
    doc.addPage('a4', orientation)
    pageWidth = doc.internal.pageSize.getWidth()
    pageHeight = doc.internal.pageSize.getHeight()
    contentWidth = pageWidth - PAGE_MARGIN * 2
    y = PAGE_MARGIN
  }
  const bottom = () => pageHeight - PAGE_MARGIN - FOOTER
  const ensure = (height: number) => {
    if (y + height > bottom()) newPage()
  }

  /** Párrafo con salto de línea y de página; `indent` desplaza todo el bloque. */
  const paragraph = (text: string, options: { size?: number; bold?: boolean; italic?: boolean; rgb?: Rgb; indent?: number; gap?: number } = {}) => {
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

  /** Título con línea inferior; nunca queda solo al pie de una página. */
  const heading = (text: string, size = 13) => {
    ensure(80)
    y += 10
    paragraph(text, { size, bold: true, rgb: COLORS.accent, gap: 2 })
    doc.setDrawColor(COLORS.rule[0], COLORS.rule[1], COLORS.rule[2])
    doc.setLineWidth(0.8)
    doc.line(PAGE_MARGIN, y, PAGE_MARGIN + contentWidth, y)
    y += 10
  }
  const subheading = (text: string, rgb: Rgb = COLORS.accent) => {
    ensure(50)
    y += 6
    paragraph(text, { size: 11, bold: true, rgb, gap: 4 })
  }

  /** Ítem con viñeta de color (o número) y sangría colgante. */
  const item = (text: string, marker: { rgb: Rgb; label?: string }, indent = 0, size = 10) => {
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

  /** Cifras clave en recuadros, hasta `perRow` por fila; `tone` colorea el valor. */
  const facts = (items: Array<InterpretationFact & { tone?: Rgb }>, perRowMax = 4) => {
    if (!items.length) return
    const perRow = Math.min(perRowMax, items.length)
    const gap = 8
    const width = (contentWidth - gap * (perRow - 1)) / perRow
    for (let start = 0; start < items.length; start += perRow) {
      const row = items.slice(start, start + perRow)
      // La etiqueta ocupa hasta dos líneas; la cifra va siempre debajo, sin encimarse.
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      const labels = row.map((entry) => (doc.splitTextToSize(pdfText(entry.label.toUpperCase()), width - 16) as string[]).slice(0, 2))
      const labelLines = Math.max(...labels.map((lines) => lines.length))
      const height = 30 + labelLines * 8
      ensure(height + gap)
      row.forEach((entry, index) => {
        const x = PAGE_MARGIN + index * (width + gap)
        doc.setFillColor(246, 247, 248)
        doc.setDrawColor(COLORS.rule[0], COLORS.rule[1], COLORS.rule[2])
        doc.roundedRect(x, y, width, height, 4, 4, 'FD')
        if (entry.tone) {
          doc.setFillColor(entry.tone[0], entry.tone[1], entry.tone[2])
          doc.rect(x, y + 4, 2.5, height - 8, 'F')
        }
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7)
        color(COLORS.muted)
        doc.text(labels[index], x + 9, y + 13)
        // La cifra se achica si no cabe en el recuadro.
        let size = 13
        doc.setFontSize(size)
        while (size > 8 && doc.getTextWidth(pdfText(entry.value)) > width - 16) doc.setFontSize((size -= 1))
        color(entry.tone ?? COLORS.text)
        doc.text(pdfText(entry.value), x + 9, y + 13 + labelLines * 8 + 12)
      })
      y += height + gap
    }
    y += 4
  }

  /** Tabla con encabezado sombreado, filas alternadas y encabezado repetido al cambiar de página. */
  const table = (columns: string[], rows: string[][], options: { tones?: Array<Rgb | undefined> } = {}) => {
    if (!rows.length) return
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
    const rowHeight = (cells: string[], header: boolean) => Math.max(...cells.map((cell, index) => wrap(cell, index, header).length)) * lineHeight + pad * 2
    const drawRow = (cells: string[], header: boolean, shaded: boolean, tone?: Rgb) => {
      const lines = cells.map((cell, index) => wrap(cell, index, header))
      const height = Math.max(...lines.map((cellLines) => cellLines.length)) * lineHeight + pad * 2
      if (shaded || header) {
        if (header) doc.setFillColor(236, 239, 241)
        else doc.setFillColor(249, 250, 251)
        doc.rect(PAGE_MARGIN, y, contentWidth, height, 'F')
      }
      if (tone) {
        doc.setFillColor(tone[0], tone[1], tone[2])
        doc.rect(PAGE_MARGIN, y, 2.5, height, 'F')
      }
      let x = PAGE_MARGIN
      lines.forEach((cellLines, index) => {
        doc.setFont('helvetica', header || index === 0 ? 'bold' : 'normal')
        color(header ? COLORS.muted : cells[index] === '—' ? COLORS.muted : COLORS.text)
        cellLines.forEach((line, lineIndex) => doc.text(line, x + pad + (index === 0 && tone ? 2 : 0), y + pad + size + lineIndex * lineHeight - 1))
        x += widths[index]
      })
      doc.setDrawColor(COLORS.rule[0], COLORS.rule[1], COLORS.rule[2])
      doc.setLineWidth(0.5)
      doc.line(PAGE_MARGIN, y + height, PAGE_MARGIN + contentWidth, y + height)
      y += height
    }
    ensure(rowHeight(columns, true) + rowHeight(rows[0], false))
    drawRow(columns, true, false)
    rows.forEach((row, index) => {
      if (y + rowHeight(row, false) > bottom()) {
        newPage()
        drawRow(columns, true, false)
      }
      drawRow(row, false, index % 2 === 1, options.tones?.[index])
    })
    y += 8
  }

  /** Imagen centrada y enmarcada, ajustada al ancho y al alto disponible. */
  const image = (picture: ReportImage, maxHeight?: number) => {
    const available = Math.min(maxHeight ?? Infinity, bottom() - y - 6)
    const scale = Math.min(contentWidth / picture.width, available / picture.height, 1.5)
    const width = picture.width * scale
    const height = picture.height * scale
    const x = PAGE_MARGIN + (contentWidth - width) / 2
    doc.addImage(picture.dataUrl, 'PNG', x, y + 6, width, height, undefined, 'FAST')
    doc.setDrawColor(COLORS.rule[0], COLORS.rule[1], COLORS.rule[2])
    doc.setLineWidth(0.6)
    doc.rect(x - 6, y, width + 12, height + 12)
    y += height + 24
  }

  /** Interpretación de un diagrama: resumen, cifras y secciones (o el texto si no hay secciones). */
  const interpretation = (value: Interpretation) => {
    const [lead, ...rest] = value.summary
    if (lead) paragraph(lead, { size: 10.5, gap: 8 })
    if (value.facts?.length) facts(value.facts)
    if (!value.sections?.length) {
      for (const sentence of rest) {
        if (sentence.trimStart().startsWith('•')) item(sentence.trim().replace(/^•\s*/, ''), { rgb: COLORS.accent })
        else paragraph(sentence)
      }
      return
    }
    for (const section of value.sections) {
      subheading(section.title)
      for (const block of section.blocks) {
        if (block.kind === 'text') paragraph(block.text)
        else if (block.kind === 'list') block.items.forEach((text, index) => item(text, { rgb: COLORS.accent }, (block.depths?.[index] ?? 0) * 14))
        else if (block.kind === 'table') table(block.columns, block.rows)
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
  }

  /** Observaciones de la notación de un diagrama, agrupadas por nivel. */
  const notationFindings = (findings: Finding[]) => {
    const warnings = findings.filter((finding) => finding.level === 'warning').length
    const infos = findings.filter((finding) => finding.level === 'info').length
    paragraph(
      findings.length === 0 ? 'No se encontraron incoherencias con las reglas de la notación.' : !warnings && !infos ? 'Sin observaciones.' : `${warnings} a revisar · ${infos} sugerencia${infos === 1 ? '' : 's'}`,
      { bold: true, rgb: !warnings && !infos ? COLORS.ok : warnings ? COLORS.warning : COLORS.info, gap: 6 },
    )
    for (const level of ['warning', 'info', 'ok'] as const) {
      const group = findings.filter((finding) => finding.level === level)
      if (!group.length) continue
      paragraph(`${LEVEL_TITLES[level]} (${group.length})`, { size: 10.5, bold: true, rgb: COLORS[level], gap: 2 })
      for (const finding of group) item(finding.text, { rgb: COLORS[level] })
      y += 4
    }
  }

  /** Pie de página con texto y numeración; `from` permite omitir la portada. */
  const footer = (text: string, from = 1) => {
    const pages = doc.getNumberOfPages()
    for (let page = from; page <= pages; page += 1) {
      doc.setPage(page)
      const width = doc.internal.pageSize.getWidth()
      const height = doc.internal.pageSize.getHeight()
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      color(COLORS.muted)
      doc.text(pdfText(text), PAGE_MARGIN, height - PAGE_MARGIN / 2 - 4, { maxWidth: width - PAGE_MARGIN * 2 - 80 })
      doc.text(`Página ${page} de ${pages}`, width - PAGE_MARGIN, height - PAGE_MARGIN / 2 - 4, { align: 'right' })
    }
  }

  return {
    doc,
    color,
    newPage,
    ensure,
    paragraph,
    heading,
    subheading,
    item,
    facts,
    table,
    image,
    interpretation,
    notationFindings,
    footer,
    get y() {
      return y
    },
    set y(value: number) {
      y = value
    },
    get contentWidth() {
      return contentWidth
    },
    get pageHeight() {
      return pageHeight
    },
    get pageWidth() {
      return pageWidth
    },
  }
}

export type PdfLayout = ReturnType<typeof createPdfLayout>

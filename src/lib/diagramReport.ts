import type { jsPDF as JsPdf } from 'jspdf'

import type { Interpretation } from '../domain/uml/interpret'
import { svgToCanvas } from './diagramExport'
import { COLORS, createPdfLayout, reportDate, type ReportImage } from './pdfLayout'

export { pdfText } from './pdfLayout'
export type { ReportImage }

export type DiagramReportInput = {
  name: string
  typeName: string
  generatedAt: Date
  image: ReportImage | null
  interpretation: Interpretation | null
  /** Por qué no hay interpretación (tipo sin análisis, código ilegible). */
  unavailable?: string
}

/** Arma el informe: encabezado, imagen del diagrama y la interpretación estructurada. */
export function buildDiagramReport(JsPDF: typeof JsPdf, input: DiagramReportInput): JsPdf {
  const wide = input.image ? input.image.width > input.image.height * 1.15 : false
  const layout = createPdfLayout(new JsPDF({ unit: 'pt', format: 'a4', orientation: wide ? 'landscape' : 'portrait' }))

  layout.paragraph('INFORME DEL DIAGRAMA', { size: 8, bold: true, rgb: COLORS.muted, gap: 0 })
  layout.paragraph(input.name, { size: 20, bold: true, gap: 0 })
  layout.paragraph(`${input.typeName} · Generado el ${reportDate.format(input.generatedAt)}`, { size: 9, rgb: COLORS.muted, gap: 10 })

  if (input.image) {
    layout.image(input.image)
    // El texto sigue en vertical aunque la imagen haya ido en una hoja apaisada.
    if (wide) layout.newPage()
  } else layout.paragraph('No se pudo incluir la imagen del diagrama.', { italic: true, rgb: COLORS.muted })

  layout.heading('Lo que dice el diagrama')
  if (input.interpretation) layout.interpretation(input.interpretation)
  else layout.paragraph(input.unavailable ?? 'Este tipo de diagrama no tiene interpretación automática.', { italic: true, rgb: COLORS.muted })

  layout.heading('Coherencia')
  if (input.interpretation) layout.notationFindings(input.interpretation.findings)
  else layout.paragraph('Sin interpretación, no hay revisión de coherencia.', { italic: true, rgb: COLORS.muted })
  layout.y += 6
  layout.paragraph('Análisis automático según las reglas de la notación: revisa que coincida con lo que quieres expresar.', { size: 8.5, italic: true, rgb: COLORS.muted })

  layout.footer(`Gesti - Workspace · ${input.name}`)
  return layout.doc
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

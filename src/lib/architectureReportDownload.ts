import type { ArchitectureReport, ArchitectureSettings, DiagramInput } from '../domain/uml/coherence'
import { interpretDiagram } from '../domain/uml/interpretDiagram'
import { diagramFileName } from '../domain/diagramSvg'
import { umlDiagramType } from '../domain/umlCatalog'
import { buildArchitectureReport, type ReportDiagram } from './architectureReport'
import { svgToCanvas } from './diagramExport'
import type { ReportImage } from './pdfLayout'
import { renderPlantUml } from './plantuml'

const RENDER_TIMEOUT_MS = 20000

/** Imagen PNG de un diagrama (o null si no se puede dibujar: el informe avisa y sigue). */
async function diagramImage(diagram: DiagramInput): Promise<ReportImage | null> {
  // El wireframe usa un renderizador propio (el motor no incluye Salt).
  if (diagram.kind === 'wireframe' || !diagram.source?.trim()) return null
  try {
    const svg = await Promise.race([
      renderPlantUml(diagram.source),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), RENDER_TIMEOUT_MS)),
    ])
    const { canvas, width, height } = await svgToCanvas(svg, 1.6)
    return { dataUrl: canvas.toDataURL('image/png'), width, height }
  } catch {
    return null
  }
}

/**
 * Genera y descarga el informe de diseño y coherencia arquitectónica.
 * Los diagramas se dibujan de a uno (el motor de PlantUML no es reentrante).
 */
export async function downloadArchitectureReport(
  input: {
    project: { name: string; description?: string | null }
    report: ArchitectureReport
    settings: ArchitectureSettings
    diagrams: DiagramInput[]
    author: string
  },
  onProgress?: (message: string) => void,
) {
  const { jsPDF } = await import('jspdf')
  const diagrams: ReportDiagram[] = []
  for (const [index, diagram] of input.diagrams.entries()) {
    onProgress?.(`Dibujando diagrama ${index + 1} de ${input.diagrams.length}…`)
    diagrams.push({
      id: diagram.id,
      name: diagram.name,
      kind: diagram.kind,
      typeName: umlDiagramType(diagram.kind)?.name ?? diagram.kind,
      mode: diagram.mode,
      interpretation: interpretDiagram(diagram),
      image: await diagramImage(diagram),
    })
  }
  onProgress?.('Armando el informe…')
  const doc = buildArchitectureReport(jsPDF, { ...input, diagrams, generatedAt: new Date() })
  doc.save(diagramFileName(`informe de diseño y coherencia ${input.project.name}`, 'pdf'))
}

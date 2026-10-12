import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'

import { buildArchitectureReport, type ReportDiagram } from './architectureReport'
import { defaultSettings, evaluateArchitecture, type DiagramInput } from '../domain/uml/coherence'
import { classes, code, components, coherentSet, sequenceLines, useCases } from '../domain/uml/coherence/fixtures.test-data'
import { interpretDiagram } from '../domain/uml/interpretDiagram'

const asReportDiagrams = (inputs: DiagramInput[]): ReportDiagram[] =>
  inputs.map((input) => ({ id: input.id, name: input.name, kind: input.kind, typeName: input.kind, mode: input.mode, interpretation: interpretDiagram(input), image: null }))

/** Texto del PDF sin escapes de paréntesis, para buscar frases. */
const text = (doc: jsPDF) => doc.output().replace(/\\([()])/g, '$1')

describe('informe de diseño y coherencia arquitectónica', () => {
  it('arma portada, índice, capítulos y anexos con los hallazgos reales', () => {
    const discrepant = code('d2-sequence', 'sequence', 'Crear tarea', ...sequenceLines, 'TableroVista -> TareaController : eliminarTarea(id)')
    const split = code('d5-deployment', 'deployment', 'Despliegue', 'node Servidor {', '  artifact Backend', '}', 'node "Servidor BD" {', '  database "Base de datos" as DB', '}', 'node Respaldo', 'Servidor -- Respaldo')
    const inputs = [useCases, discrepant, classes, components, split]
    const base = evaluateArchitecture(inputs, { ...defaultSettings(), completeContracts: [classes.id] })
    const network = base.findings.find((finding) => finding.type === 'no-communication-path')!
    const settings = { ...defaultSettings(), completeContracts: [classes.id], exceptions: [{ fingerprint: network.fingerprint, ruleId: network.ruleId, title: network.title, justification: 'La conexión pasa por una VPN gestionada fuera del modelo.', author: 'Ana' }] }
    const report = evaluateArchitecture(inputs, settings)
    const doc = buildArchitectureReport(jsPDF, { project: { name: 'Gesti', description: 'Gestión visual de proyectos.' }, report, settings, diagrams: asReportDiagrams(inputs), author: 'Ana', generatedAt: new Date('2026-10-12T18:00:00') })
    const pdf = text(doc)

    expect(doc.getNumberOfPages()).toBeGreaterThan(8)
    for (const title of ['Proyecto Gesti', 'Gestión visual de proyectos.', 'Índice', '1. Resumen ejecutivo', '2. Alcance y metodología', '3. Arquitectura descrita', '4. Cobertura de la evaluación', '5. Hallazgos', '6. Correspondencias entre vistas', '7. Plan de acción recomendado', 'Anexo A. Diagramas del proyecto', 'Anexo B. Reglas aplicadas']) {
      expect(pdf).toContain(title)
    }
    const missing = report.findings.find((finding) => finding.type === 'operation-missing')!
    expect(pdf).toContain(missing.id)
    expect(pdf).toContain('eliminarTarea')
    expect(pdf).toContain('VPN gestionada')
    expect(pdf).toContain('Excepciones justificadas')
    for (const input of inputs) expect(pdf).toContain(input.name)
  })

  it('funciona sin diagramas analizables ni hallazgos', () => {
    const report = evaluateArchitecture([])
    const doc = buildArchitectureReport(jsPDF, { project: { name: 'Vacío' }, report, settings: defaultSettings(), diagrams: [], author: '', generatedAt: new Date() })
    const pdf = text(doc)
    expect(pdf).toContain('No evaluable')
    expect(pdf).toContain('No hay acciones pendientes')
  })

  it('el índice apunta a páginas existentes', () => {
    const report = evaluateArchitecture(coherentSet)
    const doc = buildArchitectureReport(jsPDF, { project: { name: 'Gesti' }, report, settings: defaultSettings(), diagrams: asReportDiagrams(coherentSet), author: 'Ana', generatedAt: new Date() })
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(10)
    expect(text(doc)).toContain(`Página ${doc.getNumberOfPages()} de ${doc.getNumberOfPages()}`)
  })
})

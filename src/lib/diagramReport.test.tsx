import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { jsPDF } from 'jspdf'

import InterpretationPanel from '../components/uml/InterpretationPanel'
import { interpretModel } from '../domain/uml/interpret'
import { explainRegex } from '../domain/uml/interpretStructured'
import { isVisualKind } from '../domain/uml/visualModel'
import { UML_DIAGRAM_TYPES } from '../domain/umlCatalog'
import { parsePlantUml } from '../domain/uml/parsePlantUml'
import { buildDiagramReport, pdfText } from './diagramReport'

const lines = ['@startuml', 'actor A', 'participant B', 'participant C']
for (let index = 1; index <= 12; index += 1) lines.push(`A -> B : paso ${index}`, `B --> A : ok ${index}`)
lines.push('alt hay datos', 'B -> C : leer()', 'loop por cada fila', 'C -> C : procesar()', 'end', 'else sin datos', 'B -> C : avisar()', 'end', 'B --> A : fin', '@enduml')
const interpretation = interpretModel(parsePlantUml(lines.join('\n'), 'sequence', null).model)

describe('interpretación de secuencias', () => {
  it('describe todos los mensajes, sin cortar en «…y N más», con los fragmentos anidados', () => {
    const block = interpretation.sections!.flatMap((section) => section.blocks).find((item) => item.kind === 'steps')
    const steps = block?.kind === 'steps' ? block.steps : []
    expect(steps.filter((step) => step.kind === 'step')).toHaveLength(28)
    expect(interpretation.summary.join(' ')).not.toMatch(/mensajes más/)
    expect(steps.find((step) => step.kind === 'group' && step.text.startsWith('Si «hay datos»'))?.depth).toBe(0)
    expect(steps.find((step) => step.kind === 'group' && step.text.startsWith('Repetir mientras'))?.depth).toBe(1)
    expect(steps.find((step) => step.kind === 'step' && step.text.includes('procesar()'))?.depth).toBe(2)
    expect(steps.find((step) => step.kind === 'group' && step.text.startsWith('Si no'))?.depth).toBe(0)
    expect(steps.at(-1)).toMatchObject({ kind: 'step', number: 28, depth: 0 })
  })
})

describe('InterpretationPanel', () => {
  it('muestra un avance del recorrido y ofrece ver el resto y descargar el PDF', () => {
    const html = renderToStaticMarkup(<InterpretationPanel interpretation={interpretation} onDownloadReport={() => {}} />)
    expect(html).toContain('Recorrido paso a paso')
    expect(html).toContain('Mostrar los 16 pasos restantes')
    expect(html).toContain('Informe PDF')
    expect(renderToStaticMarkup(<InterpretationPanel interpretation={interpretation} />)).not.toContain('PDF')
  })
})

describe('informe PDF', () => {
  // PNG de 1×1 píxel.
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

  // En el PDF los paréntesis van escapados («procesar\(\)») y las tildes, codificadas.
  it('incluye la imagen, todos los pasos y la coherencia agrupada', () => {
    const doc = buildDiagramReport(jsPDF, { name: 'Secuencia 1', typeName: 'Diagrama de secuencia', generatedAt: new Date('2026-10-12T18:00:00'), image: { dataUrl: pixel, width: 800, height: 400 }, interpretation })
    const pdf = doc.output()
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2)
    expect(pdf).toContain('/Subtype /Image')
    for (const text of ['Secuencia 1', 'Recorrido paso a paso', 'paso 12', 'procesar\\(\\)', 'Coherencia', 'gina 1 de']) expect(pdf).toContain(text)
  })

  it('funciona sin imagen ni interpretación', () => {
    const doc = buildDiagramReport(jsPDF, { name: 'Vacío', typeName: 'Diagrama', generatedAt: new Date(), image: null, interpretation: null, unavailable: 'Sin análisis.' })
    const pdf = doc.output()
    expect(pdf).toContain('No se pudo incluir la imagen')
    expect(pdf).toContain('Sin análisis.')
  })

  it('reemplaza los símbolos que las fuentes del PDF no tienen', () => {
    expect(pdfText('A → B ✓ «ñandú» – ok ≥ 2 😀')).toBe('A -> B «ñandú» – ok >= 2')
    expect(pdfText('◆ Entrega')).toBe('Entrega')
  })
})

describe('interpretación estructurada de cada tipo de diagrama', () => {
  const templates = UML_DIAGRAM_TYPES.filter((type) => type.id === 'regex' || isVisualKind(type.id))

  it.each(templates.map((type) => [type.id, type] as const))('%s: cifras, secciones, panel y PDF', (_, type) => {
    const interpretation = type.id === 'regex' ? explainRegex(type.template) : interpretModel(parsePlantUml(type.template, type.id, null).model)
    expect(interpretation.sections?.length).toBeGreaterThan(0)
    if (type.id !== 'regex') expect(interpretation.facts?.length).toBeGreaterThan(0)
    for (const block of interpretation.sections!.flatMap((section) => section.blocks)) {
      if (block.kind === 'table') for (const row of block.rows) expect(row).toHaveLength(block.columns.length)
    }
    const html = renderToStaticMarkup(<InterpretationPanel interpretation={interpretation} />)
    expect(html).toContain('uml-section-title')
    expect(html).not.toMatch(/NaN|undefined/)
    const doc = buildDiagramReport(jsPDF, { name: type.name, typeName: type.name, generatedAt: new Date(), image: null, interpretation })
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1)
  })
})

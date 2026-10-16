import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Los modales no consultan Supabase al dibujarse, pero sus servicios importan el cliente.
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

import ExportDiagramsModal from './ExportDiagramsModal'
import ImportDiagramsModal from './ImportDiagramsModal'
import type { DiagramSummary } from '../../services/diagrams'

const diagrams: DiagramSummary[] = [
  { id: 'd1', board_id: 'b1', name: 'Modelo de dominio', kind: 'class', mode: 'visual', updated_at: '2026-10-16T10:00:00Z', updated_by: null },
  { id: 'd2', board_id: 'b1', name: 'Inicio de sesión', kind: 'sequence', mode: 'code', updated_at: '2026-10-15T10:00:00Z', updated_by: null },
]

describe('ExportDiagramsModal', () => {
  it('lista los diagramas del tablero, todos seleccionados', () => {
    const html = renderToStaticMarkup(
      <ExportDiagramsModal board={{ id: 'b1', name: 'NexuStock', description: null }} diagrams={diagrams} onClose={() => {}} onExported={() => {}} />,
    )
    expect(html).toContain('Modelo de dominio')
    expect(html).toContain('Diagrama de secuencia')
    expect(html.match(/checked=""/g)).toHaveLength(3)
    expect(html).toContain('Descargar plantilla (2)')
  })
})

describe('ImportDiagramsModal', () => {
  it('pide un archivo y ofrece la plantilla de ejemplo', () => {
    const html = renderToStaticMarkup(<ImportDiagramsModal boardId="b1" existingNames={[]} onClose={() => {}} onImported={() => {}} />)
    expect(html).toContain('Elige un archivo o arrástralo aquí')
    expect(html).toContain('accept=".json,.puml')
    expect(html).toContain('plantilla de ejemplo')
  })
})

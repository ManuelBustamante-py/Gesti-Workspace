import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

import CoverageView from './CoverageView'
import EquivalencesView from './EquivalencesView'
import FindingDetail from './FindingDetail'
import SettingsView from './SettingsView'
import { focusLink } from './shared'
import { defaultSettings, evaluateArchitecture } from '../../../domain/uml/coherence'
import { code, components } from '../../../domain/uml/coherence/fixtures.test-data'

const split = code('d5-deployment', 'deployment', 'Despliegue', 'node Servidor {', '  artifact Backend', '}', 'node "Servidor BD" {', '  database "Base de datos" as DB', '}', 'node Respaldo', 'Servidor -- Respaldo')
const settings = { ...defaultSettings(), style: 'mvc' as const }
const report = evaluateArchitecture([components, split], settings)

vi.mock('../../../hooks/useArchitectureReview', () => ({
  useArchitectureReview: () => ({
    report, settings, settingsAvailable: false, loading: false, error: '', saveError: '', saving: false, loadedAt: null, reload: () => {}, updateSettings: async () => {},
  }),
}))
const { default: CoherencePanel } = await import('./CoherencePanel')

const render = (node: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)

describe('CoherencePanel', () => {
  it('muestra el estado, el índice, los conteos y abre el hallazgo más importante', () => {
    const html = render(<CoherencePanel boardId="b1" boardName="Gesti" canEdit narrow={false} listPath="/dashboard/uml/b1" userName="Ana" />)
    const top = report.findings[0]
    expect(top.category).toBe('contradiction')
    expect(html).toContain(report.statusLabel)
    expect(html).toContain(`${report.index.consistent} de ${report.index.conclusive} comprobaciones concluyentes`)
    expect(html).toContain('arch-finding-active')
    expect(html).toContain(`${top.id} · ${top.ruleTitle}`)
    expect(html).toContain('falta la migración')
    expect(html).not.toContain('NaN')
  })

  it('el detalle enlaza cada elemento con su diagrama para navegar hasta él', () => {
    const finding = report.findings.find((item) => item.type === 'no-communication-path')!
    const html = render(<FindingDetail finding={finding} report={report} listPath="/dashboard/uml/b1" canEdit userName="Ana" onAddException={() => {}} onRemoveException={() => {}} />)
    const node = finding.elements.find((element) => element.kind === 'node')!
    expect(html).toContain(focusLink(report, '/dashboard/uml/b1', node).replace(/&/g, '&amp;'))
    expect(focusLink(report, '/dashboard/uml/b1', node)).toMatch(/^\/dashboard\/uml\/b1\/d5-deployment\?desde=coherencia&foco=node%3An\d+$/)
    expect(html).toContain('Registrar como excepción justificada')
  })

  it('para lectores no ofrece registrar excepciones ni editar la configuración', () => {
    const finding = report.findings.find((item) => item.category === 'contradiction')!
    expect(render(<FindingDetail finding={finding} report={report} listPath="/x" canEdit={false} userName="" onAddException={() => {}} onRemoveException={() => {}} />)).not.toContain('excepción justificada')
    expect(render(<SettingsView report={report} settings={settings} canEdit={false} onChange={() => {}} />)).toContain('disabled=""')
  })

  it('la cobertura, las equivalencias y la configuración se renderizan con datos reales', () => {
    expect(render(<CoverageView coverage={report.coverage} />)).toContain('Componentes ↔ despliegue')
    expect(render(<EquivalencesView report={report} settings={settings} canEdit onChange={() => {}} />)).toContain('Automáticas en uso')
    const html = render(<SettingsView report={report} settings={settings} canEdit onChange={() => {}} />)
    expect(html).toContain('Dependencias prohibidas')
    expect(html).toContain('Backend')
  })
})

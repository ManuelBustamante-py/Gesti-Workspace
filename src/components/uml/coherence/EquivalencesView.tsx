import { stableKey, type ArchitectureReport, type ArchitectureSettings, type Correspondence } from '../../../domain/uml/coherence'
import { percent } from './shared'

interface EquivalencesViewProps {
  report: ArchitectureReport
  settings: ArchitectureSettings
  canEdit: boolean
  onChange: (settings: ArchitectureSettings) => void
}

const BASIS = { 'same-name': 'mismo nombre', 'equivalent-terms': 'términos equivalentes', 'role-variant': 'difieren en el rol técnico', partial: 'coincidencia parcial', user: 'confirmada' } as const

/**
 * Correspondencias entre diagramas. Las hipótesis no se usan para concluir
 * hasta que alguien las confirma; una automática se puede rechazar si en
 * realidad son conceptos distintos.
 */
function EquivalencesView({ report, settings, canEdit, onChange }: EquivalencesViewProps) {
  const element = (key: string) => report.model.elements.find((item) => item.key === key)!
  const diagram = (id: string) => report.model.diagrams.find((item) => item.id === id)?.name ?? id
  const keys = (item: Correspondence) => [stableKey(element(item.a)), stableKey(element(item.b))] as const
  const decide = (item: Correspondence, status: 'confirmed' | 'rejected' | null) => {
    const [a, b] = keys(item)
    const rest = settings.equivalences.filter((entry) => !((entry.a === a && entry.b === b) || (entry.a === b && entry.b === a)))
    onChange({ ...settings, equivalences: status ? [...rest, { a, b, status }] : rest })
  }
  const groups: Array<{ title: string; hint: string; items: Correspondence[] }> = [
    { title: 'Por validar', hint: 'Propuestas con confianza insuficiente o ambiguas: no se usan en las reglas.', items: report.correspondences.filter((item) => item.status === 'hypothesis') },
    { title: 'Validadas por el equipo', hint: 'Confirmadas o rechazadas manualmente.', items: report.correspondences.filter((item) => item.status === 'confirmed' || item.status === 'rejected') },
    { title: 'Automáticas en uso', hint: 'Mismo nombre o mismos términos y tipos compatibles. Rechaza las que sean conceptos distintos.', items: report.correspondences.filter((item) => item.status === 'auto') },
  ]

  return (
    <div className="grid gap-5">
      {groups.map((group) => (
        <section key={group.title}>
          <h3 className="uml-interpretation-heading">{group.title} ({group.items.length})</h3>
          <p className="mb-2 text-xs text-[var(--text-muted)]">{group.hint}</p>
          {group.items.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Ninguna.</p>
          ) : (
            <ul className="grid gap-2">
              {group.items.map((item) => {
                const [a, b] = [element(item.a), element(item.b)]
                return (
                  <li key={`${item.a}|${item.b}`} className="arch-comparison">
                    <p className="text-sm text-[var(--text-main)]">
                      «{a.name}» <span className="text-[var(--text-muted)]">({diagram(a.diagramId)})</span> ≈ «{b.name}» <span className="text-[var(--text-muted)]">({diagram(b.diagramId)})</span>
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {BASIS[item.basis]} · confianza {percent(item.confidence)} · {item.evidence}
                    </p>
                    {canEdit && (
                      <p className="mt-2 flex flex-wrap gap-2">
                        {item.status !== 'confirmed' && <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => decide(item, 'confirmed')}>Confirmar</button>}
                        {item.status !== 'rejected' && <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => decide(item, 'rejected')}>Son conceptos distintos</button>}
                        {(item.status === 'confirmed' || item.status === 'rejected') && <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => decide(item, null)}>Deshacer</button>}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

export default EquivalencesView

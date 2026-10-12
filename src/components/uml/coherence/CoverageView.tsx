import type { Coverage } from '../../../domain/uml/coherence'
import { percent } from './shared'

const COMPARISON_STATUS = { executed: 'Ejecutada', skipped: 'Omitida', 'no-correspondence': 'Sin correspondencias' } as const
const RULE_STATUS = { executed: 'ejecutada', skipped: 'omitida', disabled: 'desactivada' } as const

/** Qué vistas hay, qué se pudo evaluar y qué no (con el motivo y cómo ampliarlo). */
function CoverageView({ coverage }: { coverage: Coverage }) {
  return (
    <div className="grid gap-5">
      <p className="text-xs text-[var(--text-muted)]">
        La cobertura indica cuánto del modelo se pudo contrastar; no es una medida de coherencia. Un diseño puede ser coherente en lo evaluado y tener poca cobertura.
      </p>
      <section>
        <h3 className="uml-interpretation-heading">Vistas arquitectónicas</h3>
        <ul className="arch-coverage-grid">
          {coverage.views.map((view) => (
            <li key={view.view} className={`arch-coverage-card ${view.diagrams.length ? '' : 'arch-coverage-missing'}`}>
              <p className="font-semibold text-[var(--text-main)]">{view.diagrams.length ? '●' : '○'} {view.label}</p>
              {view.diagrams.length ? (
                <ul className="mt-1 grid gap-1 text-xs text-[var(--text-muted)]">
                  {view.diagrams.map((diagram) => (
                    <li key={diagram.id}>
                      {diagram.name} · lectura {percent(diagram.confidence)}
                    </li>
                  ))}
                  {view.aspects.map((aspect, index) => <li key={`a${index}`} className="text-[var(--text-main)]">{aspect}</li>)}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-[var(--text-muted)]">{view.missing}</p>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="uml-interpretation-heading">Comparaciones entre vistas</h3>
        <ul className="grid gap-2">
          {coverage.comparisons.map((comparison) => (
            <li key={comparison.id} className="arch-comparison">
              <p className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-[var(--text-main)]">{comparison.title}</span>
                <span className={`arch-badge ${comparison.status === 'executed' ? 'arch-tone-coherent' : 'arch-tone-unverifiable'}`}>{COMPARISON_STATUS[comparison.status]}</span>
              </p>
              {comparison.reason && <p className="mt-1 text-xs text-[var(--text-muted)]">{comparison.reason}</p>}
              {comparison.enable && <p className="mt-1 text-xs text-[var(--text-main)]">Para ejecutarla: {comparison.enable}</p>}
              <ul className="mt-2 grid gap-0.5 text-xs text-[var(--text-muted)]">
                {comparison.rules.map((rule) => (
                  <li key={rule.id}>
                    <code>{rule.id}</code> — {rule.title}: {RULE_STATUS[rule.status]}
                    {rule.status === 'executed' ? `, ${rule.checks} resultado(s)` : ''}
                    {rule.reason ? ` · ${rule.reason}` : ''}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
      {coverage.suggestions.length > 0 && (
        <section>
          <h3 className="uml-interpretation-heading">Para ampliar el análisis</h3>
          <ul className="arch-list">
            {coverage.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}
          </ul>
        </section>
      )}
    </div>
  )
}

export default CoverageView

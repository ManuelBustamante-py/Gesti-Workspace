import { formatDateKey } from '../../domain/dates'
import type { FlowInterpretation, InsightTone } from '../../domain/flowInsights'

const ICONS: Record<InsightTone, string> = { good: '✓', info: 'ℹ', warning: '⚠', danger: '⛔' }
const TONE_LABELS: Record<InsightTone, string> = { good: 'Favorable', info: 'Información', warning: 'A vigilar', danger: 'Crítico' }

const number = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 })
const shortDate = (day: string) => formatDateKey(day, { day: 'numeric', month: 'short', year: 'numeric' })

/** Interpretación del avance: diagnóstico, hallazgos, escenarios de entrega y recomendaciones. */
function FlowInterpretationPanel({ interpretation, unit }: { interpretation: FlowInterpretation; unit: string }) {
  const { tone, headline, summary, insights, scenarios, recommendations } = interpretation

  return (
    <section className="glass-panel mt-4 overflow-hidden rounded-2xl" aria-labelledby="flow-interpretation-title">
      <div className="border-b border-white/10 px-4 py-4 sm:px-5">
        <h2 id="flow-interpretation-title" className="text-lg font-semibold text-white">Interpretación</h2>
        <p className="mt-1 text-sm text-slate-400">Lectura automática de las cifras del tablero. Cada conclusión sale de un dato que puedes verificar en los gráficos o la tabla.</p>
      </div>

      <div className="space-y-5 px-4 py-4 sm:px-5">
        <div className={`flow-diagnosis flow-insight-${tone}`}>
          <span className="flow-insight-icon" aria-hidden="true">{ICONS[tone]}</span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Diagnóstico</p>
            <h3 className="mt-0.5 text-base font-semibold text-white">{headline}</h3>
            <p className="mt-1 text-sm text-[var(--text-main)]">{summary}</p>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Hallazgos</h3>
          <ul className="flow-insights">
            {insights.map((insight) => (
              <li key={insight.id} className={`flow-insight flow-insight-${insight.tone}`}>
                <span className="flow-insight-icon" aria-hidden="true">{ICONS[insight.tone]}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">
                    {insight.title}
                    <span className="sr-only"> ({TONE_LABELS[insight.tone]})</span>
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--text-main)]">{insight.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {scenarios.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Escenarios de entrega</h3>
            <div className="overflow-x-auto">
              <table className="flow-table flow-scenarios">
                <caption className="sr-only">Fecha de término según distintos ritmos de trabajo</caption>
                <thead>
                  <tr><th scope="col">Escenario</th><th scope="col">{unit}/semana</th><th scope="col">Terminaría</th><th scope="col">Plazo</th></tr>
                </thead>
                <tbody>
                  {scenarios.map((scenario) => (
                    <tr key={scenario.id}>
                      <th scope="row">
                        {scenario.label}
                        <span className="block text-xs font-normal text-[var(--text-muted)]">{scenario.note}</span>
                      </th>
                      <td>{number.format(scenario.perWeek)}</td>
                      <td>{scenario.finish ? shortDate(scenario.finish) : 'Sin avance'}</td>
                      <td>
                        {scenario.id === 'required' ? '—' : scenario.meetsDeadline === null ? '—' : scenario.meetsDeadline
                          ? <span className="burndown-ahead">✓ Cumple</span>
                          : <span className="burndown-behind">✗ No cumple</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {recommendations.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Recomendaciones</h3>
            <ol className="flow-recommendations">
              {recommendations.map((text) => <li key={text}>{text}</li>)}
            </ol>
          </div>
        )}
      </div>
    </section>
  )
}

export default FlowInterpretationPanel

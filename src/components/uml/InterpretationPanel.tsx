import { useState } from 'react'

import type { Interpretation } from '../../domain/uml/interpret'

const ICONS = { warning: '⚠', info: 'ℹ', ok: '✓' } as const

interface InterpretationPanelProps {
  interpretation: Interpretation | null
  /** Por qué no hay interpretación (tipo sin análisis o código que no se pudo leer). */
  unavailable?: string
}

/**
 * Interpretación del diagrama: lo que afirma, en lenguaje natural, y las
 * observaciones de coherencia. Sirve para comprobar que el diagrama dice lo
 * que se quiere expresar.
 */
function InterpretationPanel({ interpretation, unavailable }: InterpretationPanelProps) {
  const [open, setOpen] = useState(true)
  const warnings = interpretation?.findings.filter((finding) => finding.level === 'warning').length ?? 0
  const infos = interpretation?.findings.filter((finding) => finding.level === 'info').length ?? 0

  return (
    <section className="uml-interpretation" aria-label="Interpretación del diagrama">
      <button type="button" className="uml-interpretation-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>🧭 Interpretación del diagrama</span>
        <span className="uml-interpretation-counts">
          {interpretation && warnings > 0 && <span className="uml-count-warning">{warnings} a revisar</span>}
          {interpretation && infos > 0 && <span className="uml-count-info">{infos} sugerencia{infos === 1 ? '' : 's'}</span>}
          {interpretation && warnings === 0 && infos === 0 && <span className="uml-count-ok">Sin observaciones</span>}
          <span aria-hidden="true">{open ? '⌃' : '⌄'}</span>
        </span>
      </button>
      {open && (
        <div className="uml-interpretation-body">
          {!interpretation ? (
            <p className="text-sm text-[var(--text-muted)]">{unavailable ?? 'No hay interpretación para este diagrama.'}</p>
          ) : (
            <div className="uml-interpretation-grid">
              <div>
                <p className="uml-interpretation-heading">Lo que dice el diagrama</p>
                <ul className="uml-interpretation-summary">
                  {interpretation.summary.map((sentence, index) => <li key={index}>{sentence}</li>)}
                </ul>
              </div>
              <div>
                <p className="uml-interpretation-heading">Coherencia</p>
                {interpretation.findings.length === 0 ? (
                  <p className="uml-finding uml-finding-ok">✓ No se encontraron incoherencias con las reglas de la notación.</p>
                ) : (
                  <ul className="grid gap-1.5">
                    {interpretation.findings.map((finding, index) => (
                      <li key={index} className={`uml-finding uml-finding-${finding.level}`}>
                        <span aria-hidden="true">{ICONS[finding.level]}</span> {finding.text}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-[0.7rem] text-[var(--text-muted)]">
                  Análisis automático según las reglas de la notación: revisa que coincida con lo que quieres expresar.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default InterpretationPanel

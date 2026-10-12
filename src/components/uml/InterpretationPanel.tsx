import { useState } from 'react'

import type { Finding, Interpretation } from '../../domain/uml/interpret'

const ICONS = { warning: '⚠', info: 'ℹ', ok: '✓' } as const
const LEVEL_TITLES: Record<Finding['level'], string> = { warning: 'A revisar', info: 'Sugerencias', ok: 'Correcto' }
/** Pasos visibles antes de «Mostrar todos»: la lista completa siempre está a un clic. */
const PREVIEW_STEPS = 12
const PREVIEW_SENTENCES = 10

interface InterpretationPanelProps {
  interpretation: Interpretation | null
  /** Por qué no hay interpretación (tipo sin análisis o código que no se pudo leer). */
  unavailable?: string
  /** Descarga el informe en PDF (imagen del diagrama + esta interpretación). */
  onDownloadReport?: () => void
  downloading?: boolean
}

/**
 * Interpretación del diagrama: lo que afirma, en lenguaje natural (con el
 * recorrido paso a paso en las secuencias), y las observaciones de coherencia
 * agrupadas por nivel.
 */
function InterpretationPanel({ interpretation, unavailable, onDownloadReport, downloading }: InterpretationPanelProps) {
  const [open, setOpen] = useState(true)
  const [allSteps, setAllSteps] = useState(false)
  const [allSentences, setAllSentences] = useState(false)
  const warnings = interpretation?.findings.filter((finding) => finding.level === 'warning').length ?? 0
  const infos = interpretation?.findings.filter((finding) => finding.level === 'info').length ?? 0

  const [lead, ...sentences] = interpretation?.summary ?? []
  const shownSentences = allSentences ? sentences : sentences.slice(0, PREVIEW_SENTENCES)
  const steps = interpretation?.steps ?? []
  const shownSteps = allSteps ? steps : steps.slice(0, PREVIEW_STEPS)
  const hiddenSteps = steps.filter((step) => step.kind === 'step').length - shownSteps.filter((step) => step.kind === 'step').length

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
              <div className="min-w-0">
                <p className="uml-interpretation-heading">Lo que dice el diagrama</p>
                {lead && <p className="uml-interpretation-lead">{lead}</p>}
                {shownSentences.length > 0 && (
                  <ul className="uml-interpretation-summary">
                    {shownSentences.map((sentence, index) => (
                      <li key={index} className={sentence.startsWith('•') ? 'uml-summary-bullet' : undefined}>{sentence.replace(/^•\s*/, '')}</li>
                    ))}
                  </ul>
                )}
                {sentences.length > PREVIEW_SENTENCES && (
                  <button type="button" className="uml-more" onClick={() => setAllSentences((value) => !value)}>
                    {allSentences ? 'Mostrar menos' : `Mostrar ${sentences.length - PREVIEW_SENTENCES} más`}
                  </button>
                )}
                {steps.length > 0 && (
                  <>
                    <p className="uml-interpretation-subheading">Recorrido paso a paso</p>
                    <ol className="uml-steps">
                      {shownSteps.map((step, index) =>
                        step.kind === 'group' ? (
                          <li key={index} className="uml-step-group" style={{ marginLeft: `${step.depth * 1.1}rem` }}>{step.text}</li>
                        ) : (
                          <li key={index} className="uml-step" style={{ marginLeft: `${step.depth * 1.1}rem` }}>
                            <span className="uml-step-number">{step.number}</span>
                            <span>{step.text}</span>
                          </li>
                        ),
                      )}
                    </ol>
                    {steps.length > PREVIEW_STEPS && (
                      <button type="button" className="uml-more" onClick={() => setAllSteps((value) => !value)}>
                        {allSteps ? 'Mostrar menos' : `Mostrar los ${hiddenSteps} pasos restantes`}
                      </button>
                    )}
                  </>
                )}
              </div>
              <div className="min-w-0">
                <p className="uml-interpretation-heading">Coherencia</p>
                {interpretation.findings.length === 0 ? (
                  <p className="uml-finding uml-finding-ok">✓ No se encontraron incoherencias con las reglas de la notación.</p>
                ) : (
                  <div className="grid gap-3">
                    {(['warning', 'info', 'ok'] as const).map((level) => {
                      const group = interpretation.findings.filter((finding) => finding.level === level)
                      if (!group.length) return null
                      return (
                        <div key={level}>
                          <p className={`uml-finding-group uml-finding-group-${level}`}>{LEVEL_TITLES[level]} ({group.length})</p>
                          <ul className="grid gap-1.5">
                            {group.map((finding, index) => (
                              <li key={index} className={`uml-finding uml-finding-${finding.level}`}>
                                <span aria-hidden="true">{ICONS[finding.level]}</span> {finding.text}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    })}
                  </div>
                )}
                <p className="mt-2 text-[0.7rem] text-[var(--text-muted)]">
                  Análisis automático según las reglas de la notación: revisa que coincida con lo que quieres expresar.
                </p>
              </div>
            </div>
          )}
          {onDownloadReport && (
            <div className="mt-3 flex justify-end">
              <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={onDownloadReport} disabled={downloading}>
                {downloading ? 'Generando PDF…' : '⤓ Descargar informe del diagrama (PDF)'}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default InterpretationPanel

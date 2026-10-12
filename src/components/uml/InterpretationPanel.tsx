import { useState } from 'react'

import type { Finding, Interpretation, InterpretationBlock, InterpretationSection } from '../../domain/uml/interpret'

const ICONS = { warning: '⚠', info: 'ℹ', ok: '✓' } as const
const LEVEL_TITLES: Record<Finding['level'], string> = { warning: 'A revisar', info: 'Sugerencias', ok: 'Correcto' }
/** Filas o pasos visibles antes de «Mostrar…»: el resto siempre está a un clic. */
const PREVIEW_ROWS = 10
const PREVIEW_STEPS = 12

interface InterpretationPanelProps {
  interpretation: Interpretation | null
  /** Por qué no hay interpretación (tipo sin análisis o código que no se pudo leer). */
  unavailable?: string
  /** Descarga el informe en PDF (imagen del diagrama + esta interpretación). */
  onDownloadReport?: () => void
  downloading?: boolean
}

const NOUNS = { fila: ['la fila restante', 'las {n} filas restantes'], paso: ['el paso restante', 'los {n} pasos restantes'] } as const

function MoreButton({ hidden, expanded, noun, onToggle }: { hidden: number; expanded: boolean; noun: keyof typeof NOUNS; onToggle: () => void }) {
  return (
    <button type="button" className="uml-more" onClick={onToggle}>
      {expanded ? 'Mostrar menos' : `Mostrar ${hidden === 1 ? NOUNS[noun][0] : NOUNS[noun][1].replace('{n}', String(hidden))}`}
    </button>
  )
}

function Block({ block }: { block: InterpretationBlock }) {
  const [expanded, setExpanded] = useState(false)
  if (block.kind === 'text') return <p className="uml-section-text">{block.text}</p>
  if (block.kind === 'list') {
    return (
      <ul className="uml-section-list">
        {block.items.map((item, index) => (
          <li key={index} style={{ marginLeft: `${(block.depths?.[index] ?? 0) * 1.1}rem` }}>{item}</li>
        ))}
      </ul>
    )
  }
  if (block.kind === 'table') {
    const rows = expanded ? block.rows : block.rows.slice(0, PREVIEW_ROWS)
    return (
      <>
        <div className="uml-table-wrap">
          <table className="uml-table">
            <thead>
              <tr>{block.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>{row.map((cell, column) => (column === 0 ? <th key={column} scope="row">{cell}</th> : <td key={column} className={cell === '—' ? 'uml-cell-empty' : undefined}>{cell}</td>))}</tr>
              ))}
            </tbody>
          </table>
        </div>
        {block.rows.length > PREVIEW_ROWS && <MoreButton hidden={block.rows.length - PREVIEW_ROWS} expanded={expanded} noun="fila" onToggle={() => setExpanded((value) => !value)} />}
      </>
    )
  }
  const steps = expanded ? block.steps : block.steps.slice(0, PREVIEW_STEPS)
  const hidden = block.steps.filter((step) => step.kind === 'step').length - steps.filter((step) => step.kind === 'step').length
  return (
    <>
      <ol className="uml-steps">
        {steps.map((step, index) =>
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
      {block.steps.length > PREVIEW_STEPS && <MoreButton hidden={hidden} expanded={expanded} noun="paso" onToggle={() => setExpanded((value) => !value)} />}
    </>
  )
}

function Section({ section }: { section: InterpretationSection }) {
  return (
    <section className="uml-section">
      <h4 className="uml-section-title">{section.title}</h4>
      {section.blocks.map((block, index) => <Block key={index} block={block} />)}
    </section>
  )
}

/**
 * Interpretación del diagrama: cifras clave, lo que afirma (en tablas, listas
 * y recorrido paso a paso, o como texto corrido) y las observaciones de
 * coherencia agrupadas por nivel.
 */
function InterpretationPanel({ interpretation, unavailable, onDownloadReport, downloading }: InterpretationPanelProps) {
  const [open, setOpen] = useState(true)
  const [view, setView] = useState<'structured' | 'text'>('structured')
  const warnings = interpretation?.findings.filter((finding) => finding.level === 'warning').length ?? 0
  const infos = interpretation?.findings.filter((finding) => finding.level === 'info').length ?? 0
  const [lead, ...sentences] = interpretation?.summary ?? []
  const structured = Boolean(interpretation?.sections?.length)

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
            <>
              <div className="uml-interpretation-top">
                {lead && <p className="uml-interpretation-lead">{lead}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  {structured && (
                    <div className="uml-view-switch" role="group" aria-label="Forma de ver la interpretación">
                      <button type="button" aria-pressed={view === 'structured'} className={view === 'structured' ? 'uml-view-active' : ''} onClick={() => setView('structured')}>▦ Tablas</button>
                      <button type="button" aria-pressed={view === 'text'} className={view === 'text' ? 'uml-view-active' : ''} onClick={() => setView('text')}>¶ Texto</button>
                    </div>
                  )}
                  {onDownloadReport && (
                    <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={onDownloadReport} disabled={downloading}>
                      {downloading ? 'Generando PDF…' : '⤓ Informe PDF'}
                    </button>
                  )}
                </div>
              </div>
              {interpretation.facts && interpretation.facts.length > 0 && (
                <dl className="uml-facts">
                  {interpretation.facts.map((item) => (
                    <div key={item.label} className="uml-fact">
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="uml-interpretation-grid">
                <div className="grid min-w-0 content-start gap-3">
                  <p className="uml-interpretation-heading">Lo que dice el diagrama</p>
                  {structured && view === 'structured' ? (
                    interpretation.sections!.map((section) => <Section key={section.title} section={section} />)
                  ) : sentences.length ? (
                    <ul className="uml-interpretation-summary">
                      {sentences.map((sentence, index) => (
                        <li key={index} className={sentence.trimStart().startsWith('•') ? 'uml-summary-bullet' : undefined}>{sentence.trim().replace(/^•\s*/, '')}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-[var(--text-muted)]">Sin más detalles.</p>
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
            </>
          )}
        </div>
      )}
    </section>
  )
}

export default InterpretationPanel

import { useState } from 'react'
import { Link } from 'react-router-dom'

import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  VALIDATION_LABELS,
  type ArchitectureException,
  type ArchitectureReport,
  type CoherenceFinding,
} from '../../../domain/uml/coherence'
import { CATEGORY_ICONS, focusLink, percent } from './shared'

interface FindingDetailProps {
  finding: CoherenceFinding
  report: ArchitectureReport
  listPath: string
  canEdit: boolean
  userName: string
  onAddException: (exception: ArchitectureException) => void
  onRemoveException: (fingerprint: string) => void
}

/** Detalle trazable de un hallazgo: evidencia por diagrama, con enlaces a los elementos. */
function FindingDetail({ finding, report, listPath, canEdit, userName, onAddException, onRemoveException }: FindingDetailProps) {
  const [justification, setJustification] = useState('')
  const [askingException, setAskingException] = useState(false)
  const actionable = finding.category !== 'coherent'

  return (
    <article className="arch-detail" aria-labelledby={`finding-${finding.id}`}>
      <p className="arch-detail-id">{finding.id} · {finding.ruleTitle}</p>
      <h3 id={`finding-${finding.id}`} className="arch-detail-title">{finding.title}</h3>
      <div className="arch-badges">
        <span className={`arch-badge arch-tone-${finding.category}`}>{CATEGORY_ICONS[finding.category]} {CATEGORY_LABELS[finding.category]}</span>
        {actionable && <span className="arch-badge">Severidad {SEVERITY_LABELS[finding.severity].toLowerCase()}</span>}
        <span className="arch-badge" title="Qué tan seguro es el análisis (lectura de los diagramas y correspondencias usadas). Es independiente de la severidad.">
          Confianza {percent(finding.confidence)}
        </span>
        <span className={`arch-badge ${finding.validation === 'heuristic' ? 'arch-tone-possible' : ''}`}>{VALIDATION_LABELS[finding.validation]}</span>
      </div>
      <p className="arch-detail-text">{finding.description}</p>

      <h4 className="uml-interpretation-heading mt-4">Evidencia en los diagramas</h4>
      <ul className="arch-evidence">
        {finding.evidence.map((evidence, index) => (
          <li key={index}>
            <p className="arch-evidence-diagram">{evidence.diagramName}</p>
            <p className="arch-evidence-text">{evidence.text}</p>
            {evidence.elements.length > 0 && (
              <p className="arch-chips">
                {evidence.elements.map((element) => (
                  <Link key={`${element.diagramId}:${element.elementId}`} to={focusLink(report, listPath, element)} className="arch-chip" title="Abrir el diagrama con este elemento seleccionado (en modo visual)">
                    {element.name}
                  </Link>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>

      <h4 className="uml-interpretation-heading mt-4">Por qué</h4>
      <p className="arch-detail-text">{finding.explanation}</p>
      {actionable && (
        <>
          <h4 className="uml-interpretation-heading mt-4">Impacto potencial</h4>
          <p className="arch-detail-text">{finding.impact}</p>
          <h4 className="uml-interpretation-heading mt-4">Recomendación</h4>
          <p className="arch-detail-text">{finding.recommendation}</p>
        </>
      )}
      <p className="mt-3 text-[0.7rem] text-[var(--text-muted)]">Regla <code>{finding.ruleId}</code> · tipo <code>{finding.type}</code></p>

      {finding.exception ? (
        <div className="arch-exception">
          <p className="font-semibold">Excepción aceptada</p>
          <p>{finding.exception.justification}</p>
          {(finding.exception.author || finding.exception.createdAt) && (
            <p className="text-[0.7rem] text-[var(--text-muted)]">
              {finding.exception.author}{finding.exception.createdAt ? ` · ${new Date(finding.exception.createdAt).toLocaleDateString('es-CL')}` : ''}
            </p>
          )}
          {canEdit && (
            <button type="button" className="btn-ghost mt-2 px-3 py-1 text-xs" onClick={() => onRemoveException(finding.fingerprint)}>
              Quitar excepción
            </button>
          )}
        </div>
      ) : (
        actionable &&
        canEdit &&
        (askingException ? (
          <form
            className="arch-exception"
            onSubmit={(event) => {
              event.preventDefault()
              if (!justification.trim()) return
              onAddException({ fingerprint: finding.fingerprint, ruleId: finding.ruleId, title: finding.title, justification: justification.trim(), author: userName, createdAt: new Date().toISOString() })
              setJustification('')
              setAskingException(false)
            }}
          >
            <label className="uml-field">
              <span>Justificación (obligatoria): por qué esta desviación es intencional</span>
              <textarea className="theme-input min-h-20 w-full rounded-md px-2 py-1.5 text-sm" value={justification} onChange={(event) => setJustification(event.target.value)} required />
            </label>
            <div className="flex gap-2">
              <button type="submit" className="btn-mint-primary px-3 py-1 text-xs font-semibold" disabled={!justification.trim()}>Registrar excepción</button>
              <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => setAskingException(false)}>Cancelar</button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn-ghost mt-4 px-3 py-1 text-xs" onClick={() => setAskingException(true)}>
            Registrar como excepción justificada…
          </button>
        ))
      )}
    </article>
  )
}

export default FindingDetail

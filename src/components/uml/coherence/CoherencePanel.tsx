import { useMemo, useState } from 'react'

import CoverageView from './CoverageView'
import EquivalencesView from './EquivalencesView'
import FindingDetail from './FindingDetail'
import SettingsView from './SettingsView'
import { CATEGORY_ICONS, CATEGORY_ORDER, CATEGORY_SHORT, STATUS_TONE, percent } from './shared'
import { SEVERITY_LABELS, reportToMarkdown, type FindingCategory, type GlobalInterpretation, type InterpretationItem } from '../../../domain/uml/coherence'
import { diagramFileName } from '../../../domain/diagramSvg'
import { useArchitectureReview } from '../../../hooks/useArchitectureReview'
import { downloadMarkdown } from '../../../lib/diagramExport'

interface CoherencePanelProps {
  boardId: string
  boardName: string
  boardDescription?: string | null
  canEdit: boolean
  narrow: boolean
  listPath: string
  userName: string
}

type Tab = 'findings' | 'interpretation' | 'coverage' | 'equivalences' | 'settings'

const INTERPRETATION_SECTIONS: Array<[keyof GlobalInterpretation, string]> = [
  ['architecture', 'Arquitectura que describen los diagramas'],
  ['crossCutting', 'Elementos presentes en varias vistas'],
  ['scenarios', 'Escenarios funcionales respaldados'],
  ['contradictions', 'Contradicciones entre vistas'],
  ['unmatched', 'Sin correspondencia u omisiones a revisar'],
  ['unverifiable', 'No verificable con la evidencia disponible'],
  ['conclusion', 'Conclusión'],
]

/**
 * Evaluación de coherencia entre los diagramas del tablero: estado general,
 * hallazgos trazables, interpretación global, cobertura, equivalencias y
 * configuración de las reglas.
 */
function CoherencePanel({ boardId, boardName, boardDescription, canEdit, narrow, listPath, userName }: CoherencePanelProps) {
  const review = useArchitectureReview(boardId, canEdit)
  const { report, settings } = review
  const [tab, setTab] = useState<Tab>('findings')
  const [filter, setFilter] = useState<FindingCategory | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pdfProgress, setPdfProgress] = useState('')
  const [pdfError, setPdfError] = useState('')

  const visible = useMemo(() => (report?.findings ?? []).filter((finding) => filter === 'all' || finding.category === filter), [filter, report])
  const selected = visible.find((finding) => finding.id === selectedId) ?? visible.find((finding) => finding.category !== 'coherent') ?? visible[0] ?? null
  const counts = useMemo(() => {
    const result = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, 0])) as Record<FindingCategory, number>
    for (const finding of report?.findings ?? []) if (!finding.exception) result[finding.category] += 1
    return result
  }, [report])

  if (review.loading && !report) return <p className="text-slate-400">Analizando los diagramas del tablero…</p>
  if (review.error && !report) {
    return (
      <div>
        <p className="alert-error rounded-lg p-3 text-sm" role="alert">{review.error}</p>
        <button type="button" className="btn-ghost mt-3 px-4 py-2 text-sm" onClick={review.reload}>Reintentar</button>
      </div>
    )
  }
  if (!report) return null

  async function downloadPdf() {
    if (!report || !review.diagrams) return
    setPdfError('')
    try {
      // Se carga solo al pedirlo: incluye jsPDF y el dibujo de cada diagrama.
      const { downloadArchitectureReport } = await import('../../../lib/architectureReportDownload')
      await downloadArchitectureReport(
        { project: { name: boardName, description: boardDescription }, report, settings, diagrams: review.diagrams, author: userName },
        setPdfProgress,
      )
    } catch (err) {
      setPdfError(err instanceof Error ? `No se pudo generar el PDF: ${err.message}` : 'No se pudo generar el PDF.')
    } finally {
      setPdfProgress('')
    }
  }

  const openFinding = (id: string) => {
    setFilter('all')
    setSelectedId(id)
    setTab('findings')
  }
  const references = (item: InterpretationItem) =>
    item.findings?.length ? (
      <span className="ml-1 inline-flex flex-wrap gap-1">
        {item.findings.slice(0, 8).map((id) => (
          <button key={id} type="button" className="arch-ref" onClick={() => openFinding(id)}>{id}</button>
        ))}
      </span>
    ) : null
  const pending = report.correspondences.filter((item) => item.status === 'hypothesis').length
  const exceptions = report.findings.filter((finding) => finding.exception).length
  const tabs: Array<[Tab, string]> = [
    ['findings', `Hallazgos (${report.findings.length})`],
    ['interpretation', 'Interpretación global'],
    ['coverage', 'Cobertura'],
    ['equivalences', `Equivalencias${pending ? ` (${pending} por validar)` : ''}`],
    ['settings', 'Configuración'],
  ]

  return (
    <section className="glass-panel rounded-2xl p-3 sm:p-5" aria-label="Coherencia arquitectónica">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`arch-status ${STATUS_TONE[report.status]}`}>{report.statusLabel}</p>
          <p className="mt-2 text-sm text-[var(--text-main)]">
            {report.index.value === null
              ? 'Sin comprobaciones concluyentes entre vistas.'
              : `${report.index.consistent} de ${report.index.conclusive} comprobaciones concluyentes resultaron coherentes.`}
          </p>
          <details className="mt-1 text-xs text-[var(--text-muted)]">
            <summary className="cursor-pointer">Cómo se calcula</summary>
            <p className="mt-1 max-w-2xl">
              Coherentes ÷ (coherentes + contradicciones + posibles inconsistencias), solo sobre las comparaciones ejecutadas. Las omisiones, lo no verificable
              {exceptions ? ` y las ${exceptions} excepción(es) aceptada(s)` : ' y las excepciones aceptadas'} no cuentan, para no confundir falta de evidencia con incoherencia. No mide la cobertura: revísala en su pestaña.
              El análisis es por reglas deterministas, se ejecuta en tu navegador y no usa servicios de IA.
            </p>
          </details>
          <ul className="arch-view-chips" aria-label="Vistas representadas">
            {report.coverage.views.map((view) => (
              <li key={view.view} className={view.diagrams.length ? 'arch-view-on' : 'arch-view-off'} title={view.missing ?? view.diagrams.map((diagram) => diagram.name).join(', ')}>
                {view.diagrams.length ? '●' : '○'} {view.label}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={review.reload} disabled={review.loading}>
            {review.loading ? 'Analizando…' : '↻ Volver a analizar'}
          </button>
          <button type="button" className="btn-mint-primary px-3 py-1.5 text-sm font-semibold" onClick={() => void downloadPdf()} disabled={Boolean(pdfProgress)} title="Informe de diseño y coherencia arquitectónica, con portada, índice, hallazgos, plan de acción y los diagramas del proyecto">
            {pdfProgress || '⤓ Informe PDF'}
          </button>
          <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => downloadMarkdown(reportToMarkdown(report, boardName), diagramFileName(`coherencia ${boardName}`, 'md'))} title="Texto estructurado, liviano para compartir o para analizarlo con otras herramientas">
            ⤓ Markdown
          </button>
        </div>
      </header>
      {review.error && <p className="alert-error mt-3 rounded-lg p-2 text-xs" role="alert">{review.error}</p>}
      {pdfError && <p className="alert-error mt-3 rounded-lg p-2 text-xs" role="alert">{pdfError}</p>}
      {review.saveError && <p className="alert-warning mt-3 rounded-lg p-2 text-xs" role="status">{review.saveError}</p>}
      {!review.settingsAvailable && !review.saveError && (
        <p className="alert-warning mt-3 rounded-lg p-2 text-xs" role="status">La configuración no se puede guardar todavía (falta la migración 20261012120000_board_architecture_settings.sql): los cambios solo duran esta sesión.</p>
      )}

      <div className="arch-counts" aria-label="Resumen por categoría">
        {CATEGORY_ORDER.map((category) => (
          <span key={category} className={`arch-count arch-tone-${category}`}>{CATEGORY_ICONS[category]} {counts[category]} {CATEGORY_SHORT[category].toLowerCase()}</span>
        ))}
      </div>

      <nav className="arch-tabs" role="tablist" aria-label="Secciones del análisis">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`arch-tab ${tab === id ? 'arch-tab-active' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {tab === 'findings' && (
        <div className={narrow ? 'grid gap-3' : 'arch-findings'}>
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Filtrar hallazgos">
              {(['all', ...CATEGORY_ORDER] as const).map((category) => (
                <button key={category} type="button" className={`arch-filter ${filter === category ? 'arch-filter-active' : ''}`} onClick={() => setFilter(category)} aria-pressed={filter === category}>
                  {category === 'all' ? 'Todos' : CATEGORY_SHORT[category]}
                </button>
              ))}
            </div>
            {visible.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No hay hallazgos en esta categoría.</p>
            ) : (
              <ul className="arch-finding-list">
                {visible.map((finding) => (
                  <li key={finding.id}>
                    <button type="button" className={`arch-finding arch-tone-${finding.category} ${selected?.id === finding.id ? 'arch-finding-active' : ''} ${finding.exception ? 'arch-finding-excepted' : ''}`} onClick={() => setSelectedId(finding.id)}>
                      <span className="arch-finding-icon" aria-hidden="true">{CATEGORY_ICONS[finding.category]}</span>
                      <span className="min-w-0">
                        <span className="arch-finding-title">{finding.title}</span>
                        <span className="arch-finding-meta">
                          {finding.id}
                          {finding.category !== 'coherent' && ` · severidad ${SEVERITY_LABELS[finding.severity].toLowerCase()}`} · confianza {percent(finding.confidence)} · {finding.diagrams.length} diagrama(s)
                          {finding.exception && ' · excepción aceptada'}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {selected && (
            <FindingDetail
              key={selected.id}
              finding={selected}
              report={report}
              listPath={listPath}
              canEdit={canEdit}
              userName={userName}
              onAddException={(exception) => void review.updateSettings({ ...settings, exceptions: [...settings.exceptions.filter((item) => item.fingerprint !== exception.fingerprint), exception] })}
              onRemoveException={(fingerprint) => void review.updateSettings({ ...settings, exceptions: settings.exceptions.filter((item) => item.fingerprint !== fingerprint) })}
            />
          )}
        </div>
      )}

      {tab === 'interpretation' && (
        <div className="grid gap-4">
          <p className="text-xs text-[var(--text-muted)]">Redactada a partir del modelo extraído y de los hallazgos: cada afirmación remite a los hallazgos en que se apoya.</p>
          {INTERPRETATION_SECTIONS.map(([key, title]) =>
            report.interpretation[key].length ? (
              <section key={key}>
                <h3 className="uml-interpretation-heading">{title}</h3>
                <ul className="arch-list">
                  {report.interpretation[key].map((item, index) => <li key={index}>{item.text}{references(item)}</li>)}
                </ul>
              </section>
            ) : null,
          )}
        </div>
      )}

      {tab === 'coverage' && <CoverageView coverage={report.coverage} />}
      {tab === 'equivalences' && <EquivalencesView report={report} settings={settings} canEdit={canEdit} onChange={(next) => void review.updateSettings(next)} />}
      {tab === 'settings' && <SettingsView report={report} settings={settings} canEdit={canEdit} onChange={(next) => void review.updateSettings(next)} />}
      {review.saving && <p className="mt-3 text-xs text-[var(--text-muted)]">Guardando configuración…</p>}
    </section>
  )
}

export default CoherencePanel

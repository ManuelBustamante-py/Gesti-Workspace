/**
 * Evaluación de coherencia arquitectónica entre los diagramas de un tablero.
 *
 * Flujo: extracción (modelo común) → correspondencias y conceptos → reglas
 * deterministas por par de vistas → hallazgos trazables → cobertura →
 * interpretación global. Es una función pura: con las mismas entradas y la
 * misma configuración el informe es idéntico (sin fechas ni azar).
 *
 * Índice de coherencia verificada = coherentes / (coherentes + contradicciones
 * + posibles inconsistencias). Solo cuenta comprobaciones concluyentes: las
 * omisiones, lo no verificable y las excepciones aceptadas quedan fuera, para
 * no equiparar ausencia de evidencia con incoherencia. No mide cobertura: se
 * informa aparte.
 */
import { createContext, type FindingDraft, type RuleContext, type RuleOutcome, type RuleSpec } from './context'
import { buildCoverage, type RuleRun } from './coverage'
import { extractArchitecture } from './extract'
import { buildInterpretation } from './interpretation'
import { buildConcepts, findCorrespondences, stableKey } from './matching'
import { normalizeName } from './names'
import { RULES } from './rules'
import { sanitizeSettings } from './settings'
import type { ArchitectureReport, CoherenceFinding, CoherenceIndex, CoherenceStatus, DiagramInput, FindingCategory, Severity } from './types'

/** Por debajo de esta confianza una contradicción se informa como posible inconsistencia. */
export const CONTRADICTION_MIN_CONFIDENCE = 0.6

const CATEGORY_ORDER: Record<FindingCategory, number> = { contradiction: 0, possible: 1, omission: 2, unverifiable: 3, coherent: 5 }
const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
const round = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 100) / 100

const KIND_LABELS: Record<string, string> = {
  usecase: 'casos de uso', sequence: 'secuencia', class: 'clases', package: 'paquetes', component: 'componentes', deployment: 'despliegue', er: 'entidad-relación',
}

/** Identidad estable de las partes de un sujeto: no depende de ids internos ni del orden de los conceptos. */
function stabilizer(ctx: RuleContext) {
  const token = (part: string): string => {
    const element = ctx.elements.get(part)
    if (element) return stableKey(element)
    const relation = ctx.relationsByKey.get(part)
    if (relation) return `${relation.diagramId}/${relation.type}/${token(relation.source)}>${token(relation.target)}`
    const message = ctx.messagesByKey.get(part)
    if (message) return `${message.diagramId}/msg/${normalizeName(message.label)}`
    if (/^K\d+$/.test(part)) return `c/${normalizeName(ctx.concepts.find((concept) => concept.id === part)?.label ?? part)}`
    return part
  }
  return (part: string) => part.split(/([>|])/).map((piece) => (piece === '>' || piece === '|' ? piece : token(piece))).join('')
}

function runRule(rule: RuleSpec, ctx: RuleContext, kinds: Set<string>): RuleRun {
  if (ctx.settings.disabledRules.includes(rule.id)) return { rule, status: 'disabled', reason: 'Desactivada en la configuración.' }
  const missing = rule.requires.filter((group) => !group.some((kind) => kinds.has(kind)))
  if (missing.length) {
    return { rule, status: 'skipped', reason: `Falta un diagrama de ${missing.map((group) => group.map((kind) => KIND_LABELS[kind] ?? kind).join(' o ')).join(' y de ')} con contenido.` }
  }
  const blocked = rule.precondition?.(ctx)
  if (blocked) return { rule, status: 'skipped', reason: blocked }
  try {
    return { rule, status: 'executed', outcome: rule.run(ctx) }
  } catch (error) {
    // Una regla defectuosa no debe impedir el resto del informe; se informa en la cobertura.
    return { rule, status: 'skipped', reason: `La regla falló al ejecutarse: ${error instanceof Error ? error.message : 'error desconocido'}.` }
  }
}

function finalize(rule: RuleSpec, draft: FindingDraft, ctx: RuleContext, stable: (part: string) => string): CoherenceFinding {
  const elements = [...new Map(draft.elements.map((key) => [key, ctx.ref(key)])).values()]
  const diagrams = [...new Set([...elements.map((item) => item.diagramId), ...draft.evidence.map((item) => item.diagramId)])].filter((id) => ctx.diagrams.has(id)).sort()
  const extraction = diagrams.length ? Math.min(...diagrams.map((id) => ctx.diagrams.get(id)!.extraction.confidence)) : 1
  const confidence = round(draft.confidence * extraction)
  const fingerprint = `${rule.id}|${draft.type}|${draft.subject.map(stable).sort().join('|')}`
  const exception = ctx.settings.exceptions.find((item) => item.fingerprint === fingerprint)
  let category = draft.category
  let explanation = draft.explanation
  if (category === 'contradiction' && confidence < CONTRADICTION_MIN_CONFIDENCE) {
    category = 'possible'
    explanation += ` Se informa como posible inconsistencia y no como contradicción confirmada porque la confianza (${Math.round(confidence * 100)} %) es baja${extraction < 1 ? ': la lectura de algún diagrama es incierta' : ''}.`
  }
  return {
    id: '',
    fingerprint,
    ruleId: rule.id,
    ruleTitle: rule.title,
    comparison: rule.comparison,
    category,
    type: draft.type,
    severity: draft.severity,
    confidence,
    title: draft.title,
    description: draft.description,
    diagrams,
    elements,
    evidence: draft.evidence,
    explanation,
    impact: draft.impact,
    recommendation: draft.recommendation,
    validation: exception ? 'exception' : draft.heuristic || confidence < 0.85 ? 'heuristic' : 'deterministic',
    ...(exception ? { exception } : {}),
  }
}

function coherentFinding(rule: RuleSpec, outcome: RuleOutcome, ctx: RuleContext): CoherenceFinding {
  const keys = [...new Set(outcome.passed.flatMap((item) => item.elements))]
  const elements = keys.slice(0, 40).map(ctx.ref)
  const diagrams = [...new Set(elements.map((item) => item.diagramId))].filter((id) => ctx.diagrams.has(id)).sort()
  const extraction = diagrams.length ? Math.min(...diagrams.map((id) => ctx.diagrams.get(id)!.extraction.confidence)) : 1
  return {
    id: '',
    fingerprint: `${rule.id}|coherent`,
    ruleId: rule.id,
    ruleTitle: rule.title,
    comparison: rule.comparison,
    category: 'coherent',
    type: 'verified',
    severity: 'low',
    confidence: round(extraction),
    title: `${rule.title}: ${outcome.passed.length} comprobación(es) coherente(s)`,
    description: outcome.passed.slice(0, 6).map((item) => item.text).join(' ') + (outcome.passed.length > 6 ? ` …y ${outcome.passed.length - 6} más.` : ''),
    diagrams,
    elements,
    evidence: outcome.passed.slice(0, 12).map((item) => {
      const first = item.elements.map(ctx.ref)[0]
      return ctx.evidence(first?.diagramId ?? diagrams[0] ?? '', item.text, item.elements)
    }),
    explanation: rule.description,
    impact: 'Las vistas comparadas son compatibles en estos puntos.',
    recommendation: 'Sin acciones: mantén la coherencia al modificar cualquiera de los diagramas.',
    validation: 'deterministic',
  }
}

const sortKey = (finding: CoherenceFinding) => [
  finding.exception ? 4 : CATEGORY_ORDER[finding.category],
  SEVERITY_ORDER[finding.severity],
  1 - finding.confidence,
] as const

export function evaluateArchitecture(inputs: DiagramInput[], rawSettings?: unknown): ArchitectureReport {
  const settings = sanitizeSettings(rawSettings)
  const model = extractArchitecture(Array.isArray(inputs) ? inputs : [])
  const correspondences = findCorrespondences(model, settings)
  const concepts = buildConcepts(model, correspondences)
  const ctx = createContext(model, concepts, correspondences, settings)
  const stable = stabilizer(ctx)

  const withContent = new Set(model.diagrams.filter((diagram) => !diagram.extraction.failed && model.elements.some((element) => element.diagramId === diagram.id)).map((diagram) => diagram.kind))
  const runs = RULES.map((rule) => runRule(rule, ctx, withContent))

  const findings: CoherenceFinding[] = []
  for (const run of runs) {
    if (!run.outcome) continue
    for (const draft of run.outcome.findings) findings.push(finalize(run.rule, draft, ctx, stable))
    if (run.outcome.passed.length) findings.push(coherentFinding(run.rule, run.outcome, ctx))
  }
  // El mismo hallazgo (misma huella) puede surgir de dos diagramas: se deja uno.
  const unique = [...new Map(findings.map((finding) => [finding.fingerprint, finding])).values()]
  unique.sort((a, b) => {
    const [x, y] = [sortKey(a), sortKey(b)]
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.ruleId.localeCompare(b.ruleId) || a.fingerprint.localeCompare(b.fingerprint)
  })
  unique.forEach((finding, index) => (finding.id = `C-${String(index + 1).padStart(3, '0')}`))

  const active = unique.filter((finding) => !finding.exception)
  const consistent = runs.reduce((total, run) => total + (run.outcome?.passed.length ?? 0), 0)
  const contradictions = active.filter((finding) => finding.category === 'contradiction').length
  const possible = active.filter((finding) => finding.category === 'possible').length
  const conclusive = consistent + contradictions + possible
  const index: CoherenceIndex = { conclusive, consistent, contradictions, possible, value: conclusive ? round(consistent / conclusive) : null }

  const status: CoherenceStatus = !conclusive ? 'not-evaluable' : contradictions ? 'contradictions' : possible ? 'possible-issues' : 'consistent-so-far'
  const statusLabel = {
    'not-evaluable': 'No evaluable con la información disponible',
    contradictions: `${contradictions} contradicción(es) confirmada(s)`,
    'possible-issues': 'Sin contradicciones confirmadas; hay posibles inconsistencias',
    'consistent-so-far': 'Sin contradicciones en lo evaluado',
  }[status]

  const coverage = buildCoverage(ctx, runs)
  const interpretation = buildInterpretation(ctx, unique, coverage, index, status)
  return { status, statusLabel, index, findings: unique, correspondences, concepts, coverage, interpretation, model }
}

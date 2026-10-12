import type { jsPDF as JsPdf } from 'jspdf'

import {
  CATEGORY_LABELS,
  COMPARISONS,
  RULES,
  SEVERITY_LABELS,
  VALIDATION_LABELS,
  VIEW_LABELS,
  type ArchitectureReport,
  type ArchitectureSettings,
  type CoherenceFinding,
  type FindingCategory,
  type InterpretationItem,
} from '../domain/uml/coherence'
import type { Interpretation } from '../domain/uml/interpret'
import { COLORS, PAGE_MARGIN, createPdfLayout, pdfText, reportDate, type PdfLayout, type ReportImage, type Rgb } from './pdfLayout'

/**
 * Informe de diseño y coherencia arquitectónica del proyecto: portada,
 * índice, resumen ejecutivo, alcance y metodología, arquitectura descrita,
 * cobertura, hallazgos, correspondencias, plan de acción y anexos con cada
 * diagrama. Todo sale del informe de coherencia ya calculado y de la
 * interpretación de cada diagrama: no se analiza nada nuevo aquí.
 */

export type ReportDiagram = {
  id: string
  name: string
  kind: string
  typeName: string
  mode: 'code' | 'visual'
  interpretation: Interpretation | null
  image: ReportImage | null
}

export type ArchitectureReportInput = {
  project: { name: string; description?: string | null }
  report: ArchitectureReport
  settings: ArchitectureSettings
  diagrams: ReportDiagram[]
  author: string
  generatedAt: Date
}

const TONES: Record<FindingCategory, Rgb> = {
  contradiction: COLORS.warning,
  possible: COLORS.info,
  omission: COLORS.blue,
  unverifiable: COLORS.muted,
  coherent: COLORS.ok,
}
const STATUS_TONES = { contradictions: COLORS.warning, 'possible-issues': COLORS.info, 'consistent-so-far': COLORS.ok, 'not-evaluable': COLORS.muted } as const
const CATEGORY_MEANING: Record<FindingCategory, string> = {
  contradiction: 'Dos vistas afirman cosas incompatibles sobre datos explícitos y con confianza suficiente. Debe resolverse.',
  possible: 'Hay indicios de incompatibilidad, pero dependen de heurísticas o de una lectura incierta. Debe revisarse.',
  omission: 'Una vista no refleja algo que otra sí muestra. Puede ser simplificación legítima; conviene revisarlo.',
  unverifiable: 'No hay evidencia suficiente para comprobar el aspecto. No es una inconsistencia.',
  coherent: 'Las vistas comparadas son compatibles en ese punto.',
}
const COMPARISON_STATUS = { executed: 'Ejecutada', skipped: 'Omitida', 'no-correspondence': 'Sin correspondencias' } as const
const RULE_STATUS = { executed: 'Ejecutada', skipped: 'Omitida', disabled: 'Desactivada' } as const
const percent = (value: number) => `${Math.round(value * 100)} %`
const ids = (list: string[], max = 8) => (list.length > max ? `${list.slice(0, max).join(', ')} y ${list.length - max} más` : list.join(', '))
const itemText = (item: InterpretationItem) => `${item.text}${item.findings?.length ? ` (${ids(item.findings, 6)})` : ''}`

export function buildArchitectureReport(JsPDF: typeof JsPdf, input: ArchitectureReportInput): JsPdf {
  const { report, project } = input
  const doc = new JsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
  const layout = createPdfLayout(doc)
  const toc: Array<{ title: string; page: number; level: 0 | 1 }> = []
  let chapterNumber = 0

  const chapter = (title: string, numbered = true) => {
    layout.newPage()
    const label = numbered ? `${(chapterNumber += 1)}. ${title}` : title
    toc.push({ title: label, page: doc.getNumberOfPages(), level: 0 })
    layout.paragraph(label, { size: 17, bold: true, rgb: COLORS.text, gap: 4 })
    doc.setDrawColor(COLORS.accent[0], COLORS.accent[1], COLORS.accent[2])
    doc.setLineWidth(1.2)
    doc.line(PAGE_MARGIN, layout.y, PAGE_MARGIN + layout.contentWidth, layout.y)
    layout.y += 14
    return label
  }
  const tocEntry = (title: string) => toc.push({ title, page: doc.getNumberOfPages(), level: 1 })
  const labeled = (label: string, text: string, layoutRef: PdfLayout = layout) => {
    layoutRef.paragraph(label.toUpperCase(), { size: 7.5, bold: true, rgb: COLORS.muted, gap: 0 })
    layoutRef.paragraph(text, { size: 9.5, gap: 5 })
  }

  const active = report.findings.filter((finding) => !finding.exception)
  const byCategory = (category: FindingCategory) => active.filter((finding) => finding.category === category)
  const executed = report.coverage.comparisons.filter((item) => item.status === 'executed').length
  const applicable = report.coverage.comparisons.filter((item) => item.id !== 'mvc' || input.settings.style === 'mvc').length
  const views = report.coverage.views.filter((view) => view.diagrams.length).map((view) => view.label)
  const analyzed = report.model.diagrams.filter((diagram) => !diagram.extraction.failed)

  // --- Portada -----------------------------------------------------------------------------
  doc.setFillColor(40, 50, 56)
  doc.rect(0, 0, layout.pageWidth, 250, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(170, 186, 190)
  doc.text(pdfText('INFORME DE DISEÑO Y COHERENCIA ARQUITECTÓNICA'), PAGE_MARGIN, 92)
  doc.setFontSize(26)
  doc.setTextColor(255, 255, 255)
  const titleLines = doc.splitTextToSize(pdfText(`Proyecto ${project.name}`), layout.contentWidth) as string[]
  doc.text(titleLines, PAGE_MARGIN, 128)
  if (project.description?.trim()) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(214, 222, 224)
    doc.text((doc.splitTextToSize(pdfText(project.description.trim()), layout.contentWidth) as string[]).slice(0, 4), PAGE_MARGIN, 128 + titleLines.length * 30 + 4)
  }
  layout.y = 290
  layout.table(['Dato', 'Valor'], [
    ['Fecha de emisión', reportDate.format(input.generatedAt)],
    ['Elaborado por', input.author || '—'],
    ['Diagramas analizados', `${analyzed.length} de ${report.model.diagrams.length + report.model.ignored.length}`],
    ['Vistas representadas', views.join(', ') || '—'],
    ['Estilo arquitectónico declarado', input.settings.style === 'mvc' ? `MVC (${input.settings.mvc.variant === 'passive' ? 'vista pasiva' : 'clásico'})` : 'No declarado'],
    ['Comparaciones entre vistas', `${executed} de ${applicable} ejecutadas`],
  ])
  const tone = STATUS_TONES[report.status]
  layout.y += 6
  doc.setDrawColor(tone[0], tone[1], tone[2])
  doc.setFillColor(250, 250, 251)
  doc.setLineWidth(1.2)
  doc.roundedRect(PAGE_MARGIN, layout.y, layout.contentWidth, 70, 6, 6, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  layout.color(COLORS.muted)
  doc.text('ESTADO DE LA EVALUACIÓN', PAGE_MARGIN + 14, layout.y + 20)
  doc.setFontSize(15)
  layout.color(tone)
  doc.text(pdfText(report.statusLabel), PAGE_MARGIN + 14, layout.y + 40)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  layout.color(COLORS.text)
  doc.text(pdfText(report.index.value === null ? 'Sin comprobaciones concluyentes.' : `Índice de coherencia verificada: ${report.index.consistent} de ${report.index.conclusive} comprobaciones concluyentes (${percent(report.index.value)}).`), PAGE_MARGIN + 14, layout.y + 58)
  layout.y += 90
  const SHORT: Record<FindingCategory, string> = { contradiction: 'Contradicciones', possible: 'Posibles', omission: 'Omisiones', unverifiable: 'No verificable', coherent: 'Coherentes' }
  layout.facts((['contradiction', 'possible', 'omission', 'unverifiable', 'coherent'] as const).map((category) => ({ label: SHORT[category], value: String(byCategory(category).length), tone: TONES[category] })), 5)
  // Nota al pie de la portada: se dibuja directo para que nunca pase a otra página.
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  layout.color(COLORS.muted)
  doc.text(doc.splitTextToSize(pdfText('Documento generado automáticamente por Gesti - Workspace a partir de los diagramas del tablero, con un motor de reglas deterministas. Las conclusiones se limitan a las vistas presentes y a las correspondencias identificables entre ellas.'), layout.contentWidth) as string[], PAGE_MARGIN, layout.pageHeight - 70)

  // --- Índice (se completa al final) ----------------------------------------------------------
  layout.newPage()
  const tocPage = doc.getNumberOfPages()

  // --- 1. Resumen ejecutivo -------------------------------------------------------------------
  chapter('Resumen ejecutivo')
  layout.paragraph(report.interpretation.conclusion.map((item) => item.text).join(' '), { size: 10.5, gap: 10 })
  layout.facts([
    { label: 'Contradicciones', value: String(report.index.contradictions), tone: COLORS.warning },
    { label: 'Posibles inconsistencias', value: String(report.index.possible), tone: COLORS.info },
    { label: 'Coherentes', value: String(report.index.consistent), tone: COLORS.ok },
    { label: 'Comparaciones ejecutadas', value: `${executed} de ${applicable}` },
  ])
  layout.subheading('Hallazgos prioritarios')
  const priority = active.filter((finding) => finding.category === 'contradiction' || finding.category === 'possible').slice(0, 10)
  if (priority.length) {
    layout.table(['ID', 'Hallazgo', 'Categoría', 'Severidad', 'Confianza'], priority.map((finding) => [finding.id, finding.title, CATEGORY_LABELS[finding.category], SEVERITY_LABELS[finding.severity], percent(finding.confidence)]), { tones: priority.map((finding) => TONES[finding.category]) })
    if (active.filter((finding) => finding.category === 'contradiction' || finding.category === 'possible').length > priority.length) layout.paragraph('El listado completo está en el capítulo «Hallazgos».', { size: 8.5, italic: true, rgb: COLORS.muted })
  } else layout.paragraph('No hay contradicciones ni posibles inconsistencias en las comparaciones ejecutadas.', { rgb: COLORS.ok, bold: true })
  layout.subheading('Lo que no se pudo verificar')
  for (const item of report.interpretation.unverifiable.slice(0, 8)) layout.item(itemText(item), { rgb: COLORS.muted })

  // --- 2. Alcance y metodología ---------------------------------------------------------------
  chapter('Alcance y metodología')
  layout.subheading('Diagramas analizados')
  layout.table(['Diagrama', 'Tipo', 'Vista', 'Modo', 'Lectura', 'Contenido'], report.model.diagrams.map((diagram) => {
    const elements = report.model.elements.filter((element) => element.diagramId === diagram.id).length
    const relations = report.model.relations.filter((relation) => relation.diagramId === diagram.id).length + report.model.messages.filter((message) => message.diagramId === diagram.id).length
    return [
      diagram.name,
      input.diagrams.find((item) => item.id === diagram.id)?.typeName ?? diagram.kind,
      VIEW_LABELS[diagram.view],
      diagram.mode === 'visual' ? 'Visual' : 'Código',
      diagram.extraction.failed ? 'No legible' : percent(diagram.extraction.confidence),
      `${elements} elementos, ${relations} relaciones o mensajes`,
    ]
  }))
  if (report.model.ignored.length) {
    layout.paragraph('Diagramas del tablero que el motor de coherencia aún no compara (sí se describen en el anexo A):', { size: 9.5, gap: 2 })
    for (const ignored of report.model.ignored) layout.item(`${ignored.name} (${input.diagrams.find((item) => item.id === ignored.id)?.typeName ?? ignored.kind})`, { rgb: COLORS.muted })
  }
  layout.subheading('Cómo se evaluó')
  for (const step of [
    'Cada diagrama se normaliza a un modelo común (elementos, relaciones y mensajes) que conserva la referencia a su origen.',
    'Los elementos de distintos diagramas se enlazan solo si sus tipos son compatibles; cada correspondencia guarda su evidencia y su confianza, y las dudosas quedan como hipótesis sin usarse para concluir.',
    `Se aplican ${RULES.length} reglas deterministas agrupadas en ${COMPARISONS.length} comparaciones entre vistas (escenarios, lógica, procesos, desarrollo, física y datos).`,
    'Cada resultado se clasifica, se le asigna severidad (impacto) y confianza (certeza del análisis) por separado, y se vincula con la evidencia de cada diagrama.',
    'El análisis no usa servicios de inteligencia artificial: con las mismas entradas y la misma configuración el resultado es idéntico.',
  ]) layout.item(step, { rgb: COLORS.accent })
  layout.subheading('Categorías de resultado')
  layout.table(['Categoría', 'Significado'], (['contradiction', 'possible', 'omission', 'unverifiable', 'coherent'] as const).map((category) => [CATEGORY_LABELS[category], CATEGORY_MEANING[category]]), { tones: (['contradiction', 'possible', 'omission', 'unverifiable', 'coherent'] as const).map((category) => TONES[category]) })
  layout.subheading('Índice de coherencia verificada')
  layout.paragraph('Coherentes ÷ (coherentes + contradicciones + posibles inconsistencias), solo sobre las comparaciones ejecutadas. Las omisiones, los aspectos no verificables y las excepciones aceptadas no cuentan, para no confundir la falta de evidencia con incoherencia. El índice no mide cobertura: una arquitectura puede ser coherente en lo evaluado y tener poca documentación.')
  layout.subheading('Limitaciones')
  for (const limitation of [
    'Solo se analizan diagramas en PlantUML o en el editor visual; no se interpretan imágenes ni documentos.',
    'Las correspondencias se basan en nombres y tipos: un mismo concepto con nombres muy distintos requiere confirmar la equivalencia.',
    'Un diagrama parcial no se trata como contrato completo salvo que se declare así en la configuración.',
    'La ausencia de un diagrama impide evaluar sus relaciones con las demás vistas; no se interpreta como error.',
  ]) layout.item(limitation, { rgb: COLORS.muted })

  // --- 3. Arquitectura descrita ----------------------------------------------------------------
  chapter('Arquitectura descrita')
  const interpretationSections: Array<[keyof ArchitectureReport['interpretation'], string]> = [
    ['architecture', 'Visión general'],
    ['crossCutting', 'Elementos presentes en varias vistas'],
    ['scenarios', 'Escenarios funcionales respaldados'],
    ['contradictions', 'Puntos donde las vistas divergen'],
    ['unmatched', 'Elementos sin correspondencia y omisiones'],
  ]
  for (const [key, title] of interpretationSections) {
    const items = report.interpretation[key]
    if (!items.length) continue
    layout.subheading(title)
    for (const item of items) layout.item(itemText(item), { rgb: COLORS.accent })
  }

  // --- 4. Cobertura ----------------------------------------------------------------------------
  chapter('Cobertura de la evaluación')
  layout.paragraph('Qué vistas arquitectónicas están documentadas, qué se pudo comparar entre ellas y qué faltaría para ampliar el análisis.', { rgb: COLORS.muted, gap: 8 })
  layout.subheading('Vistas arquitectónicas')
  layout.table(['Vista', 'Diagramas', 'Qué se puede evaluar'], report.coverage.views.map((view) => [view.label, view.diagrams.map((diagram) => diagram.name).join(', ') || '—', view.missing ?? view.aspects.join('\n')]), {
    tones: report.coverage.views.map((view) => (view.diagrams.length ? COLORS.ok : COLORS.muted)),
  })
  layout.subheading('Comparaciones entre vistas')
  layout.table(['Comparación', 'Estado', 'Detalle'], report.coverage.comparisons.map((comparison) => [comparison.title, COMPARISON_STATUS[comparison.status], [comparison.reason, comparison.enable ? `Para ejecutarla: ${comparison.enable}` : ''].filter(Boolean).join('\n') || `${comparison.rules.reduce((sum, rule) => sum + rule.checks, 0)} resultado(s).`]), {
    tones: report.coverage.comparisons.map((comparison) => (comparison.status === 'executed' ? COLORS.ok : COLORS.muted)),
  })
  if (report.coverage.suggestions.length) {
    layout.subheading('Para ampliar el análisis')
    for (const suggestion of report.coverage.suggestions) layout.item(suggestion, { rgb: COLORS.blue })
  }

  // --- 5. Hallazgos ----------------------------------------------------------------------------
  chapter('Hallazgos')
  layout.paragraph('Cada hallazgo indica la regla aplicada, su severidad (impacto potencial) y su confianza (certeza del análisis), con la evidencia citada de cada diagrama.', { rgb: COLORS.muted, gap: 8 })
  const nonCoherent = active.filter((finding) => finding.category !== 'coherent')
  if (nonCoherent.length) {
    layout.subheading('Resumen de hallazgos')
    layout.table(['ID', 'Hallazgo', 'Categoría', 'Sev.', 'Conf.'], nonCoherent.map((finding) => [finding.id, finding.title, CATEGORY_LABELS[finding.category], SEVERITY_LABELS[finding.severity], percent(finding.confidence)]), { tones: nonCoherent.map((finding) => TONES[finding.category]) })
  }
  const detail = (finding: CoherenceFinding) => {
    layout.ensure(110)
    layout.y += 4
    const top = layout.y
    layout.paragraph(`${finding.id} · ${finding.title}`, { size: 10.5, bold: true, indent: 8, gap: 2 })
    layout.paragraph(`${CATEGORY_LABELS[finding.category]} · Severidad ${SEVERITY_LABELS[finding.severity].toLowerCase()} · Confianza ${percent(finding.confidence)} · ${VALIDATION_LABELS[finding.validation]} · Regla ${finding.ruleId}`, { size: 8, rgb: COLORS.muted, indent: 8, gap: 6 })
    // Barra de color de la categoría junto al título (en la página donde empieza).
    const color = TONES[finding.category]
    doc.setFillColor(color[0], color[1], color[2])
    doc.rect(PAGE_MARGIN, top + 2, 3, Math.max(14, Math.min(layout.y - top - 6, 40)), 'F')
    layout.paragraph(finding.description, { size: 9.5, gap: 6 })
    layout.paragraph('EVIDENCIA', { size: 7.5, bold: true, rgb: COLORS.muted, gap: 0 })
    for (const evidence of finding.evidence) layout.item(`${evidence.diagramName}: ${evidence.text}`, { rgb: COLORS.accent }, 0, 9)
    labeled('Por qué', finding.explanation)
    labeled('Impacto potencial', finding.impact)
    labeled('Recomendación', finding.recommendation)
    if (finding.exception) labeled('Excepción aceptada', `${finding.exception.justification}${finding.exception.author ? ` (${finding.exception.author})` : ''}`)
    layout.y += 6
  }
  for (const category of ['contradiction', 'possible'] as const) {
    const items = byCategory(category)
    if (!items.length) continue
    layout.heading(`${CATEGORY_LABELS[category]} (${items.length})`, 12)
    tocEntry(`${CATEGORY_LABELS[category]} (${items.length})`)
    items.forEach(detail)
  }
  for (const category of ['omission', 'unverifiable'] as const) {
    const items = byCategory(category)
    if (!items.length) continue
    layout.heading(`${CATEGORY_LABELS[category]} (${items.length})`, 12)
    tocEntry(`${CATEGORY_LABELS[category]} (${items.length})`)
    layout.table(['ID', 'Hallazgo', 'Diagramas', 'Recomendación'], items.map((finding) => [finding.id, `${finding.title}\n${finding.description}`, finding.evidence.map((evidence) => evidence.diagramName).filter((name, index, all) => all.indexOf(name) === index).join(', '), finding.recommendation]), { tones: items.map(() => TONES[category]) })
  }
  const coherent = byCategory('coherent')
  if (coherent.length) {
    layout.heading(`${CATEGORY_LABELS.coherent} (${coherent.length} reglas)`, 12)
    tocEntry(CATEGORY_LABELS.coherent)
    layout.table(['Regla', 'Lo que se comprobó'], coherent.map((finding) => [finding.ruleTitle, finding.title.replace(`${finding.ruleTitle}: `, '') + (finding.description ? `\n${finding.description.length > 420 ? `${finding.description.slice(0, 420)}…` : finding.description}` : '')]), { tones: coherent.map(() => COLORS.ok) })
  }
  const excepted = report.findings.filter((finding) => finding.exception)
  if (excepted.length) {
    layout.heading(`Excepciones justificadas (${excepted.length})`, 12)
    tocEntry('Excepciones justificadas')
    layout.table(['ID', 'Hallazgo', 'Justificación', 'Registrada por'], excepted.map((finding) => [finding.id, finding.title, finding.exception!.justification, [finding.exception!.author, finding.exception!.createdAt ? new Date(finding.exception!.createdAt).toLocaleDateString('es-CL') : ''].filter(Boolean).join(' · ') || '—']))
  }

  // --- 6. Correspondencias ---------------------------------------------------------------------
  chapter('Correspondencias entre vistas')
  layout.paragraph('Elementos que se reconocen como el mismo concepto en distintos diagramas. Son la base de las comparaciones: si una correspondencia es incorrecta, recházala en la aplicación.', { rgb: COLORS.muted, gap: 8 })
  const diagramName = (id: string) => report.model.diagrams.find((diagram) => diagram.id === id)?.name ?? id
  const shared = report.concepts.filter((concept) => concept.diagramIds.length > 1 && !concept.ambiguous).sort((a, b) => b.diagramIds.length - a.diagramIds.length || a.label.localeCompare(b.label))
  layout.subheading(`Conceptos compartidos (${shared.length})`)
  if (shared.length) layout.table(['Concepto', 'Aparece en', 'Confianza'], shared.map((concept) => [concept.label, concept.diagramIds.map(diagramName).join(', '), percent(concept.confidence)]))
  else layout.paragraph('Ningún elemento se identificó con seguridad en más de un diagrama.', { rgb: COLORS.muted })
  const pending = report.correspondences.filter((item) => item.status === 'hypothesis')
  const element = (key: string) => report.model.elements.find((item) => item.key === key)
  if (pending.length) {
    layout.subheading(`Equivalencias por validar (${pending.length})`)
    layout.table(['Elemento', 'Posible equivalente', 'Confianza', 'Evidencia'], pending.map((item) => [`${element(item.a)?.name ?? '?'}\n(${diagramName(element(item.a)?.diagramId ?? '')})`, `${element(item.b)?.name ?? '?'}\n(${diagramName(element(item.b)?.diagramId ?? '')})`, percent(item.confidence), item.evidence]))
  }

  // --- 7. Plan de acción -----------------------------------------------------------------------
  chapter('Plan de acción recomendado')
  layout.paragraph('Acciones agrupadas por tipo de hallazgo, en orden de prioridad. Resolver primero las contradicciones evita que el diseño se implemente sobre vistas incompatibles.', { rgb: COLORS.muted, gap: 8 })
  const groups = new Map<string, CoherenceFinding[]>()
  for (const finding of nonCoherent) groups.set(`${finding.ruleId}|${finding.type}`, [...(groups.get(`${finding.ruleId}|${finding.type}`) ?? []), finding])
  const rank = (finding: CoherenceFinding) => ({ contradiction: 0, possible: 1, omission: 2, unverifiable: 3, coherent: 4 })[finding.category] * 3 + ({ high: 0, medium: 1, low: 2 })[finding.severity]
  const priorityLabel = (value: number) => (value <= 1 ? 'Alta' : value <= 4 ? 'Media' : value <= 8 ? 'Baja' : 'Para ampliar')
  const actions = [...groups.values()].map((items) => ({ items, rank: Math.min(...items.map(rank)) })).sort((a, b) => a.rank - b.rank || b.items.length - a.items.length)
  if (actions.length) {
    layout.table(['Prioridad', 'Acción', 'Hallazgos'], actions.map(({ items, rank: value }) => [priorityLabel(value), `${items[0].ruleTitle}: ${items[0].recommendation}${items.length > 1 ? ` (aplica a ${items.length} casos)` : ''}`, ids(items.map((finding) => finding.id))]), { tones: actions.map(({ items }) => TONES[items[0].category]) })
  } else layout.paragraph('No hay acciones pendientes en las comparaciones ejecutadas.', { rgb: COLORS.ok, bold: true })
  if (report.coverage.suggestions.length) {
    layout.subheading('Para ampliar la documentación')
    for (const suggestion of report.coverage.suggestions.slice(0, 10)) layout.item(suggestion, { rgb: COLORS.blue })
  }

  // --- Anexo A: diagramas -----------------------------------------------------------------------
  chapter('Anexo A. Diagramas del proyecto', false)
  layout.paragraph('Cada diagrama del tablero con su imagen, su interpretación y las observaciones de su notación.', { rgb: COLORS.muted, gap: 8 })
  input.diagrams.forEach((diagram, index) => {
    if (index > 0) layout.newPage()
    tocEntry(`A.${index + 1} ${diagram.name}`)
    layout.paragraph(`A.${index + 1} ${diagram.name}`, { size: 14, bold: true, gap: 1 })
    const related = active.filter((finding) => finding.category !== 'coherent' && finding.diagrams.includes(diagram.id)).map((finding) => finding.id)
    layout.paragraph(`${diagram.typeName} · ${diagram.mode === 'visual' ? 'editor visual' : 'código PlantUML'}${related.length ? ` · hallazgos de coherencia: ${ids(related, 10)}` : ''}`, { size: 8.5, rgb: COLORS.muted, gap: 8 })
    if (diagram.image) layout.image(diagram.image, 380)
    else layout.paragraph('No se pudo incluir la imagen del diagrama.', { italic: true, rgb: COLORS.muted })
    if (diagram.interpretation) {
      layout.interpretation(diagram.interpretation)
      layout.subheading('Observaciones de la notación')
      layout.notationFindings(diagram.interpretation.findings)
    } else layout.paragraph('Este tipo de diagrama no tiene interpretación automática.', { italic: true, rgb: COLORS.muted })
  })

  // --- Anexo B: reglas ----------------------------------------------------------------------------
  chapter('Anexo B. Reglas aplicadas', false)
  layout.table(['Regla', 'Comparación', 'Estado', 'Resultados'], report.coverage.comparisons.flatMap((comparison) => comparison.rules.map((rule) => [`${rule.title}\n${rule.id}`, comparison.title, `${RULE_STATUS[rule.status]}${rule.reason ? `\n${rule.reason}` : ''}`, rule.status === 'executed' ? String(rule.checks) : '—'])))

  // --- Índice ----------------------------------------------------------------------------------------
  doc.setPage(tocPage)
  layout.y = PAGE_MARGIN
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  layout.color(COLORS.text)
  doc.text('Índice', PAGE_MARGIN, layout.y + 17)
  layout.y += 34
  const compact = toc.length > 34
  for (const entry of toc) {
    const size = entry.level === 0 ? (compact ? 9.5 : 10.5) : compact ? 8 : 9
    const indent = entry.level === 0 ? 0 : 14
    doc.setFont('helvetica', entry.level === 0 ? 'bold' : 'normal')
    doc.setFontSize(size)
    layout.color(entry.level === 0 ? COLORS.text : COLORS.muted)
    const title = (doc.splitTextToSize(pdfText(entry.title), layout.contentWidth - indent - 40) as string[])[0]
    doc.text(title, PAGE_MARGIN + indent, layout.y)
    doc.text(String(entry.page), PAGE_MARGIN + layout.contentWidth, layout.y, { align: 'right' })
    const end = PAGE_MARGIN + indent + doc.getTextWidth(title) + 4
    doc.setDrawColor(COLORS.rule[0], COLORS.rule[1], COLORS.rule[2])
    doc.setLineDashPattern([1, 2], 0)
    doc.line(end, layout.y - 2, PAGE_MARGIN + layout.contentWidth - doc.getTextWidth(String(entry.page)) - 4, layout.y - 2)
    doc.setLineDashPattern([], 0)
    layout.y += entry.level === 0 ? size * 1.9 : size * 1.6
    if (layout.y > layout.pageHeight - PAGE_MARGIN - 30) break
  }

  layout.footer(`Informe de diseño y coherencia arquitectónica · Proyecto ${project.name}`, 2)
  return doc
}

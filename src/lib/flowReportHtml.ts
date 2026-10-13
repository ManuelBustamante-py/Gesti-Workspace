import { flowLabels, THROUGHPUT_WINDOW_DAYS } from '../domain/cfd'
import { addDays, formatDateKey, isWorkingDay, todayKey, type WorkingDays } from '../domain/dates'
import { diagramFileName } from '../domain/diagramSvg'
import { formatEffort } from '../domain/effort'
import type { FlowAnalysis } from '../domain/flowAnalysis'
import type { FlowInsight, FlowInterpretation, InsightTone } from '../domain/flowInsights'
import { describeWorkingDays } from '../domain/workSchedule'
import { reportDate } from './pdfLayout'
import type { FlowReportPendingTask } from './flowReport'

/**
 * Informe interactivo: un único archivo HTML, sin dependencias externas, con
 * los gráficos dibujados en el navegador (detalle al pasar el puntero, series
 * que se ocultan con un clic), cambio entre puntos y tareas y botón para
 * imprimir o guardar como PDF. El contenido sale del mismo análisis que la
 * vista de flujo y el informe PDF.
 */

export type FlowHtmlReportInput = {
  board: { name: string; description?: string | null }
  author: string
  generatedAt: Date
  analyses: { points: FlowAnalysis | null; tasks: FlowAnalysis }
  defaultUnit: 'points' | 'tasks'
  deadlineName: string
  workingDays: WorkingDays
  effort: { estimated: number; total: number; estimatedPoints: number; fallback: number }
  pending: FlowReportPendingTask[]
  confirmedCount: number
}

const TONE_LABELS: Record<InsightTone, string> = { danger: 'Crítico', warning: 'A vigilar', good: 'Favorable', info: 'Información' }
const number = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 })
const fmt = (value: number) => number.format(Math.round(value * 10) / 10)
const longDate = (day: string) => formatDateKey(day, { day: 'numeric', month: 'long', year: 'numeric' })
const shortDate = (day: string) => formatDateKey(day, { day: '2-digit', month: '2-digit', year: 'numeric' })
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${fmt(Math.abs(value))}`

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
const h = escapeHtml

/** Datos que dibuja el script del informe, por unidad. */
function chartData(analysis: FlowAnalysis, workingDays: WorkingDays) {
  const { forecast, burndown, points } = analysis
  const ideal: Array<[string, number]> = []
  if (burndown?.deadline) {
    const last = burndown.deadline < addDays(forecast.today, 365) ? burndown.deadline : addDays(forecast.today, 365)
    for (let day = burndown.start; day <= last; day = addDays(day, 1)) ideal.push([day, burndown.idealAt(day) ?? 0])
  }
  return {
    unit: analysis.unit,
    today: forecast.today,
    deadline: forecast.deadline,
    projectedFinish: forecast.projectedFinish,
    remaining: forecast.remaining,
    flow: points.map((point) => [point.day, point.todo, point.in_progress, point.done, point.total]),
    burndown: burndown
      ? {
        start: burndown.start,
        baseline: burndown.baseline,
        real: burndown.points.map((point) => [point.day, point.remaining, point.completed, point.scopeChange]),
        ideal,
      }
      : null,
    offDays: workingDays.length < 7 && burndown
      ? (() => {
        const days: string[] = []
        const end = ideal.length ? ideal[ideal.length - 1][0] : forecast.today
        for (let day = burndown.start; day <= end; day = addDays(day, 1)) if (!isWorkingDay(day, workingDays)) days.push(day)
        return days
      })()
      : [],
  }
}

function insightsHtml(insights: FlowInsight[]) {
  return `<div class="insights">${insights.map((insight) => `
    <article class="insight tone-${insight.tone}">
      <span class="tone-tag">${TONE_LABELS[insight.tone]}</span>
      <h4>${h(insight.title)}</h4>
      <p>${h(insight.text)}</p>
    </article>`).join('')}</div>`
}

function diagnosisHtml(interpretation: FlowInterpretation, label: string) {
  return `<div class="diagnosis tone-${interpretation.tone}">
    <span class="tone-tag">${h(label)}</span>
    <h3>${h(interpretation.headline)}</h3>
    <p>${h(interpretation.summary)}</p>
  </div>`
}

function unitSection(analysis: FlowAnalysis, input: FlowHtmlReportInput, key: 'points' | 'tasks') {
  const { forecast, burndown, unit } = analysis
  const plan = analysis.interpretations.burndown
  const flow = analysis.interpretations.cfd
  const done = forecast.current.total > 0 ? Math.round((forecast.current.done / forecast.current.total) * 100) : 0
  const deviation = burndown?.deviation ?? null
  const kpis: Array<{ label: string; value: string; note: string; tone?: InsightTone }> = [
    { label: 'Avance', value: `${done} %`, note: `${fmt(forecast.current.done)} de ${fmt(forecast.current.total)} ${unit.short}`, tone: 'good' },
    { label: 'Restante', value: `${fmt(forecast.remaining)} ${unit.short}`, note: burndown?.scopeAdded ? `Alcance ${signed(burndown.scopeAdded)}` : 'Sin cambios de alcance' },
    { label: 'Vs. línea ideal', value: deviation === null ? '—' : `${signed(deviation)} ${unit.short}`, note: deviation === null ? 'Sin plazo' : deviation > 0 ? 'Atraso' : 'Adelanto', tone: deviation === null ? undefined : deviation > 0 ? 'danger' : 'good' },
    { label: 'Velocidad', value: `${fmt(forecast.throughputPerWeek)} ${unit.short}/sem`, note: `Últimos ${forecast.windowDays} días` },
    { label: 'En progreso', value: `${fmt(forecast.wipNow)} ${unit.short}`, note: `Hace 14 días: ${fmt(forecast.wipBefore)}`, tone: forecast.bottleneck ? 'danger' : undefined },
    { label: 'Tiempo de ciclo', value: forecast.cycleTimeDays !== null ? `${fmt(forecast.cycleTimeDays)} d` : '—', note: 'Ley de Little' },
    { label: 'Fin proyectado', value: forecast.projectedFinish ? shortDate(forecast.projectedFinish) : '—', note: forecast.daysLate !== null ? (forecast.daysLate > 0 ? `${forecast.daysLate} días tarde` : `${Math.abs(forecast.daysLate)} días de margen`) : '', tone: forecast.risk === 'at_risk' || forecast.risk === 'overdue' ? 'danger' : forecast.projectedFinish ? 'good' : undefined },
    { label: input.deadlineName, value: forecast.deadline ? shortDate(forecast.deadline) : '—', note: burndown?.workingDaysLeft != null ? `${burndown.workingDaysLeft} días hábiles` : '' },
  ]
  const recommendations = [
    ...plan.recommendations.map((text) => ({ text, source: 'Plan' })),
    ...flow.recommendations.filter((text) => !plan.recommendations.includes(text)).map((text) => ({ text, source: 'Flujo' })),
  ]

  return `<div class="unit-block" data-unit="${key}"${key === input.defaultUnit ? '' : ' hidden'}>
  <section class="kpis">${kpis.map((kpi) => `
    <div class="kpi${kpi.tone ? ` tone-${kpi.tone}` : ''}"><span>${h(kpi.label)}</span><strong>${h(kpi.value)}</strong><small>${h(kpi.note)}</small></div>`).join('')}
  </section>

  <section class="card" id="burndown-${key}">
    <header class="card-head">
      <div><p class="eyebrow">1 · Plan y plazo</p><h2>Burndown</h2>
      <p class="lead">Trabajo restante en ${h(unit.long)} frente a la línea ideal, que baja en días hábiles hasta ${h(input.deadlineName.toLowerCase())}. Pasa el puntero sobre el gráfico para ver cada día; haz clic en la leyenda para ocultar series.</p></div>
    </header>
    <div class="chart" data-chart="burndown" data-unit-key="${key}"></div>
    ${diagnosisHtml(plan, `Interpretación del burndown · en ${unit.long}`)}
    ${insightsHtml(plan.insights)}
    ${plan.scenarios.length ? `<h3 class="sub">Escenarios de entrega</h3>
    <div class="table-wrap"><table><thead><tr><th>Escenario</th><th class="num">${h(unit.short)}/semana</th><th>Terminaría</th><th>Plazo</th><th>Lectura</th></tr></thead><tbody>
      ${plan.scenarios.map((scenario) => `<tr><th>${h(scenario.label)}</th><td class="num">${fmt(scenario.perWeek)}</td><td>${scenario.finish ? shortDate(scenario.finish) : 'Sin avance'}</td><td>${scenario.id === 'required' ? '<span class="pill">Referencia</span>' : scenario.meetsDeadline === null ? '—' : scenario.meetsDeadline ? '<span class="pill good">Cumple</span>' : '<span class="pill danger">No cumple</span>'}</td><td class="muted">${h(scenario.note)}</td></tr>`).join('')}
    </tbody></table></div>` : ''}
  </section>

  <section class="card" id="cfd-${key}">
    <header class="card-head">
      <div><p class="eyebrow">2 · Flujo de trabajo</p><h2>Flujo acumulado (CFD)</h2>
      <p class="lead">Cada banda es el trabajo (${h(unit.long)}) en un estado cada día. Una banda «En progreso» que se ensancha indica que se empieza más de lo que se termina.</p></div>
    </header>
    <div class="chart" data-chart="cfd" data-unit-key="${key}"></div>
    ${diagnosisHtml(flow, `Interpretación del flujo · en ${unit.long}`)}
    <h3 class="sub">Indicadores del flujo</h3>
    <div class="table-wrap"><table><thead><tr><th>Indicador</th><th class="num">Valor</th><th>Lectura</th></tr></thead><tbody>
      ${flow.metrics.map((metric) => `<tr><th>${h(metric.label)}</th><td class="num${metric.tone === 'danger' || metric.tone === 'warning' ? ' bad' : ''}">${h(metric.value)}</td><td class="muted">${h(metric.note)}</td></tr>`).join('')}
    </tbody></table></div>
    ${insightsHtml(flow.insights)}
  </section>

  ${recommendations.length ? `<section class="card">
    <header class="card-head"><div><p class="eyebrow">3 · Acciones</p><h2>Recomendaciones</h2></div></header>
    <ol class="recs">${recommendations.map((entry) => `<li><span class="rec-source">${entry.source}</span>${h(entry.text)}</li>`).join('')}</ol>
  </section>` : ''}
</div>`
}

export function buildFlowReportHtml(input: FlowHtmlReportInput): string {
  const units = (['points', 'tasks'] as const).filter((key) => input.analyses[key])
  const data = Object.fromEntries(units.map((key) => [key, chartData(input.analyses[key]!, input.workingDays)]))
  const main = input.analyses[input.defaultUnit] ?? input.analyses.tasks
  const start = main.burndown?.start ?? main.points[0]?.day
  const today = main.forecast.today
  const weekAhead = addDays(today, 7)
  const sortedPending = [...input.pending].sort((left, right) => (right.effort ?? 0) - (left.effort ?? 0) || (left.number ?? 0) - (right.number ?? 0))
  // JSON dentro de <script>: se escapa «<» para que ningún texto cierre la etiqueta.
  const json = JSON.stringify({ units: data, deadlineLabel: input.deadlineName }).replace(/</g, '\\u003c')

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Informe de avance · ${h(input.board.name)}</title>
<style>${STYLES}</style>
</head>
<body>
<header class="cover">
  <div class="wrap">
    <p class="eyebrow light">Informe de avance y proyección de entrega</p>
    <h1>${h(input.board.name)}</h1>
    ${input.board.description?.trim() ? `<p class="cover-desc">${h(input.board.description.trim())}</p>` : ''}
    <p class="cover-meta">${start ? `${longDate(start)} – ${longDate(today)}` : longDate(today)} · Emitido el ${h(reportDate.format(input.generatedAt))}${input.author ? ` · ${h(input.author)}` : ''}</p>
    <div class="toolbar no-print">
      ${units.length > 1 ? `<div class="segmented" role="group" aria-label="Unidad de medida">
        ${units.map((key) => `<button type="button" data-set-unit="${key}" aria-pressed="${key === input.defaultUnit}">${key === 'points' ? 'Puntos de esfuerzo' : 'Tareas'}</button>`).join('')}
      </div>` : ''}
      <button type="button" class="print" onclick="window.print()">Imprimir o guardar como PDF</button>
    </div>
  </div>
</header>

<main class="wrap">
  <nav class="toc no-print" aria-label="Contenido">
    <a href="#resumen">Resumen</a><a href="#burndown-${input.defaultUnit}" data-section="burndown">Burndown</a><a href="#cfd-${input.defaultUnit}" data-section="cfd">Flujo acumulado</a><a href="#pendiente">Trabajo pendiente</a><a href="#metodologia">Metodología</a>
  </nav>

  <section class="card" id="resumen">
    <header class="card-head"><div><p class="eyebrow">Resumen ejecutivo</p><h2>Estado del proyecto</h2></div></header>
    ${units.map((key) => {
      const analysis = input.analyses[key]!
      return `<div class="unit-block" data-unit="${key}"${key === input.defaultUnit ? '' : ' hidden'}>
        <div class="grid-2">
          ${diagnosisHtml(analysis.interpretations.burndown, 'Diagnóstico del plan · burndown')}
          ${diagnosisHtml(analysis.interpretations.cfd, 'Diagnóstico del flujo · CFD')}
        </div>
      </div>`
    }).join('')}
  </section>

  ${units.map((key) => unitSection(input.analyses[key]!, input, key)).join('')}

  <section class="card" id="pendiente">
    <header class="card-head"><div><p class="eyebrow">Detalle</p><h2>Trabajo pendiente</h2>
    <p class="lead">${input.pending.length} tarea(s) sin completar, ordenadas por esfuerzo. Las marcadas vencen en 7 días o ya vencieron.</p></div></header>
    <div class="table-wrap"><table><thead><tr><th class="num">N°</th><th>Tarea</th><th>Columna</th><th>Estado</th><th class="num">Esfuerzo</th><th>Fin planificado</th></tr></thead><tbody>
      ${sortedPending.map((task) => {
        const overdue = task.endDate && task.endDate < today
        const soon = task.endDate && !overdue && task.endDate <= weekAhead
        return `<tr class="${overdue ? 'row-danger' : soon ? 'row-warning' : ''}"><td class="num">${task.number ?? '—'}</td><td>${h(task.title)}</td><td>${h(task.column)}</td><td>${flowLabels[task.status]}</td><td class="num">${task.effort !== null ? formatEffort(task.effort) : 'Sin estimar'}</td><td>${task.endDate ? `${shortDate(task.endDate)}${overdue ? ' <span class="pill danger">Vencida</span>' : soon ? ' <span class="pill warning">Esta semana</span>' : ''}` : '—'}</td></tr>`
      }).join('')}
    </tbody></table></div>
  </section>

  <section class="card" id="metodologia">
    <header class="card-head"><div><p class="eyebrow">Anexo</p><h2>Metodología</h2></div></header>
    <dl class="method">
      <dt>Unidad de medida</dt><dd>${input.effort.estimated > 0 ? `Puntos de esfuerzo (escala de planning poker): ${input.effort.estimated} de ${input.effort.total} tareas estimadas${input.effort.total > input.effort.estimated ? `; las demás cuentan como el promedio (${fmt(input.effort.fallback)} pts)` : ''}. También puede verse contando tareas.` : 'Cantidad de tareas: todas pesan lo mismo.'}</dd>
      <dt>Velocidad</dt><dd>Trabajo que pasó a «Listo» desde otro estado, menos lo reabierto, en los últimos ${THROUGHPUT_WINDOW_DAYS} días. Lo creado o importado ya terminado no cuenta.</dd>
      <dt>Fechas reales</dt><dd>Se usan las fechas registradas por el equipo («Completada el» y «En esta columna desde») de ${input.confirmedCount} tarea(s).</dd>
      <dt>Línea ideal</dt><dd>Baja de forma lineal hasta 0 en el plazo, solo en días hábiles (${h(describeWorkingDays([...input.workingDays]))}). No se ajusta al alcance añadido después.</dd>
      <dt>Proyección</dt><dd>Restante ÷ velocidad diaria, desde hoy. Supone que el ritmo se mantiene y que no se agrega trabajo.</dd>
      <dt>Tiempo de ciclo</dt><dd>Ley de Little: trabajo en progreso ÷ velocidad.</dd>
      <dt>Interpretación</dt><dd>Reglas explícitas sobre las cifras, separadas por vista y por unidad, sin inteligencia artificial.</dd>
    </dl>
  </section>
  <footer class="foot">Informe de avance · ${h(input.board.name)} · ${shortDate(today)}</footer>
</main>

<div class="tooltip" role="status" hidden></div>
<script id="report-data" type="application/json">${json}</script>
<script>${SCRIPT}</script>
</body>
</html>`
}

/** Genera y descarga el informe interactivo como archivo .html. */
export function downloadFlowReportHtml(input: Omit<FlowHtmlReportInput, 'generatedAt'>) {
  const html = buildFlowReportHtml({ ...input, generatedAt: new Date() })
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = diagramFileName(`informe interactivo ${input.board.name} ${todayKey()}`, 'html')
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const STYLES = `
:root{--ink:#21262b;--muted:#6b7378;--line:#e1e5e8;--soft:#f4f6f8;--bg:#eef1f4;--card:#fff;--accent:#3b6ec8;--dark:#222b31;
--good:#2e8c5a;--good-bg:#eef7f2;--warning:#b47e1e;--warning-bg:#fcf6ea;--danger:#c8465f;--danger-bg:#fcf0f3;--info:#6c757d;--info-bg:#f5f6f7;
--todo:#c4d4ee;--todo-line:#5078be;--prog:#eecd96;--prog-line:#be8228;--done:#aad8be;--done-line:#2e8c5a;--ideal:#80888c;--today:#6e961e}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
.cover{background:var(--dark);color:#fff;padding:48px 0 36px;border-bottom:4px solid var(--accent)}
.cover h1{margin:6px 0 8px;font-size:38px;line-height:1.15}
.cover-desc{margin:0 0 6px;color:#ced8da;max-width:720px}
.cover-meta{margin:0;color:#aabbbe;font-size:13px}
.eyebrow{margin:0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
.eyebrow.light{color:#96aab0}
.toolbar{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
.segmented{display:inline-flex;border:1px solid rgba(255,255,255,.25);border-radius:9px;overflow:hidden}
.segmented button,.print{font:inherit;font-size:13px;font-weight:600;border:0;padding:8px 14px;cursor:pointer;background:transparent;color:#dfe7e9}
.segmented button[aria-pressed=true]{background:#fff;color:var(--dark)}
.print{border:1px solid rgba(255,255,255,.25);border-radius:9px}
.print:hover,.segmented button:hover{background:rgba(255,255,255,.12)}
.segmented button[aria-pressed=true]:hover{background:#fff}
.toc{display:flex;flex-wrap:wrap;gap:6px;margin:18px 0}
.toc a{font-size:13px;font-weight:600;color:var(--accent);text-decoration:none;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:5px 12px}
.toc a:hover{border-color:var(--accent)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px;margin:16px 0}
.card-head h2{margin:2px 0 4px;font-size:22px}
.lead{margin:0 0 6px;color:var(--muted);font-size:14px;max-width:820px}
.sub{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:22px 0 8px}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:16px 0}
.kpi{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--line);border-radius:12px;padding:12px 14px}
.kpi span{display:block;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
.kpi strong{display:block;font-size:22px;margin-top:2px;font-variant-numeric:tabular-nums}
.kpi small{color:var(--muted);font-size:12px}
.kpi.tone-good{border-left-color:var(--good)}.kpi.tone-good strong{color:var(--good)}
.kpi.tone-danger{border-left-color:var(--danger)}.kpi.tone-danger strong{color:var(--danger)}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.diagnosis,.insight{border-radius:10px;border-left:4px solid var(--info);background:var(--info-bg);padding:12px 14px}
.diagnosis{margin:16px 0 4px}.diagnosis h3{margin:2px 0 4px;font-size:18px}.diagnosis p,.insight p{margin:0;color:#3c4246;font-size:14px}
.insights{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.insight h4{margin:2px 0 3px;font-size:15px}
.tone-tag{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--info)}
.tone-good{border-left-color:var(--good);background:var(--good-bg)}.tone-good>.tone-tag{color:var(--good)}
.tone-warning{border-left-color:var(--warning);background:var(--warning-bg)}.tone-warning>.tone-tag{color:var(--warning)}
.tone-danger{border-left-color:var(--danger);background:var(--danger-bg)}.tone-danger>.tone-tag{color:var(--danger)}
.kpi.tone-good,.kpi.tone-danger{background:var(--card)}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
thead th{font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);background:var(--soft)}
tbody th{font-weight:600}
.num{text-align:right;font-variant-numeric:tabular-nums}
.muted{color:var(--muted)}.bad{color:var(--danger);font-weight:600}
.row-danger td:first-child{box-shadow:inset 3px 0 var(--danger)}.row-warning td:first-child{box-shadow:inset 3px 0 var(--warning)}
.pill{display:inline-block;font-size:11px;font-weight:700;border-radius:999px;padding:1px 8px;background:var(--soft);color:var(--muted)}
.pill.good{background:var(--good-bg);color:var(--good)}.pill.danger{background:var(--danger-bg);color:var(--danger)}.pill.warning{background:var(--warning-bg);color:var(--warning)}
.recs{margin:6px 0 0;padding-left:22px;display:grid;gap:8px}
.recs li{padding-left:4px}.rec-source{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--accent);margin-right:8px}
.method dt{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin-top:12px}
.method dd{margin:2px 0 0}
.foot{color:var(--muted);font-size:12px;text-align:center;padding:12px 0 36px}
.chart{position:relative;margin-top:12px}
.chart svg{display:block;width:100%;height:auto;overflow:visible}
.legend{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.legend button{font:inherit;font-size:12.5px;display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--card);border-radius:999px;padding:4px 11px;cursor:pointer;color:var(--ink)}
.legend button[aria-pressed=false]{opacity:.45;text-decoration:line-through}
.legend i{display:inline-block;width:16px;height:0;border-top:2.5px solid}
.legend i.box{height:10px;width:12px;border:0;border-radius:2px}
.legend i.dash{border-top-style:dashed}
.axis text{fill:var(--muted);font-size:11px}
.grid line{stroke:#eceff1}
.tooltip{position:fixed;z-index:10;pointer-events:none;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(20,30,40,.14);padding:9px 12px;font-size:13px;min-width:180px}
.tooltip b{font-variant-numeric:tabular-nums}.tooltip .t-date{color:var(--muted);font-size:12px;margin-bottom:3px}
.tooltip .t-row{display:flex;align-items:center;gap:7px}.tooltip .t-key{width:12px;height:3px;border-radius:2px;display:inline-block}
@media (max-width:760px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.grid-2,.insights{grid-template-columns:1fr}.cover h1{font-size:30px}.card{padding:16px}}
@media print{body{background:#fff;font-size:12px}.no-print,.tooltip{display:none!important}.card{break-inside:avoid-page;border-color:#ddd;margin:10px 0}.cover{padding:24px 0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.diagnosis,.insight,.kpi,.pill,thead th{-webkit-print-color-adjust:exact;print-color-adjust:exact}.legend button[aria-pressed=false]{display:none}}
`

// Script del informe (JavaScript plano: el archivo no carga nada externo).
const SCRIPT = String.raw`
(function(){
var DATA=JSON.parse(document.getElementById('report-data').textContent);
var NS='http://www.w3.org/2000/svg';
var tip=document.querySelector('.tooltip');
var nf=new Intl.NumberFormat('es-CL',{maximumFractionDigits:1});
var hidden={};
function fmt(v){return nf.format(Math.round(v*10)/10)}
function dayMs(d){var p=d.split('-');return Date.UTC(+p[0],+p[1]-1,+p[2])}
function diff(a,b){return Math.round((dayMs(b)-dayMs(a))/864e5)}
function addD(d,n){return new Date(dayMs(d)+n*864e5).toISOString().slice(0,10)}
function label(d,o){return new Date(dayMs(d)).toLocaleDateString('es-CL',Object.assign({timeZone:'UTC'},o||{day:'numeric',month:'short'}))}
function el(tag,attrs,parent){var n=document.createElementNS(NS,tag);for(var k in attrs)n.setAttribute(k,attrs[k]);if(parent)parent.appendChild(n);return n}
function nice(max){var raw=Math.max(1,max)/5,mag=Math.pow(10,Math.floor(Math.log10(raw))),step=[1,2,5,10].map(function(f){return f*mag}).find(function(c){return c>=raw})||mag*10;step=Math.max(1,step);var top=Math.ceil(Math.max(1,max)/step)*step,t=[];for(var v=0;v<=top+step/2;v+=step)t.push(v);return{max:top,ticks:t}}
function ticksX(start,end){var total=diff(start,end),out=[];if(total>120){var d=start.slice(0,8)+'01';if(d<start)d=addMonth(d);while(d<=end){out.push(d);d=addMonth(d)}return out}var step=total<=21?2:total<=60?7:14;for(var i=0;i<=total;i+=step)out.push(addD(start,i));return out}
function addMonth(d){var p=d.split('-').map(Number);p[1]+=1;if(p[1]>12){p[1]=1;p[0]+=1}return p[0]+'-'+String(p[1]).padStart(2,'0')+'-01'}
function showTip(html,e){tip.innerHTML=html;tip.hidden=false;var w=tip.offsetWidth,x=e.clientX+16;if(x+w>window.innerWidth-8)x=e.clientX-w-16;tip.style.left=x+'px';tip.style.top=Math.max(8,e.clientY-tip.offsetHeight/2)+'px'}
function hideTip(){tip.hidden=true}
function row(color,value,text,dash){return '<div class="t-row"><span class="t-key" style="background:'+color+(dash?';opacity:.6':'')+'"></span><b>'+value+'</b> '+text+'</div>'}
function legend(container,items,key){var box=document.createElement('div');box.className='legend';items.forEach(function(it){var b=document.createElement('button');b.type='button';var id=key+':'+it.id;b.setAttribute('aria-pressed',hidden[id]?'false':'true');b.innerHTML='<i class="'+(it.kind||'')+'" style="'+(it.kind==='box'?'background:':'border-color:')+it.color+'"></i>'+it.label;b.onclick=function(){hidden[id]=!hidden[id];render()};box.appendChild(b)});container.appendChild(box)}
function frame(container,start,end,yMax,unit){var width=Math.max(320,container.clientWidth),height=width<560?260:360,pad={l:46,r:16,t:16,b:30},iw=width-pad.l-pad.r,ih=height-pad.t-pad.b,total=Math.max(1,diff(start,end)),scale=nice(yMax);
var svg=el('svg',{viewBox:'0 0 '+width+' '+height,role:'img'});container.appendChild(svg);
var x=function(d){return pad.l+diff(start,d)/total*iw},y=function(v){return pad.t+ih-v/scale.max*ih};
var g=el('g',{'class':'grid'},svg),ax=el('g',{'class':'axis'},svg);
scale.ticks.forEach(function(t){el('line',{x1:pad.l,x2:pad.l+iw,y1:y(t),y2:y(t)},g);var tx=el('text',{x:pad.l-8,y:y(t)+4,'text-anchor':'end'},ax);tx.textContent=t});
ticksX(start,end).forEach(function(d){var tx=el('text',{x:x(d),y:height-8,'text-anchor':'middle'},ax);tx.textContent=label(d)});
var yl=el('text',{x:12,y:pad.t+ih/2,'text-anchor':'middle',transform:'rotate(-90 12 '+(pad.t+ih/2)+')'},ax);yl.textContent=unit;
return{svg:svg,x:x,y:y,pad:pad,iw:iw,ih:ih,total:total,start:start,width:width,height:height}}
function vline(f,d,color,text,anchor,bottom){if(!d||d<f.start)return;var X=f.x(d);if(X>f.pad.l+f.iw+1)return;el('line',{x1:X,x2:X,y1:f.pad.t,y2:f.pad.t+f.ih,stroke:color,'stroke-width':1.5},f.svg);var t=el('text',{x:X+(anchor==='end'?-5:5),y:bottom?f.pad.t+f.ih-6:f.pad.t+12,'text-anchor':anchor||'start',fill:color,'font-size':11,'font-weight':700},f.svg);t.textContent=text}
function path(points){return points.length?'M'+points.map(function(p){return p[0].toFixed(1)+','+p[1].toFixed(1)}).join('L'):''}
function overlay(f,onMove){var r=el('rect',{x:f.pad.l,y:f.pad.t,width:f.iw,height:f.ih,fill:'transparent',style:'cursor:crosshair'},f.svg);var cross=el('line',{y1:f.pad.t,y2:f.pad.t+f.ih,stroke:'#9aa3a8','stroke-width':1,visibility:'hidden','pointer-events':'none'},f.svg);
r.addEventListener('pointermove',function(e){var b=r.getBoundingClientRect(),ratio=Math.min(1,Math.max(0,(e.clientX-b.left)/b.width)),day=addD(f.start,Math.round(ratio*f.total)),X=f.x(day);cross.setAttribute('x1',X);cross.setAttribute('x2',X);cross.setAttribute('visibility','visible');onMove(day,e)});
r.addEventListener('pointerleave',function(){cross.setAttribute('visibility','hidden');hideTip()})}
function endOf(u){var c=[addD(u.today,7)];if(u.deadline)c.push(addD(u.deadline,2));if(u.projectedFinish)c.push(addD(u.projectedFinish,2));var m=c.reduce(function(a,b){return b>a?b:a});var lim=addD(u.today,365);return m>lim?lim:m}
function projectedAt(u,d){if(!u.projectedFinish||d<u.today)return null;if(d>=u.projectedFinish)return 0;return Math.max(0,u.remaining*(1-diff(u.today,d)/Math.max(1,diff(u.today,u.projectedFinish))))}
function burndown(container,u,key){var b=u.burndown;if(!b){container.textContent='Sin historial suficiente.';return}
legend(container,[{id:'real',label:'Restante real',color:'#3b6ec8'},{id:'ideal',label:'Línea ideal',color:'#80888c',kind:'dash'},{id:'proj',label:'Proyección',color:'#3b6ec8',kind:'dash'}],key+'b');
var end=endOf(u),max=Math.max(b.baseline,Math.max.apply(null,b.real.map(function(r){return r[1]})),1),f=frame(container,b.start,end,max,'Restante ('+u.unit.short+')'),idealMap={},realMap={};
b.ideal.forEach(function(p){idealMap[p[0]]=p[1]});b.real.forEach(function(r){realMap[r[0]]=r});
var off=el('g',{},f.svg),w=f.iw/f.total;(DATA.units[key].offDays||[]).forEach(function(d){if(d<=end)el('rect',{x:f.x(d)-w/2,y:f.pad.t,width:w,height:f.ih,fill:'#f8f9fb'},off)});
el('rect',{x:f.x(u.today),y:f.pad.t,width:Math.max(0,f.x(end)-f.x(u.today)),height:f.ih,fill:'#fafbfc'},f.svg);
if(!hidden[key+'b:ideal']&&b.ideal.length)el('path',{d:path(b.ideal.filter(function(p){return p[0]<=end}).map(function(p){return[f.x(p[0]),f.y(p[1])]})),fill:'none',stroke:'#80888c','stroke-width':1.6,'stroke-dasharray':'6 5'},f.svg);
if(!hidden[key+'b:real']){el('path',{d:path(b.real.map(function(r){return[f.x(r[0]),f.y(r[1])]})),fill:'none',stroke:'#3b6ec8','stroke-width':2.4,'stroke-linejoin':'round'},f.svg);
b.real.filter(function(r){return r[3]>0}).forEach(function(r){var X=f.x(r[0]),Y=f.y(r[1])-9;el('path',{d:'M'+X+' '+(Y-6)+'l4.5 7h-9z',fill:'#c48c28'},f.svg)})}
if(!hidden[key+'b:proj']&&u.projectedFinish&&u.remaining>0){var pf=u.projectedFinish<=end?u.projectedFinish:end;el('line',{x1:f.x(u.today),y1:f.y(u.remaining),x2:f.x(pf),y2:f.y(projectedAt(u,pf)||0),stroke:'#3b6ec8','stroke-width':2,'stroke-dasharray':'4 4'},f.svg);if(u.projectedFinish<=end){el('circle',{cx:f.x(u.projectedFinish),cy:f.y(0),r:5,fill:'#fff',stroke:'#3b6ec8','stroke-width':2},f.svg);var pt=el('text',{x:f.x(u.projectedFinish)-6,y:f.y(0)-10,'text-anchor':'end',fill:'#3b6ec8','font-size':11,'font-weight':700},f.svg);pt.textContent='Proyección · '+label(u.projectedFinish)}}
vline(f,u.deadline,'#c8465f',DATA.deadlineLabel+' · '+(u.deadline?label(u.deadline):''),'end');vline(f,u.today,'#6e961e','Hoy','start',true);
overlay(f,function(day,e){var r=realMap[day],i=idealMap[day],p=day>u.today?projectedAt(u,day):null,html='<div class="t-date">'+label(day,{weekday:'short',day:'numeric',month:'short',year:'numeric'})+'</div>';
if(r){html+=row('#3b6ec8',fmt(r[1]),u.unit.short+' restantes');if(i!==undefined)html+=row('#80888c',fmt(i),'ideal ('+(r[1]-i>0?'+':'')+fmt(r[1]-i)+')');if(r[2])html+='<div class="t-row">Completado ese día: <b>'+fmt(r[2])+'</b></div>';if(r[3])html+='<div class="t-row">Alcance: <b>'+(r[3]>0?'+':'')+fmt(r[3])+'</b></div>';if(b.baseline>0)html+='<div class="t-row">'+Math.max(0,Math.round((1-r[1]/b.baseline)*100))+' % quemado</div>'}
else{if(p!==null)html+=row('#3b6ec8','≈ '+fmt(p),u.unit.short+' (proyección)',true);if(i!==undefined)html+=row('#80888c',fmt(i),'ideal');if(p===null&&i===undefined)html+='<div class="t-row">Sin datos</div>'}
showTip(html,e)})}
function cfd(container,u,key){var rows=u.flow;if(!rows.length){container.textContent='Sin historial suficiente.';return}
var bands=[{id:'done',label:'Listo',fill:'#aad8be',line:'#2e8c5a',idx:3},{id:'prog',label:'En progreso',fill:'#eecd96',line:'#be8228',idx:2},{id:'todo',label:'Por hacer',fill:'#c4d4ee',line:'#5078be',idx:1}];
legend(container,bands.slice().reverse().map(function(bd){return{id:bd.id,label:bd.label,color:bd.fill,kind:'box'}}).concat([{id:'proj',label:'Proyección de lo completado',color:'#3c4246',kind:'dash'}]),key+'c');
var visible=bands.filter(function(bd){return!hidden[key+'c:'+bd.id]}),end=endOf(u),max=Math.max.apply(null,rows.map(function(r){return visible.reduce(function(s,bd){return s+r[bd.idx]},0)}).concat([1])),f=frame(container,rows[0][0],end,max,'Trabajo ('+u.unit.short+')'),byDay={};
rows.forEach(function(r){byDay[r[0]]=r});el('rect',{x:f.x(u.today),y:f.pad.t,width:Math.max(0,f.x(end)-f.x(u.today)),height:f.ih,fill:'#fafbfc'},f.svg);
var base=rows.map(function(){return 0});visible.forEach(function(bd){var top=rows.map(function(r,i){return base[i]+r[bd.idx]}),upper=rows.map(function(r,i){return[f.x(r[0]),f.y(top[i])]}),lower=rows.map(function(r,i){return[f.x(r[0]),f.y(base[i])]}).reverse();el('path',{d:path(upper.concat(lower))+'Z',fill:bd.fill,stroke:'none'},f.svg);el('path',{d:path(upper),fill:'none',stroke:bd.line,'stroke-width':1.2},f.svg);base=top});
var last=rows[rows.length-1];if(!hidden[key+'c:proj']&&u.projectedFinish&&last[3]<last[4]&&visible.length===3){var pf=u.projectedFinish<=end?u.projectedFinish:end,span=Math.max(1,diff(u.today,u.projectedFinish)),v=last[3]+(last[4]-last[3])*Math.min(1,diff(u.today,pf)/span);el('line',{x1:f.x(u.today),y1:f.y(last[3]),x2:f.x(pf),y2:f.y(v),stroke:'#3c4246','stroke-width':2,'stroke-dasharray':'6 5'},f.svg)}
vline(f,u.deadline,'#c8465f',DATA.deadlineLabel+' · '+(u.deadline?label(u.deadline):''),'end');vline(f,u.today,'#6e961e','Hoy','start',true);
overlay(f,function(day,e){var r=byDay[day],html='<div class="t-date">'+label(day,{weekday:'short',day:'numeric',month:'short',year:'numeric'})+'</div>';if(r){html+=row('#5078be',fmt(r[1]),'por hacer')+row('#be8228',fmt(r[2]),'en progreso')+row('#2e8c5a',fmt(r[3]),'listo')+'<div class="t-row">Total: <b>'+fmt(r[4])+'</b> '+u.unit.short+'</div>'}else{html+='<div class="t-row">Futuro: ver proyección</div>'}showTip(html,e)})}
var current=document.querySelector('[data-set-unit][aria-pressed=true]');current=current?current.getAttribute('data-set-unit'):Object.keys(DATA.units)[0];
function render(){document.querySelectorAll('[data-section]').forEach(function(a){a.setAttribute('href','#'+a.getAttribute('data-section')+'-'+current)});document.querySelectorAll('.unit-block').forEach(function(b){b.hidden=b.getAttribute('data-unit')!==current});
document.querySelectorAll('.chart').forEach(function(c){var key=c.getAttribute('data-unit-key');c.innerHTML='';if(key!==current)return;var u=DATA.units[key];if(c.getAttribute('data-chart')==='burndown')burndown(c,u,key);else cfd(c,u,key)})}
document.querySelectorAll('[data-set-unit]').forEach(function(b){b.addEventListener('click',function(){current=b.getAttribute('data-set-unit');document.querySelectorAll('[data-set-unit]').forEach(function(o){o.setAttribute('aria-pressed',String(o===b))});render()})});
var timer;window.addEventListener('resize',function(){clearTimeout(timer);timer=setTimeout(render,150)});
window.addEventListener('beforeprint',render);
render();
})();
`

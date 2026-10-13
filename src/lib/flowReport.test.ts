import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'

import type { FlowPoint } from '../domain/cfd'
import { addDays } from '../domain/dates'
import { analyzeFlow, type FlowAnalysis, type PendingTaskBase } from '../domain/flowAnalysis'
import { buildFlowReport } from './flowReport'
import { buildFlowReportHtml } from './flowReportHtml'

function sampleAnalysis(unit: 'points' | 'tasks'): FlowAnalysis {
  const completions: Record<string, number> = { '2026-07-22': 5, '2026-08-19': 58, '2026-09-21': 13, '2026-10-01': 3, '2026-10-08': 52 }
  const scale = unit === 'points' ? 1 : 0.25
  const allPoints: FlowPoint[] = []
  let done = 0
  for (let day = '2026-07-01'; day <= '2026-10-13'; day = addDays(day, 1)) {
    const completed = (completions[day] ?? 0) * scale
    done += completed
    const wip = day >= '2026-10-08' ? 27 * scale : 0
    allPoints.push({ day, done, in_progress: wip, todo: 224 * scale - done - wip, total: 224 * scale, completed })
  }
  const pending: PendingTaskBase[] = [
    { id: 'a', number: 12, title: 'Gestión de videos de las lecciones', status: 'in_progress', endDate: '2026-11-06' },
    { id: 'b', number: 37, title: 'Definir hosting y publicar la plataforma', status: 'in_progress', endDate: '2026-10-16' },
    { id: 'c', number: 41, title: 'Proveedor de correo (SMTP)', status: 'todo', endDate: '2026-10-17' },
  ]
  const weights: Record<string, number> = { a: 13, b: 8, c: 3 }
  return analyzeFlow({
    unit: unit === 'points' ? { short: 'pts', long: 'puntos' } : { short: 'tareas', long: 'tareas' },
    allPoints,
    deadline: '2026-12-06',
    projectStart: '2026-07-01',
    workingDays: [2, 3, 4, 5, 6],
    committed: true,
    pending,
    weightOf: (id) => (unit === 'points' ? weights[id] : 1),
    effort: unit === 'points' ? { estimated: 50, total: 50, fallback: 4.5 } : undefined,
  })!
}

const common = {
  board: { name: 'Sto-Institute', description: 'Tablero importado desde una plantilla XLSX.' },
  author: 'Equipo',
  deadlineName: 'Fin comprometido',
  workingDays: [2, 3, 4, 5, 6],
  effort: { estimated: 50, total: 50, estimatedPoints: 224, fallback: 4.5 },
  pending: [{ number: 12, title: 'Gestión de videos <b>', column: 'En progreso', status: 'in_progress' as const, effort: 13, endDate: '2026-11-06' }],
  confirmedCount: 46,
}

describe('buildFlowReport', () => {
  it('arma portada, índice, capítulos y anexos con las cifras del tablero', () => {
    const doc = buildFlowReport(jsPDF, { ...common, analysis: sampleAnalysis('points'), measuredInPoints: true, generatedAt: new Date(2026, 9, 13, 10) })
    const text = doc.output()

    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(9)
    for (const title of ['INFORME DE AVANCE', 'Contenido', 'Resumen ejecutivo', 'Burndown', 'Escenarios de entrega', 'Flujo acumulado', 'Recomendaciones', 'Trabajo pendiente', 'Anexo A', 'Anexo B', 'INTERPRETACI']) {
      expect(text).toContain(title)
    }
    expect(text).not.toContain('NaN')
  })
})

describe('buildFlowReportHtml', () => {
  it('genera un HTML autocontenido con ambas unidades, gráficos y texto escapado', () => {
    const html = buildFlowReportHtml({
      ...common,
      analyses: { points: sampleAnalysis('points'), tasks: sampleAnalysis('tasks') },
      defaultUnit: 'points',
      generatedAt: new Date(2026, 9, 13, 10),
    })

    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('data-set-unit="points"')
    expect(html).toContain('data-set-unit="tasks"')
    expect(html.match(/data-chart="burndown"/g)).toHaveLength(2)
    expect(html.match(/data-chart="cfd"/g)).toHaveLength(2)
    expect(html).toContain('Gestión de videos &lt;b&gt;')
    expect(html).not.toMatch(/<script[^>]+src=/)
    expect(html).not.toContain('NaN')
    const json = /<script id="report-data" type="application\/json">(.*?)<\/script>/s.exec(html)![1]
    expect(Object.keys(JSON.parse(json).units)).toEqual(['points', 'tasks'])
  })
})

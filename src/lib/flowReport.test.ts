import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'

import { buildBurndown } from '../domain/burndown'
import { computeForecast, type FlowPoint } from '../domain/cfd'
import { addDays } from '../domain/dates'
import { interpretFlow, type PendingTask } from '../domain/flowInsights'
import { buildFlowReport, type FlowReportInput } from './flowReport'

const UNIT = { short: 'pts', long: 'puntos' }

function sampleReportInput(): Omit<FlowReportInput, 'generatedAt'> {
  const completions: Record<string, number> = { '2026-07-22': 5, '2026-08-19': 58, '2026-09-21': 13, '2026-10-01': 3, '2026-10-08': 52 }
  const points: FlowPoint[] = []
  let done = 0
  for (let day = '2026-07-01'; day <= '2026-10-13'; day = addDays(day, 1)) {
    const completed = completions[day] ?? 0
    done += completed
    const wip = day >= '2026-10-08' ? 27 : 0
    points.push({ day, done, in_progress: wip, todo: 224 - done - wip, total: 224, completed })
  }
  const forecast = computeForecast(points, '2026-12-06')!
  const burndown = buildBurndown(points, { start: '2026-07-01', deadline: '2026-12-06' })
  const pending: PendingTask[] = [
    { number: 12, title: 'Gestión de videos de las lecciones', weight: 13, status: 'in_progress', endDate: '2026-11-06' },
    { number: 37, title: 'Definir hosting y publicar la plataforma', weight: 8, status: 'in_progress', endDate: '2026-10-16' },
    { number: 41, title: 'Proveedor de correo (SMTP)', weight: 3, status: 'todo', endDate: '2026-10-17' },
    { number: 40, title: 'Configurar TRUST_PROXY', weight: 1, status: 'todo', endDate: '2026-10-17' },
  ]
  const effort = { estimated: 50, total: 50, estimatedPoints: 224, fallback: 4.5 }
  return {
    board: { name: 'Sto-Institute', description: 'Tablero importado desde una plantilla XLSX.' },
    author: 'Equipo',
    unit: UNIT,
    measuredInPoints: true,
    points,
    forecast,
    burndown,
    interpretation: interpretFlow({ unit: UNIT, points, forecast, burndown, committed: true, pending, effort }),
    deadlineName: 'Fin comprometido',
    workingDays: [2, 3, 4, 5, 6],
    effort,
    pending: pending.map((task) => ({ ...task, column: 'En progreso', effort: task.weight })),
    confirmedCount: 46,
  }
}

describe('buildFlowReport', () => {
  it('arma portada, capítulos y anexos con las cifras del tablero', () => {
    const doc = buildFlowReport(jsPDF, { ...sampleReportInput(), generatedAt: new Date(2026, 9, 13, 10) })
    const text = doc.output()

    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(8)
    for (const title of ['INFORME DE AVANCE', '1. Resumen ejecutivo', '2. Burndown', '3. Flujo acumulado', '4. Proyecci', '5. Interpretaci', '6. Trabajo pendiente', 'Anexo A', 'Anexo B']) {
      expect(text).toContain(title)
    }
    expect(text).not.toContain('NaN')
  })
})

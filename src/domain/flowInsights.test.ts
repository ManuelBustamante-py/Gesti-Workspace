import { describe, expect, it } from 'vitest'

import { buildBurndown } from './burndown'
import { computeForecast, type FlowPoint } from './cfd'
import { addDays } from './dates'
import { deliveryScenarios, interpretFlow, type PendingTask } from './flowInsights'

const UNIT = { short: 'pts', long: 'puntos' }

/** 40 días desde el 1-sep con 100 pts; `completions` = día (índice) → puntos completados. */
function series(completions: Record<number, number>, days = 40, total = 100): FlowPoint[] {
  let done = 0
  return Array.from({ length: days }, (_, index) => {
    const completed = completions[index] ?? 0
    done += completed
    return { day: addDays('2026-09-01', index), todo: total - done, in_progress: 0, done, total, completed }
  })
}

const pending = (overrides: Partial<PendingTask>[]): PendingTask[] =>
  overrides.map((task, index) => ({ number: index + 1, title: `Tarea ${index + 1}`, weight: 1, status: 'todo', endDate: null, ...task }))

function interpret(points: FlowPoint[], deadline: string | null, tasks: PendingTask[]) {
  const forecast = computeForecast(points, deadline)!
  const burndown = buildBurndown(points, { start: points[0].day, deadline })
  return interpretFlow({ unit: UNIT, points, forecast, burndown, committed: true, pending: tasks })
}

describe('interpretFlow', () => {
  it('detecta el ritmo concentrado en un día, las tareas grandes y lo que vence pronto', () => {
    const points = series({ 5: 4, 20: 6, 37: 50 })
    const today = points.at(-1)!.day
    const result = interpret(points, '2026-12-06', pending([
      { weight: 13 },
      { weight: 8, endDate: addDays(today, 3), status: 'in_progress' },
      { weight: 5 },
      { weight: 3 },
    ]))
    const ids = result.insights.map((insight) => insight.id)

    expect(ids).toContain('regularity')
    expect(result.insights.find((insight) => insight.id === 'regularity')?.tone).toBe('warning')
    expect(ids).toContain('concentration')
    expect(ids).toContain('due')
    expect(result.recommendations.some((text) => text.startsWith('Dividir #1'))).toBe(true)
    expect(result.recommendations.some((text) => text.includes('sesiones regulares'))).toBe(true)
    expect(result.summary).toContain('Ojo: el ritmo depende de un día puntual.')
  })

  it('marca peligro cuando el ritmo actual no alcanza para el plazo', () => {
    const points = series({ 10: 2, 25: 2, 35: 2 })
    const result = interpret(points, addDays(points.at(-1)!.day, 14), pending([{ weight: 50 }, { weight: 44 }]))

    expect(result.tone).toBe('danger')
    expect(result.insights[0].tone).toBe('danger')
    expect(result.insights.find((insight) => insight.id === 'required')?.title).toBe('El ritmo actual no alcanza')
  })

  it('un avance repartido y adelantado da un diagnóstico favorable', () => {
    const completions = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [index, index % 2 === 0 ? 2 : 0]))
    const points = series(completions)
    const result = interpret(points, '2027-03-31', pending([{ weight: 20 }, { weight: 20 }, { weight: 20 }]))

    expect(result.tone).toBe('good')
    expect(result.headline).toBe('El proyecto avanza en buen estado')
    expect(result.insights.find((insight) => insight.id === 'regularity')?.tone).toBe('good')
  })

  it('con poco margen de ritmo el titular lo dice', () => {
    const completions = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [index, index % 2 === 0 ? 2 : 0]))
    const result = interpret(series(completions), '2026-12-31', pending([{ weight: 20 }, { weight: 20 }, { weight: 20 }]))

    expect(result.tone).toBe('info')
    expect(result.headline).toBe('En plazo, con margen ajustado')
  })
})

describe('deliveryScenarios', () => {
  it('incluye ritmo actual, reciente, histórico y el necesario', () => {
    const points = series({ 5: 10, 20: 10, 35: 10 })
    const forecast = computeForecast(points, '2026-12-31')!
    const burndown = buildBurndown(points, { start: points[0].day, deadline: '2026-12-31' })
    const scenarios = deliveryScenarios({ points, forecast, burndown, unit: UNIT })

    expect(scenarios.map((scenario) => scenario.id)).toEqual(['current', 'recent', 'historical', 'required'])
    expect(scenarios[0].perWeek).toBeCloseTo(forecast.throughputPerWeek)
    expect(scenarios.at(-1)?.finish).toBe('2026-12-31')
  })
})

import { describe, expect, it } from 'vitest'

import { buildBurndown } from './burndown'
import { computeForecast, type FlowPoint } from './cfd'
import { addDays } from './dates'
import { deliveryScenarios, interpretFlow, type FlowInterpretationInput, type PendingTask } from './flowInsights'

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
    expect(result.headline).toBe('El burndown avanza en buen estado')
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

describe('interpretFlow · flujo acumulado', () => {
  /** 30 días; desde el día 16 se empiezan 3 pts diarios y solo se terminan 1 cada 2 días. */
  function crowdedFlow(): FlowPoint[] {
    let done = 0
    let wip = 0
    return Array.from({ length: 30 }, (_, index) => {
      let completed = 0
      if (index >= 16) {
        wip += 3
        if (index % 2 === 0) { wip -= 1; done += 1; completed = 1 }
      }
      return { day: addDays('2026-09-01', index), todo: 100 - done - wip, in_progress: wip, done, total: 100, completed }
    })
  }

  function input(points: FlowPoint[], tasks: PendingTask[], alternate?: FlowInterpretationInput['alternate']): FlowInterpretationInput {
    const forecast = computeForecast(points, '2026-12-31')!
    return { unit: UNIT, points, forecast, burndown: null, committed: true, pending: tasks, alternate }
  }

  it('detecta que se empieza más de lo que se termina y lo recomienda', () => {
    const points = crowdedFlow()
    const result = interpretFlow(input(points, pending([{ status: 'in_progress' }])), 'cfd')

    expect(result.view).toBe('cfd')
    expect(result.scenarios).toEqual([])
    const balance = result.insights.find((insight) => insight.id === 'balance')
    expect(balance?.title).toBe('Se empieza más de lo que se termina')
    expect(result.recommendations.some((text) => text.startsWith('Dejar de empezar'))).toBe(true)
    expect(result.metrics.map((metric) => metric.label)).toContain('En progreso hoy')
    expect(result.insights.some((insight) => insight.id === 'plan')).toBe(false)
  })

  it('en puntos compara el tamaño de lo que está en curso con lo terminado', () => {
    const points = crowdedFlow()
    // Misma serie contada en tareas: lo que está en curso son pocas tareas grandes.
    const tasks = points.map((point) => ({ ...point, in_progress: Math.ceil(point.in_progress / 10), done: point.done, total: point.total }))
    const result = interpretFlow(input(points, [], { label: 'tareas', points: tasks, forecast: null }), 'cfd')

    expect(result.insights.find((insight) => insight.id === 'size')?.title).toBe('Lo que está en curso es más grande que lo terminado')
  })

  it('el burndown no incluye hallazgos propios del flujo', () => {
    const points = crowdedFlow()
    const result = interpretFlow(input(points, []), 'burndown')
    expect(result.insights.some((insight) => insight.id === 'balance' || insight.id === 'cycle')).toBe(false)
    expect(result.metrics).toEqual([])
  })
})

import { beforeAll, describe, expect, it } from 'vitest'

import { buildDailyFlow, computeForecast, ganttDeadline, type FlowPoint, type StatusEvent } from './cfd'
import { addDays } from './dates'

// Eventos a mediodía UTC: caen el mismo día en cualquier zona entre UTC-11 y UTC+11.
const at = (day: string) => `${day}T12:00:00Z`
const event = (task_id: string, status: StatusEvent['status'], day: string): StatusEvent => ({ task_id, status, occurred_at: at(day) })

describe('buildDailyFlow', () => {
  it('acumula por día y aplica movimientos y bajas', () => {
    const points = buildDailyFlow(
      [
        event('a', 'todo', '2026-10-01'),
        event('b', 'todo', '2026-10-01'),
        event('a', 'in_progress', '2026-10-02'),
        event('a', 'done', '2026-10-03'),
        event('b', 'removed', '2026-10-03'),
      ],
      '2026-10-04',
    )
    expect(points.map((point) => [point.day, point.todo, point.in_progress, point.done, point.total])).toEqual([
      ['2026-10-01', 2, 0, 0, 2],
      ['2026-10-02', 1, 1, 0, 2],
      ['2026-10-03', 0, 0, 1, 1],
      ['2026-10-04', 0, 0, 1, 1],
    ])
  })

  it('sin eventos no hay serie', () => {
    expect(buildDailyFlow([], '2026-10-04')).toEqual([])
  })
})

describe('computeForecast', () => {
  // 20 tareas; se completa 1 cada 2 días durante 28 días → 14 hechas, 3,5 por semana.
  let points: FlowPoint[]
  beforeAll(() => {
    points = Array.from({ length: 29 }, (_, index) => {
      const done = Math.floor(index / 2)
      return { day: addDays('2026-09-08', index), todo: 20 - done - 2, in_progress: 2, done, total: 20 }
    })
  })

  it('proyecta con el throughput real y detecta el retraso frente al Gantt', () => {
    const forecast = computeForecast(points, '2026-10-10')!
    expect(forecast.today).toBe('2026-10-06')
    expect(forecast.remaining).toBe(6)
    expect(forecast.throughputPerWeek).toBeCloseTo(3.5)
    expect(forecast.projectedFinish).toBe('2026-10-18') // 6 tareas a 0,5/día = 12 días
    expect(forecast.daysLate).toBe(8)
    expect(forecast.risk).toBe('at_risk')
    expect(forecast.requiredPerWeek).toBeCloseTo(10.5) // 6 tareas en 4 días
  })

  it('va en plazo si la proyección cae antes de la fecha límite', () => {
    const forecast = computeForecast(points, '2026-10-31')!
    expect(forecast.risk).toBe('on_track')
    expect(forecast.daysLate).toBe(-13)
  })

  it('distingue sin velocidad, vencido y completo', () => {
    const flat = points.map((point) => ({ ...point, done: 0, todo: 18 }))
    expect(computeForecast(flat, '2026-10-31')!.risk).toBe('no_velocity')
    expect(computeForecast(points, '2026-10-01')!.risk).toBe('overdue')
    const finished = points.map((point) => ({ ...point, todo: 0, in_progress: 0, done: 20 }))
    expect(computeForecast(finished, '2026-10-31')!.risk).toBe('complete')
  })

  it('detecta un cuello de botella cuando el trabajo en curso se acumula', () => {
    const growing = points.map((point, index) => ({ ...point, in_progress: index < 14 ? 2 : 2 + (index - 14), done: 1 }))
    const forecast = computeForecast(growing, '2026-10-31')!
    expect(forecast.wipNow).toBeGreaterThan(forecast.wipBefore)
    expect(forecast.bottleneck).toBe(true)
  })
})

describe('ganttDeadline', () => {
  it('toma el fin planificado más tardío', () => {
    expect(ganttDeadline([{ end_date: '2026-11-13' }, { end_date: null }, { end_date: '2026-12-11' }])).toBe('2026-12-11')
    expect(ganttDeadline([{ end_date: null }])).toBeNull()
  })
})

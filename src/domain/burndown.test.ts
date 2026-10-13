import { describe, expect, it } from 'vitest'

import { buildBurndown, burndownStart, projectedRemainingAt } from './burndown'
import type { FlowPoint } from './cfd'

const point = (day: string, done: number, total: number, completed = 0): FlowPoint => ({
  day,
  todo: total - done,
  in_progress: 0,
  done,
  total,
  completed,
})

// 2026-10-05 es lunes.
const MON_FRI = [2, 3, 4, 5, 6]

describe('buildBurndown', () => {
  it('baja la línea ideal hasta 0 en el plazo', () => {
    const points = [point('2026-10-01', 0, 10), point('2026-10-02', 2, 10, 2), point('2026-10-03', 3, 10, 1)]
    const burndown = buildBurndown(points, { start: '2026-10-01', deadline: '2026-10-06' })
    expect(burndown.baseline).toBe(10)
    expect(burndown.points.map((item) => item.ideal)).toEqual([10, 8, 6])
    expect(burndown.idealAt('2026-10-06')).toBe(0)
    expect(burndown.points.map((item) => item.remaining)).toEqual([10, 8, 7])
    // Hoy (día 3): restan 7 y lo ideal era 6.
    expect(burndown.deviation).toBe(1)
    expect(burndown.completedSinceStart).toBe(3)
  })

  it('no baja la línea ideal en días no hábiles', () => {
    const points = [point('2026-10-02', 0, 10)] // viernes
    const burndown = buildBurndown(points, { start: '2026-10-02', deadline: '2026-10-09', workingDays: MON_FRI })
    // Días hábiles tras el inicio hasta el plazo: lun 5 … vie 9 = 5.
    expect(burndown.idealAt('2026-10-03')).toBe(10)
    expect(burndown.idealAt('2026-10-04')).toBe(10)
    expect(burndown.idealAt('2026-10-05')).toBe(8)
    expect(burndown.idealAt('2026-10-08')).toBe(2)
  })

  it('registra el alcance añadido sin mover la línea ideal', () => {
    const points = [point('2026-10-01', 0, 10), point('2026-10-02', 0, 15)]
    const burndown = buildBurndown(points, { start: '2026-10-01', deadline: '2026-10-11' })
    expect(burndown.points[1].scopeChange).toBe(5)
    expect(burndown.points[1].remaining).toBe(15)
    expect(burndown.points[1].ideal).toBe(9)
    expect(burndown.scopeAdded).toBe(5)
  })

  it('sin plazo no hay línea ideal ni desviación', () => {
    const burndown = buildBurndown([point('2026-10-01', 0, 4)], { start: '2026-10-01', deadline: null })
    expect(burndown.points[0].ideal).toBeNull()
    expect(burndown.deviation).toBeNull()
    expect(burndown.workingDaysLeft).toBeNull()
  })

  it('al empezar después del historial, el primer día compara con el anterior', () => {
    const points = [point('2026-10-01', 0, 10), point('2026-10-02', 1, 12, 1)]
    const burndown = buildBurndown(points, { start: '2026-10-02', deadline: '2026-10-04' })
    expect(burndown.baseline).toBe(11)
    expect(burndown.points[0]).toMatchObject({ scopeChange: 2, completed: 1 })
  })
})

describe('burndownStart', () => {
  const points = [point('2026-10-01', 0, 1), point('2026-10-05', 0, 1)]

  it('usa el inicio del proyecto si cae dentro del historial', () => {
    expect(burndownStart(points, '2026-10-03')).toBe('2026-10-03')
  })

  it('usa el primer día con historial si el inicio es anterior o futuro', () => {
    expect(burndownStart(points, '2026-09-01')).toBe('2026-10-01')
    expect(burndownStart(points, '2026-12-01')).toBe('2026-10-01')
    expect(burndownStart(points, null)).toBe('2026-10-01')
    expect(burndownStart([], null)).toBeNull()
  })
})

describe('projectedRemainingAt', () => {
  it('baja en línea recta hasta el fin proyectado', () => {
    expect(projectedRemainingAt('2026-10-03', '2026-10-01', 10, '2026-10-05')).toBe(5)
    expect(projectedRemainingAt('2026-10-09', '2026-10-01', 10, '2026-10-05')).toBe(0)
    expect(projectedRemainingAt('2026-09-30', '2026-10-01', 10, '2026-10-05')).toBeNull()
    expect(projectedRemainingAt('2026-10-03', '2026-10-01', 10, null)).toBeNull()
  })
})

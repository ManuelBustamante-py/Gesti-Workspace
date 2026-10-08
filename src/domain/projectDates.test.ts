import { describe, expect, it } from 'vitest'

import { planProjectDates, shiftWorkingDays, tasksDateRange, workingDaysBetween } from './projectDates'

// Lunes a viernes (1 = domingo … 7 = sábado). 2026-09-01 es martes.
const weekdays = [2, 3, 4, 5, 6]
const allDays = [1, 2, 3, 4, 5, 6, 7]

describe('shiftWorkingDays', () => {
  it('mueve días hábiles saltando fines de semana', () => {
    expect(shiftWorkingDays('2026-09-01', 5, weekdays, 'start')).toBe('2026-09-08')
    expect(shiftWorkingDays('2026-09-04', 1, weekdays, 'start')).toBe('2026-09-07')
    expect(shiftWorkingDays('2026-09-07', -1, weekdays, 'end')).toBe('2026-09-04')
  })

  it('cuenta un inicio no laborable desde el siguiente hábil y un fin desde el anterior', () => {
    expect(shiftWorkingDays('2026-09-05', 1, weekdays, 'start')).toBe('2026-09-08')
    expect(shiftWorkingDays('2026-09-05', 1, weekdays, 'end')).toBe('2026-09-07')
  })

  it('no cambia la fecha si no hay desplazamiento y usa días corridos con jornada completa', () => {
    expect(shiftWorkingDays('2026-09-05', 0, weekdays, 'start')).toBe('2026-09-05')
    expect(shiftWorkingDays('2026-09-05', 3, allDays, 'start')).toBe('2026-09-08')
  })
})

describe('workingDaysBetween', () => {
  it('mide el cambio de inicio en días hábiles', () => {
    expect(workingDaysBetween('2026-09-01', '2026-09-08', weekdays)).toBe(5)
    expect(workingDaysBetween('2026-09-08', '2026-09-01', weekdays)).toBe(-5)
    expect(workingDaysBetween('2026-09-05', '2026-09-07', weekdays)).toBe(0)
  })
})

describe('tasksDateRange', () => {
  it('toma el inicio más temprano y el fin más tardío', () => {
    expect(tasksDateRange([
      { id: 'a', start_date: '2026-09-07', end_date: '2026-09-11' },
      { id: 'b', start_date: '2026-09-01', end_date: null },
      { id: 'c', start_date: null, end_date: '2026-10-02' },
    ])).toEqual({ start: '2026-09-01', end: '2026-10-02' })
    expect(tasksDateRange([])).toEqual({ start: null, end: null })
  })
})

describe('planProjectDates', () => {
  const pendingTasks = [
    { id: 'a', start_date: '2026-09-01', end_date: '2026-09-04' },
    { id: 'b', start_date: '2026-09-07', end_date: '2026-09-11' },
    { id: 'c', start_date: null, end_date: null },
    { id: 'd', start_date: null, end_date: '2026-09-11' },
  ]

  it('desplaza las tareas pendientes conservando su duración e informa las que pasan del fin', () => {
    const plan = planProjectDates({
      pendingTasks, previousStart: '2026-09-01', start: '2026-09-08', end: '2026-09-14', shiftTasks: true, workingDays: weekdays,
    })
    expect(plan.shiftDays).toBe(5)
    expect(plan.moved.map(({ after }) => after)).toEqual([
      { id: 'a', start_date: '2026-09-08', end_date: '2026-09-11' },
      { id: 'b', start_date: '2026-09-14', end_date: '2026-09-18' },
      { id: 'd', start_date: null, end_date: '2026-09-18' },
    ])
    expect(plan.endAfterProject).toEqual(['b', 'd'])
    expect(plan.startBeforeProject).toEqual([])
  })

  it('sin mover tareas, solo informa las que quedan fuera del rango', () => {
    const plan = planProjectDates({
      pendingTasks, previousStart: '2026-09-01', start: '2026-09-08', end: '2026-09-14', shiftTasks: false, workingDays: weekdays,
    })
    expect(plan.shiftDays).toBe(0)
    expect(plan.moved).toEqual([])
    expect(plan.startBeforeProject).toEqual(['a', 'b'])
  })

  it('no mueve nada si no había un inicio previo o se quita el inicio', () => {
    expect(planProjectDates({ pendingTasks, previousStart: null, start: '2026-09-08', end: null, shiftTasks: true, workingDays: weekdays }).moved).toEqual([])
    expect(planProjectDates({ pendingTasks, previousStart: '2026-09-01', start: null, end: null, shiftTasks: true, workingDays: weekdays }).moved).toEqual([])
  })
})

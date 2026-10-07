import { describe, expect, it } from 'vitest'

import { deadlineStatus } from './deadlines'

describe('deadlineStatus', () => {
  const today = '2026-10-07'

  it('marca atrasadas y por vencer en los próximos 7 días', () => {
    expect(deadlineStatus({ end_date: '2026-10-04' }, 'in_progress', today)).toEqual({ overdueDays: 3, dueInDays: null })
    expect(deadlineStatus({ end_date: '2026-10-07' }, 'todo', today)).toEqual({ overdueDays: null, dueInDays: 0 })
    expect(deadlineStatus({ end_date: '2026-10-14' }, 'todo', today)).toEqual({ overdueDays: null, dueInDays: 7 })
    expect(deadlineStatus({ end_date: '2026-10-15' }, 'todo', today)).toEqual({ overdueDays: null, dueInDays: null })
  })

  it('las completadas y las que no tienen fecha de fin no cuentan', () => {
    expect(deadlineStatus({ end_date: '2026-10-01' }, 'done', today)).toEqual({ overdueDays: null, dueInDays: null })
    expect(deadlineStatus({ end_date: null }, 'todo', today)).toEqual({ overdueDays: null, dueInDays: null })
  })
})

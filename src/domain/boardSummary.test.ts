import { describe, expect, it } from 'vitest'

import { summarizeBoards } from './boardSummary'

describe('summarizeBoards', () => {
  it('reproduce el resumen del tablero NexuStock (44 %, 1 atrasada, 1 vence pronto)', () => {
    const summaries = summarizeBoards(
      [
        { board_id: 'nexu', status: 'done', end_date: '2026-09-11', task_count: 3 },
        { board_id: 'nexu', status: 'in_progress', end_date: '2026-10-05', task_count: 1 },
        { board_id: 'nexu', status: 'in_progress', end_date: '2026-10-20', task_count: 1 },
        { board_id: 'nexu', status: 'todo', end_date: '2026-10-12', task_count: 1 },
        { board_id: 'nexu', status: 'todo', end_date: '2026-11-12', task_count: 3 },
        { board_id: 'otro', status: 'todo', end_date: null, task_count: 2 },
      ],
      '2026-10-07',
    )
    expect(summaries.nexu.total).toBe(9)
    expect(summaries.nexu.byStatus).toEqual({ todo: 4, in_progress: 2, done: 3 })
    expect(summaries.nexu.percent).toBe(44) // (3·100 + 2·50) / 9
    expect(summaries.nexu.overdue).toBe(1)
    expect(summaries.nexu.dueSoon).toBe(1)
    expect(summaries.nexu.plannedEnd).toBe('2026-11-12')
    expect(summaries.otro).toMatchObject({ total: 2, percent: 0, overdue: 0, plannedEnd: null })
  })

  it('las tareas completadas no cuentan como atrasadas', () => {
    const summaries = summarizeBoards([{ board_id: 'b', status: 'done', end_date: '2026-01-01', task_count: 5 }], '2026-10-07')
    expect(summaries.b.overdue).toBe(0)
    expect(summaries.b.percent).toBe(100)
  })
})

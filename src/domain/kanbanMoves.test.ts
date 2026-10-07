import { describe, expect, it } from 'vitest'

import { dropIntoPlace, findColumnId, moveAcrossColumns, orderChanged } from './kanbanMoves'

const task = (id: string, column_id: string, position: number) => ({ id, column_id, position })
const columns = ['todo', 'doing', 'done']
const initial = {
  todo: [task('a', 'todo', 0), task('b', 'todo', 1), task('c', 'todo', 2)],
  doing: [task('d', 'doing', 0)],
  done: [],
}

describe('kanbanMoves', () => {
  it('encuentra la columna de una tarea o de una columna', () => {
    expect(findColumnId(initial, 'b', columns)).toBe('todo')
    expect(findColumnId(initial, 'done', columns)).toBe('done')
    expect(findColumnId(initial, 'x', columns)).toBeNull()
  })

  it('reordena dentro de la misma columna', () => {
    const result = dropIntoPlace(initial, 'c', 'a', columns, 'todo')
    expect(result?.orderedIds).toEqual(['c', 'a', 'b'])
    expect(result?.state.todo.map((item) => item.position)).toEqual([0, 1, 2])
    expect(orderChanged(initial, 'todo', result!.orderedIds)).toBe(true)
  })

  it('mueve a otra columna delante de la tarjeta destino', () => {
    const moved = moveAcrossColumns(initial, 'b', 'd', columns)!
    expect(moved.todo.map((item) => item.id)).toEqual(['a', 'c'])
    expect(moved.doing.map((item) => item.id)).toEqual(['b', 'd'])
    expect(moved.doing[0].column_id).toBe('doing')
    const result = dropIntoPlace(moved, 'b', 'd', columns, 'todo')
    expect(result?.columnId).toBe('doing')
    expect(result?.orderedIds).toEqual(['b', 'd'])
  })

  it('suelta en una columna vacía', () => {
    const moved = moveAcrossColumns(initial, 'a', 'done', columns)!
    expect(moved.done.map((item) => item.id)).toEqual(['a'])
    const result = dropIntoPlace(moved, 'a', 'done', columns, 'todo')
    expect(result?.orderedIds).toEqual(['a'])
  })

  it('no cambia nada si se suelta en el mismo lugar', () => {
    const result = dropIntoPlace(initial, 'b', 'b', columns, 'todo')
    expect(orderChanged(initial, 'todo', result!.orderedIds)).toBe(false)
    expect(moveAcrossColumns(initial, 'a', 'b', columns)).toBeNull()
  })
})

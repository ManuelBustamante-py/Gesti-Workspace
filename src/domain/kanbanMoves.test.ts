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
    const result = dropIntoPlace(moved, 'b', 'd', columns, 'todo', 'd')
    expect(result?.columnId).toBe('doing')
    expect(result?.orderedIds).toEqual(['b', 'd'])
  })

  it('suelta en una columna vacía', () => {
    const moved = moveAcrossColumns(initial, 'a', 'done', columns)!
    expect(moved.done.map((item) => item.id)).toEqual(['a'])
    const result = dropIntoPlace(moved, 'a', 'done', columns, 'todo')
    expect(result?.orderedIds).toEqual(['a'])
  })

  describe('caso reportado: Completados [01, 02], En progreso [03, 04]', () => {
    const board = {
      done: [task('01', 'done', 0), task('02', 'done', 1)],
      doing: [task('03', 'doing', 0), task('04', 'doing', 1)],
    }
    const ids = ['done', 'doing']

    it('arrastrar la 03 sobre la mitad inferior de la 02 la deja debajo', () => {
      const moved = moveAcrossColumns(board, '03', '02', ids, true)!
      expect(moved.done.map((item) => item.id)).toEqual(['01', '02', '03'])
      // Al soltar sin haber cambiado de destino, se respeta esa posición.
      const result = dropIntoPlace(moved, '03', '02', ids, 'doing', '02')!
      expect(result.orderedIds).toEqual(['01', '02', '03'])
    })

    it('soltar en el espacio libre bajo las tarjetas la deja al final', () => {
      const moved = moveAcrossColumns(board, '03', 'done', ids)!
      const result = dropIntoPlace(moved, '03', 'done', ids, 'doing', 'done')!
      expect(result.orderedIds).toEqual(['01', '02', '03'])
    })

    it('si tras cambiar de columna se recoloca, se respeta la nueva posición', () => {
      const moved = moveAcrossColumns(board, '03', '02', ids, true)!
      const result = dropIntoPlace(moved, '03', '01', ids, 'doing', '02')!
      expect(result.orderedIds).toEqual(['03', '01', '02'])
    })

    it('dentro de la misma columna, soltar en el espacio libre la lleva al final', () => {
      const result = dropIntoPlace(board, '01', 'done', ids, 'done')!
      expect(result.orderedIds).toEqual(['02', '01'])
    })
  })

  it('no cambia nada si se suelta en el mismo lugar', () => {
    const result = dropIntoPlace(initial, 'b', 'b', columns, 'todo')
    expect(orderChanged(initial, 'todo', result!.orderedIds)).toBe(false)
    expect(moveAcrossColumns(initial, 'a', 'b', columns)).toBeNull()
  })
})

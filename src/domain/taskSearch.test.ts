import { describe, expect, it } from 'vitest'

import { searchTasks } from './taskSearch'

const tasks = [
  { id: 'a', title: 'Revisión de contrato' },
  { id: 'b', title: 'Build de producción' },
  { id: 'c', title: 'Tarea 12 del backlog' },
  { id: 'd', title: 'Diseño del logo' },
  { id: 'e', title: 'Pruebas E2E' },
]
const numbers = new Map([
  ['a', 1],
  ['b', 12],
  ['c', 3],
  ['d', 10],
  ['e', 121],
])
const ids = (query: string, limit?: number) => searchTasks(tasks, numbers, query, limit).map((result) => result.task.id)

describe('searchTasks', () => {
  it('devuelve nada con una búsqueda vacía', () => {
    expect(ids('   ')).toEqual([])
  })

  it('pone primero el número exacto, luego los que empiezan igual y al final los títulos', () => {
    expect(ids('12')).toEqual(['b', 'e', 'c'])
    expect(ids('1')).toEqual(['a', 'd', 'b', 'e', 'c'])
  })

  it('acepta el número con #', () => {
    expect(ids('#10')).toEqual(['d'])
    expect(ids('# 3')).toEqual(['c'])
  })

  it('busca en el título sin distinguir mayúsculas ni tildes', () => {
    expect(ids('REVISION')).toEqual(['a'])
    expect(ids('produccion')).toEqual(['b'])
    expect(ids('de')).toEqual(['a', 'c', 'd', 'b'])
  })

  it('respeta el límite de resultados', () => {
    expect(ids('de', 2)).toEqual(['a', 'c'])
  })

  it('incluye el número de cada resultado', () => {
    expect(searchTasks(tasks, numbers, '12')[0]).toEqual({ task: tasks[1], number: 12 })
  })
})

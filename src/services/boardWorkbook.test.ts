import { describe, expect, it } from 'vitest'

import { normalizeImportedDate, parseImportedRows } from './boardWorkbook'

describe('normalizeImportedDate', () => {
  it('acepta fechas de Excel, ISO y día-mes-año', () => {
    expect(normalizeImportedDate(46357, 'x')).toBe('2026-12-01')
    expect(normalizeImportedDate('2026-12-01', 'x')).toBe('2026-12-01')
    expect(normalizeImportedDate('1/12/2026', 'x')).toBe('2026-12-01')
    expect(normalizeImportedDate(new Date(2026, 11, 1), 'x')).toBe('2026-12-01')
    expect(normalizeImportedDate('', 'x')).toBeNull()
  })

  it('rechaza fechas imposibles', () => {
    expect(() => normalizeImportedDate('2026-13-01', 'Fila 2')).toThrow('Fila 2')
    expect(() => normalizeImportedDate('31/02/2026', 'Fila 2')).toThrow()
  })
})

describe('parseImportedRows', () => {
  const row = (number: number, column: string, title: string, predecessors = '', start = '2026-10-05', end = '2026-10-16') => ({
    'N° Tarea': number,
    Columna: column,
    Tarea: title,
    Descripción: '▌SPRINT\r\nSprint 1',
    Prioridad: 'Alta',
    'Fecha inicio': start,
    'Fecha fin': end,
    Predecesoras: predecessors,
  })

  it('agrupa por columna y conserva números y predecesoras', () => {
    const { board, warnings } = parseImportedRows(
      [row(1, 'Completado', 'A'), row(2, 'Por hacer', 'B', '1'), row(3, 'Por hacer', 'C', '1, 2')],
      'plantilla-kanban-NexuStock.xlsx',
    )
    expect(warnings).toEqual([])
    expect(board.name).toBe('plantilla-kanban-NexuStock')
    expect(board.columns.map((column) => column.name)).toEqual(['Completado', 'Por hacer'])
    expect(board.columns[1].tasks[1].predecessorNumbers).toEqual([1, 2])
    expect(board.columns[0].tasks[0].description).toBe('▌SPRINT\nSprint 1')
  })

  it('convierte columnas extra en secciones de la descripción', () => {
    const { board } = parseImportedRows(
      [{ ...row(1, 'A', 'X'), Descripción: 'Intro', 'Criterios de aceptación': '1. Uno\n2. Dos', Sprint: '' }],
      'f.xlsx',
    )
    expect(board.columns[0].tasks[0].description).toBe('Intro\n\n▌Criterios de aceptación\n1. Uno\n2. Dos')
  })

  it('ignora la columna Responsables y lo avisa', () => {
    const { board, warnings } = parseImportedRows([{ ...row(1, 'A', 'X'), Responsables: 'Ana' }], 'f.xlsx')
    expect(board.columns[0].tasks[0].description).toBe('▌SPRINT\nSprint 1')
    expect(warnings).toEqual(['La columna «Responsables» no se importa: asígnalos desde el detalle de cada tarea.'])
  })

  it('avisa de predecesoras inexistentes y las descarta', () => {
    const { board, warnings } = parseImportedRows([row(1, 'A', 'X', '1, 9')], 'f.xlsx')
    expect(board.columns[0].tasks[0].predecessorNumbers).toEqual([])
    expect(warnings).toHaveLength(2)
  })

  it('conserva el estado de la columna y las fechas reales del flujo', () => {
    const { board, warnings } = parseImportedRows(
      [
        { ...row(1, 'QA final', 'A'), 'Estado columna': 'Completado', 'Fecha completada': '2026-09-14' },
        { ...row(2, 'QA final', 'B'), 'Fecha completada': new Date(2026, 8, 20) },
        { ...row(3, 'En Revisión', 'C'), 'Estado columna': 'En progreso', 'En columna desde': '01-10-2026' },
      ],
      'f.xlsx',
    )
    expect(warnings).toEqual([])
    // «QA final» no se reconocería por el nombre: manda el estado declarado.
    expect(board.columns.map((column) => column.status)).toEqual(['done', 'in_progress'])
    expect(board.columns[0].tasks.map((task) => task.completedAt)).toEqual(['2026-09-14', '2026-09-20'])
    expect(board.columns[1].tasks[0].columnEnteredAt).toBe('2026-10-01')
  })

  it('deduce el estado por el nombre en archivos sin «Estado columna»', () => {
    const { board } = parseImportedRows([row(1, 'Completado', 'A'), row(2, 'Por hacer', 'B')], 'f.xlsx')
    expect(board.columns.map((column) => column.status)).toEqual(['done', 'todo'])
    expect(board.columns[0].tasks[0].completedAt).toBeNull()
  })

  it('descarta fechas reales en el tipo de columna equivocado o futuras, y lo avisa', () => {
    const { board, warnings } = parseImportedRows(
      [
        { ...row(1, 'Por hacer', 'A'), 'Fecha completada': '2026-09-14' },
        { ...row(2, 'Completado', 'B'), 'En columna desde': '2026-09-14' },
        { ...row(3, 'Completado', 'C'), 'Fecha completada': '2999-01-01' },
        { ...row(4, 'Rara', 'D'), 'Estado columna': 'Quizás' },
      ],
      'f.xlsx',
    )
    expect(board.columns[0].tasks[0].completedAt).toBeNull()
    expect(board.columns[1].tasks.map((task) => [task.columnEnteredAt, task.completedAt])).toEqual([[null, null], [null, null]])
    expect(board.columns[2].status).toBe('todo')
    expect(warnings).toHaveLength(4)
  })

  it('rechaza ciclos, números repetidos y fechas invertidas antes de crear nada', () => {
    expect(() => parseImportedRows([row(1, 'A', 'X', '2'), row(2, 'A', 'Y', '1')], 'f.xlsx')).toThrow('ciclo')
    expect(() => parseImportedRows([row(1, 'A', 'X'), row(1, 'A', 'Y')], 'f.xlsx')).toThrow('repetido')
    expect(() => parseImportedRows([row(1, 'A', 'X', '', '2026-10-10', '2026-10-01')], 'f.xlsx')).toThrow('posterior')
  })
})

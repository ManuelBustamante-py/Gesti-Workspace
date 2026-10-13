import { describe, expect, it } from 'vitest'
import { jsPDF } from 'jspdf'

import type { Board } from '../services/boards'
import type { BoardColumn } from '../services/columns'
import type { Task } from '../services/tasks'
import { buildBoardReport } from './boardReport'

const board: Board = {
  id: 'b1', name: 'Sto-Institute', description: 'Tablero de prueba', color: '#fff', owner_id: 'u1',
  created_at: '', updated_at: '', working_days: null, work_start_time: null, work_end_time: null,
}
const column = (id: string, name: string, status: BoardColumn['status']): BoardColumn => ({ id, board_id: 'b1', name, position: 0, status, created_at: '', updated_at: '' })
const task = (id: string, columnId: string, title: string, extra: Partial<Task> = {}): Task => ({
  id, column_id: columnId, title, description: null, priority: 'medium', start_date: null, end_date: null,
  predecessor_ids: [], position: 0, created_at: '', updated_at: '', ...extra,
})

describe('informe PDF del tablero', () => {
  it('incluye avance, carga por responsable y las tareas de cada columna con su plazo', () => {
    const columns = [column('c1', 'Por hacer', 'todo'), column('c2', 'En progreso', 'in_progress'), column('c3', 'Hecho', 'done')]
    const tasksByColumn = {
      c1: [task('t1', 'c1', 'Diseñar portada', { priority: 'high', start_date: '2026-10-01', end_date: '2026-10-05', number: 1 })],
      c2: [task('t2', 'c2', 'Publicar plataforma', { end_date: '2026-10-15', effort: 3, number: 2, description: 'Hosting y dominio' })],
      c3: [task('t3', 'c3', 'Kickoff', { completed_at: '2026-09-30', number: 3 })],
    }
    const doc = buildBoardReport(jsPDF, {
      board, columns, tasksByColumn, assigneeNames: { t1: ['Ana'], t3: ['Ana', 'Luis'] }, generatedAt: new Date('2026-10-13T10:00:00'), today: '2026-10-13',
    })
    const pdf = doc.output()
    for (const text of ['Sto-Institute', 'Avance del proyecto', '50% estimado', 'Carga por responsable', 'Ana', 'Sin responsable',
      'Diseñar portada', 'Atrasada 8 d', 'Vence en 2 d', 'Hosting y dominio', '3 pts', 'Completada 30-09-2026', 'gina 1 de']) {
      expect(pdf).toContain(text)
    }
  })

  it('funciona con un tablero vacío', () => {
    const doc = buildBoardReport(jsPDF, { board, columns: [column('c1', 'Por hacer', 'todo')], tasksByColumn: {}, assigneeNames: {}, generatedAt: new Date() })
    expect(doc.output()).toContain('Sin tareas.')
  })
})

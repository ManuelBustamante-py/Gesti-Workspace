import * as XLSX from 'xlsx-js-style'

import type { Board } from './boards'
import type { BoardColumn } from './columns'
import type { Task, TaskPriority } from './tasks'

export type WorkbookTaskRow = {
  Columna: string
  Tarea: string
  Descripción: string
  Prioridad: string
  'Fecha inicio': string
  'Fecha fin': string
  'Fecha vencimiento'?: string
}

export type ImportedBoard = {
  name: string
  description: string
  color: string
  columns: Array<{
    name: string
    tasks: Array<{
      title: string
      description: string
      priority: TaskPriority
      startDate: string | null
      endDate: string | null
    }>
  }>
}

const headerStyle = {
  fill: { fgColor: { rgb: '294238' } },
  font: { bold: true, color: { rgb: 'E2EDE8' } },
  alignment: { horizontal: 'center' },
}

const statusStyles: Record<'todo' | 'progress' | 'complete', { fill: { fgColor: { rgb: string } }; font: { color: { rgb: string } } }> = {
  todo: { fill: { fgColor: { rgb: '4A2528' } }, font: { color: { rgb: 'D87979' } } },
  progress: { fill: { fgColor: { rgb: '4A3D25' } }, font: { color: { rgb: 'D6AA62' } } },
  complete: { fill: { fgColor: { rgb: '284536' } }, font: { color: { rgb: '73B88E' } } },
}

function columnStatus(name: string): 'todo' | 'progress' | 'complete' {
  const normalized = name.toLowerCase()
  if (normalized.includes('complet') || normalized.includes('final')) return 'complete'
  if (normalized.includes('progreso') || normalized.includes('proceso')) return 'progress'
  return 'todo'
}

function priorityFromValue(value: unknown): TaskPriority {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'alta' || normalized === 'high') return 'high'
  if (normalized === 'baja' || normalized === 'low') return 'low'
  return 'medium'
}

function normalizeDate(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const text = String(value).trim()
  if (!text) return null
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

export function downloadBoardTemplate() {
  const rows: WorkbookTaskRow[] = [
    {
      Columna: 'Por hacer',
      Tarea: 'Ejemplo: definir alcance',
      Descripción: 'Reemplaza esta fila o elimínala.',
      Prioridad: 'Media',
      'Fecha inicio': '2026-12-01',
      'Fecha fin': '2026-12-31',
    },
    {
      Columna: 'En progreso',
      Tarea: '',
      Descripción: '',
      Prioridad: 'Media',
      'Fecha inicio': '',
      'Fecha fin': '',
    },
    {
      Columna: 'Completado',
      Tarea: '',
      Descripción: '',
      Prioridad: 'Media',
      'Fecha inicio': '',
      'Fecha fin': '',
    },
  ]
  const sheet = XLSX.utils.json_to_sheet(rows)
  sheet['!cols'] = [{ wch: 20 }, { wch: 32 }, { wch: 48 }, { wch: 14 }, { wch: 16 }, { wch: 16 }]
  ;['A1', 'B1', 'C1', 'D1', 'E1', 'F1'].forEach((cell) => {
    sheet[cell].s = headerStyle
  })
  rows.slice(0, 3).forEach((row, index) => {
    sheet[`A${index + 2}`].s = statusStyles[columnStatus(row.Columna)]
  })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Actividades')
  XLSX.writeFile(workbook, 'plantilla-kanban.xls')
}

export function exportBoardWorkbook(
  board: Board,
  columns: BoardColumn[],
  tasksByColumn: Record<string, Task[]>,
) {
  const rows: WorkbookTaskRow[] = columns.flatMap((column) =>
    (tasksByColumn[column.id] ?? []).map((task) => ({
      Columna: column.name,
      Tarea: task.title,
      Descripción: task.description ?? '',
      Prioridad: task.priority === 'high' ? 'Alta' : task.priority === 'low' ? 'Baja' : 'Media',
      'Fecha inicio': task.start_date ?? '',
      'Fecha fin': task.end_date ?? '',
    })),
  )
  const exportRows = rows.length > 0
    ? rows
    : columns.map((column) => ({
      Columna: column.name,
      Tarea: '',
      Descripción: '',
      Prioridad: 'Media',
      'Fecha inicio': '',
      'Fecha fin': '',
    }))
  const sheet = XLSX.utils.json_to_sheet(exportRows)
  sheet['!cols'] = [{ wch: 20 }, { wch: 32 }, { wch: 48 }, { wch: 14 }, { wch: 16 }, { wch: 16 }]
  ;['A1', 'B1', 'C1', 'D1', 'E1', 'F1'].forEach((cell) => {
    sheet[cell].s = headerStyle
  })
  exportRows.forEach((row, index) => {
    sheet[`A${index + 2}`].s = statusStyles[columnStatus(row.Columna)]
    sheet[`D${index + 2}`].s = row.Prioridad === 'Alta'
      ? { font: { color: { rgb: 'D87979' } } }
      : row.Prioridad === 'Baja'
      ? { font: { color: { rgb: '8FAE9E' } } }
        : { font: { color: { rgb: 'D6AA62' } } }
  })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Actividades')
  XLSX.writeFile(workbook, `${board.name.replace(/[^\w\s-]/g, '').trim() || 'tablero'}.xls`)
}

export async function readBoardWorkbook(file: File): Promise<ImportedBoard> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0] ?? '']
  if (!firstSheet) throw new Error('El archivo no contiene una hoja válida.')
  const rows = XLSX.utils.sheet_to_json<WorkbookTaskRow>(firstSheet, { defval: '' })
  if (rows.length === 0) throw new Error('El archivo no contiene actividades.')

  const grouped = new Map<string, ImportedBoard['columns'][number]>()
  let taskCount = 0
  rows.forEach((row) => {
    const columnName = String(row.Columna ?? '').trim()
    const title = String(row.Tarea ?? '').trim()
    if (!columnName) return
    const column = grouped.get(columnName) ?? { name: columnName, tasks: [] }
    if (!title) {
      grouped.set(columnName, column)
      return
    }
    column.tasks.push({
      title,
      description: String(row.Descripción ?? '').trim(),
      priority: priorityFromValue(row.Prioridad),
      startDate: normalizeDate(row['Fecha inicio']),
      endDate: normalizeDate(row['Fecha fin']) ?? normalizeDate(row['Fecha vencimiento']),
    })
    taskCount += 1
    grouped.set(columnName, column)
  })
  if (grouped.size === 0 || taskCount === 0) {
    throw new Error('Incluye al menos una fila con Columna y Tarea.')
  }
  return {
    name: file.name.replace(/\.[^.]+$/, '').trim() || 'Tablero importado',
    description: 'Tablero importado desde una plantilla XLS.',
    color: '#a6b4b8',
    columns: [...grouped.values()],
  }
}

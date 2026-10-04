import * as XLSX from 'xlsx-js-style'

import type { Board } from './boards'
import type { BoardColumn } from './columns'
import type { Task, TaskPriority } from './tasks'

export type WorkbookTaskRow = {
  'N° Tarea': number | string
  Columna: string
  Tarea: string
  Descripción: string
  Prioridad: string
  'Fecha inicio': string
  'Fecha fin': string
  Predecesoras: string
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
      activityNumber: number
      predecessorNumbers: number[]
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

const ganttStyles = {
  critical: { fill: { fgColor: { rgb: 'E8798B' } }, font: { color: { rgb: 'FFFFFF' }, bold: true } },
  normal: { fill: { fgColor: { rgb: '6B8FB3' } }, font: { color: { rgb: 'FFFFFF' } } },
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

function localDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function dateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function ganttCriticalIds(tasks: Task[]) {
  const scheduled = tasks.filter((task) => task.start_date && task.end_date)
  const byId = new Map(scheduled.map((task) => [task.id, task]))
  const finish = (task: Task) =>
    localDate(task.end_date as string).getTime() + 86400000
  const critical = new Set<string>()
  const successors = new Map<string, Task[]>()

  scheduled.forEach((task) => {
    ;(task.predecessor_ids ?? []).forEach((predecessorId) => {
      const predecessor = byId.get(predecessorId)
      if (predecessor) {
        successors.set(predecessorId, [
          ...(successors.get(predecessorId) ?? []),
          task,
        ])
      }
    })
  })

  const projectFinish = Math.max(...scheduled.map(finish), 0)
  scheduled.forEach((task) => {
    const successorStart = (successors.get(task.id) ?? []).map((item) =>
      localDate(item.start_date as string).getTime(),
    )
    const latestFinish = successorStart.length
      ? Math.min(...successorStart)
      : projectFinish
    if (Math.abs(latestFinish - finish(task)) <= 86400000) {
      critical.add(task.id)
    }
  })

  return critical
}

export function downloadBoardTemplate() {
  const rows: WorkbookTaskRow[] = [
    {
      'N° Tarea': 1,
      Columna: 'Por hacer',
      Tarea: 'Ejemplo: definir alcance',
      Descripción: 'Reemplaza esta fila o elimínala.',
      Prioridad: 'Media',
      'Fecha inicio': '2026-12-01',
      'Fecha fin': '2026-12-31',
      Predecesoras: '',
    },
    {
      'N° Tarea': 2,
      Columna: 'En progreso',
      Tarea: '',
      Descripción: '',
      Prioridad: 'Media',
      'Fecha inicio': '',
      'Fecha fin': '',
      Predecesoras: '1',
    },
    {
      'N° Tarea': 3,
      Columna: 'Completado',
      Tarea: '',
      Descripción: '',
      Prioridad: 'Media',
      'Fecha inicio': '',
      'Fecha fin': '',
      Predecesoras: '',
    },
  ]
  const sheet = XLSX.utils.json_to_sheet(rows)
  sheet['!cols'] = [{ wch: 14 }, { wch: 20 }, { wch: 32 }, { wch: 48 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }]
  ;['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1'].forEach((cell) => {
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
  const allTasks = columns.flatMap((column) =>
    (tasksByColumn[column.id] ?? []).map((task) => ({ column, task })),
  )
  const activityNumbers = new Map(allTasks.map(({ task }, index) => [task.id, index + 1]))
  const rows: WorkbookTaskRow[] = allTasks.map(({ column, task }, index) => ({
      Columna: column.name,
      'N° Tarea': index + 1,
      Tarea: task.title,
      Descripción: task.description ?? '',
      Prioridad: task.priority === 'high' ? 'Alta' : task.priority === 'low' ? 'Baja' : 'Media',
      'Fecha inicio': task.start_date ?? '',
      'Fecha fin': task.end_date ?? '',
      Predecesoras: (task.predecessor_ids ?? [])
        .map((id) => activityNumbers.get(id))
        .filter((number): number is number => number !== undefined)
        .join(', '),
    }))
  const exportRows = rows.length > 0
    ? rows
    : columns.map((column) => ({
      Columna: column.name,
      'N° Tarea': '',
      Tarea: '',
      Descripción: '',
      Prioridad: 'Media',
      'Fecha inicio': '',
      'Fecha fin': '',
      Predecesoras: '',
    }))
  const sheet = XLSX.utils.json_to_sheet(exportRows)
  sheet['!cols'] = [{ wch: 14 }, { wch: 20 }, { wch: 32 }, { wch: 48 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }]
  ;['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1'].forEach((cell) => {
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

export function exportBoardGanttWorkbook(
  board: Board,
  columns: BoardColumn[],
  tasksByColumn: Record<string, Task[]>,
) {
  const allTasks = columns.flatMap((column) =>
    (tasksByColumn[column.id] ?? []).map((task) => ({ column, task })),
  )
  const tasks = allTasks
    .filter(({ task }) => task.start_date && task.end_date)
    .sort((left, right) =>
      String(left.task.start_date).localeCompare(String(right.task.start_date)) ||
      left.task.position - right.task.position,
    )
  const taskList = tasks.map(({ task }) => task)
  const criticalIds = ganttCriticalIds(taskList)
  const activityNumbers = new Map(allTasks.map(({ task }, index) => [task.id, index + 1]))
  const firstDate = tasks.length
    ? localDate(tasks.reduce(
        (earliest, item) => (item.task.start_date! < earliest ? item.task.start_date! : earliest),
        tasks[0].task.start_date as string,
      ))
    : new Date()
  firstDate.setDate(firstDate.getDate() - ((firstDate.getDay() + 6) % 7))
  const lastDate = tasks.length
    ? localDate(tasks.reduce(
        (latest, item) => (item.task.end_date! > latest ? item.task.end_date! : latest),
        tasks[0].task.end_date as string,
      ))
    : new Date(firstDate)
  const minimumTimelineEnd = new Date(firstDate)
  minimumTimelineEnd.setDate(minimumTimelineEnd.getDate() + 55)
  if (lastDate < minimumTimelineEnd) {
    lastDate.setTime(minimumTimelineEnd.getTime())
  }
  const dates: Date[] = []
  for (const date = new Date(firstDate); date <= lastDate; date.setDate(date.getDate() + 1)) {
    dates.push(new Date(date))
  }

  const progressForColumn = (name: string) => {
    const status = columnStatus(name)
    return status === 'complete' ? 100 : status === 'progress' ? 60 : 0
  }
  const displayDate = (value: string) => {
    const [year, month, day] = value.split('-')
    return `${day}-${month}-${year.slice(2)}`
  }
  const ganttRows: unknown[][] = [
    [`GANTT DEL PROYECTO: ${board.name}`],
    [],
    ['Inicio del proyecto:', '', '', displayDate(firstDate.toISOString().slice(0, 10))],
    ['Semana para mostrar:', '', '', 1],
    ['', '', '', '', '', '', '', '', ...dates.map((date) =>
      date.getDay() === 1
        ? date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
        : '',
    )],
    ['', '', '', '', '', '', '', '', ...dates.map((date) => date.getDate())],
    ['', '', '', '', '', '', '', '', ...dates.map((date) =>
      date.toLocaleDateString('es-ES', { weekday: 'short' }).slice(0, 1).toLowerCase(),
    )],
    ['', 'TAREA', 'ASIGNADO A', 'PROGRESO', 'INICIO', 'FIN', 'PREDECESORAS', 'DÍAS', ...dates.map(() => '')],
  ]

  tasks.forEach(({ task, column }) => {
    const duration = Math.max(
      1,
      Math.round(
        (localDate(task.end_date as string).getTime() -
          localDate(task.start_date as string).getTime()) / 86400000,
      ) + 1,
    )
    const predecessorNumbers = (task.predecessor_ids ?? [])
      .map((id) => activityNumbers.get(id))
      .filter((number): number is number => number !== undefined)
      .join(', ')
    ganttRows.push([
      '',
      task.title,
      column.name,
      progressForColumn(column.name),
      displayDate(task.start_date as string),
      displayDate(task.end_date as string),
      predecessorNumbers,
      duration,
      ...dates.map((date) => {
        const key = dateKey(date)
        return key >= (task.start_date as string) && key <= (task.end_date as string) ? ' ' : ''
      }),
    ])
  })

  const ganttSheet = XLSX.utils.aoa_to_sheet(ganttRows)
  const timelineStartColumn = 8
  ganttSheet['!cols'] = [
    { wch: 3 }, { wch: 42 }, { wch: 18 }, { wch: 12 }, { wch: 13 },
    { wch: 13 }, { wch: 16 }, { wch: 8 }, ...dates.map(() => ({ wch: 4 })),
  ]
  ganttSheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: timelineStartColumn + dates.length - 1 } },
  ]
  ganttSheet['!freeze'] = { xSplit: timelineStartColumn, ySplit: 8 }
  ganttSheet['!autofilter'] = {
    ref: `B8:${XLSX.utils.encode_col(timelineStartColumn + dates.length - 1)}${ganttRows.length}`,
  }
  ganttSheet['A1'].s = {
    fill: { fgColor: { rgb: '294238' } },
    font: { bold: true, color: { rgb: 'E2EDE8' }, sz: 14 },
    alignment: { horizontal: 'left' },
  }
  ganttSheet['A8'].s = headerStyle
  for (let column = 1; column < timelineStartColumn + dates.length; column += 1) {
    ganttSheet[XLSX.utils.encode_cell({ r: 7, c: column })].s = headerStyle
  }
  dates.forEach((date, dateIndex) => {
    const column = timelineStartColumn + dateIndex
    const weekStyle = date.getDay() === 1
      ? { fill: { fgColor: { rgb: '385B4C' } }, font: { bold: true, color: { rgb: 'E2EDE8' } }, alignment: { horizontal: 'center' } }
      : { fill: { fgColor: { rgb: '294238' } }, font: { bold: true, color: { rgb: 'E2EDE8' } }, alignment: { horizontal: 'center' } }
    ganttSheet[XLSX.utils.encode_cell({ r: 4, c: column })].s = weekStyle
    ganttSheet[XLSX.utils.encode_cell({ r: 5, c: column })].s = weekStyle
    ganttSheet[XLSX.utils.encode_cell({ r: 6, c: column })].s = weekStyle
    ganttSheet[XLSX.utils.encode_cell({ r: 7, c: column })].s = weekStyle
  })
  tasks.forEach(({ task }, taskIndex) => {
    const rowIndex = taskIndex + 8
    const critical = criticalIds.has(task.id)
    const progress = progressForColumn(tasks[taskIndex].column.name)
    ganttSheet[XLSX.utils.encode_cell({ r: rowIndex, c: 1 })].s = critical
      ? ganttStyles.critical
      : { font: { color: { rgb: 'DCE8E1' } } }
    ganttSheet[XLSX.utils.encode_cell({ r: rowIndex, c: 3 })].s = {
      fill: { fgColor: { rgb: progress === 100 ? '284536' : progress > 0 ? '4A3D25' : '1C2522' } },
      font: { color: { rgb: 'E2EDE8' }, bold: true },
      alignment: { horizontal: 'center' },
    }
    for (let dateIndex = 0; dateIndex < dates.length; dateIndex += 1) {
      const cell = ganttSheet[XLSX.utils.encode_cell({ r: rowIndex, c: timelineStartColumn + dateIndex })]
      if (cell?.v !== '') {
        cell.s = critical ? ganttStyles.critical : ganttStyles.normal
      }
    }
  })

  const dataRows = allTasks.map(({ task, column }, index) => ({
    'N° Tarea': index + 1,
    Tarea: task.title,
    Columna: column.name,
    'Fecha inicio': task.start_date ?? '',
    'Fecha fin': task.end_date ?? '',
    Predecesoras: (task.predecessor_ids ?? [])
      .map((id) => activityNumbers.get(id))
      .filter((number): number is number => number !== undefined)
      .join(', '),
    'Ruta crítica': criticalIds.has(task.id) ? 'Sí' : 'No',
  }))
  const dataSheet = XLSX.utils.json_to_sheet(dataRows)
  dataSheet['!cols'] = [{ wch: 11 }, { wch: 42 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 14 }]
  ;['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1'].forEach((cell) => {
    dataSheet[cell].s = headerStyle
  })
  dataSheet['!autofilter'] = { ref: `A1:G${dataRows.length + 1}` }
  dataSheet['!freeze'] = { xSplit: 2, ySplit: 1 }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, ganttSheet, 'Gantt')
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Datos')
  XLSX.writeFile(workbook, `${board.name.replace(/[^\w\s-]/g, '').trim() || 'tablero'}-gantt.xls`)
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
  let nextActivityNumber = 1
  rows.forEach((row) => {
    const columnName = String(row.Columna ?? '').trim()
    const title = String(row.Tarea ?? '').trim()
    if (!columnName) return
    const column = grouped.get(columnName) ?? { name: columnName, tasks: [] }
    if (!title) {
      grouped.set(columnName, column)
      return
    }
    const activityNumber = Number.parseInt(
      String(row['N° Tarea'] ?? (row as Record<string, unknown>)['N° actividad'] ?? ''),
      10,
    ) || nextActivityNumber
    column.tasks.push({
      title,
      description: String(row.Descripción ?? '').trim(),
      priority: priorityFromValue(row.Prioridad),
      startDate: normalizeDate(row['Fecha inicio']),
      endDate: normalizeDate(row['Fecha fin']) ?? normalizeDate(row['Fecha vencimiento']),
      activityNumber,
      predecessorNumbers: String(row.Predecesoras ?? '')
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isInteger(value) && value > 0),
    })
    nextActivityNumber = Math.max(nextActivityNumber + 1, activityNumber + 1)
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

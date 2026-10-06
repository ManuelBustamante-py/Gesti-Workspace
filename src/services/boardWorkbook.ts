import type { WorkSheet } from 'xlsx-js-style'

import type { Board } from './boards'
import { boardSchedule, describeWorkingDays } from '../domain/workSchedule'
import type { BoardColumn } from './columns'
import type { Task, TaskPriority } from './tasks'
import {
  columnStatusLabels,
  columnStatusProgress,
  resolveColumnStatus,
} from '../domain/columnStatus'
import {
  addDays,
  countWorkingDays,
  dateKeyToExcelSerial,
  excelSerialToDateKey,
  isValidDateKey,
  isWorkingDay,
  localDateToKey,
  startOfWeek,
  taskDuration,
  todayKey,
  weekdayNumber,
  formatDateKey,
} from '../domain/dates'
import { composeDescription, splitDescriptionSections } from '../domain/description'
import { findCycle } from '../domain/dependencies'
import { activityNumbers } from '../domain/numbering'
import { computeSchedule } from '../domain/schedule'

// La librería pesa ~400 KB: se carga solo al importar o exportar.
const loadXlsx = () => import('xlsx-js-style')

export const WORKBOOK_HEADERS = [
  'N° Tarea',
  'Columna',
  'Tarea',
  'Descripción',
  'Prioridad',
  'Fecha inicio',
  'Fecha fin',
  'Predecesoras',
] as const

type WorkbookHeader = (typeof WORKBOOK_HEADERS)[number]
type CellValue = string | number | { t: 'n'; v: number; z: string } | null

export type ImportedTask = {
  title: string
  description: string
  priority: TaskPriority
  startDate: string | null
  endDate: string | null
  activityNumber: number
  predecessorNumbers: number[]
}

export type ImportedBoard = {
  name: string
  description: string
  color: string
  columns: Array<{ name: string; tasks: ImportedTask[] }>
}

export type ImportResult = {
  board: ImportedBoard
  warnings: string[]
}

const COLORS = {
  header: '294238',
  headerText: 'E2EDE8',
  headerAlt: '385B4C',
  border: 'D8E2DD',
  zebra: 'F7FAF9',
  critical: 'D9536F',
  criticalDone: '9E2F48',
  normal: '6B8FB3',
  normalDone: '3F6F99',
  complete: '3F8F68',
  nonWorking: 'E6EBE9',
  nonWorkingActive: 'C9D6E2',
  white: 'FFFFFF',
  text: '1F2A26',
  muted: '5D6B66',
  priority: { high: 'C0392B', medium: 'B7791F', low: '2F855A' } as Record<TaskPriority, string>,
}

const thinBorder = {
  top: { style: 'thin', color: { rgb: COLORS.border } },
  bottom: { style: 'thin', color: { rgb: COLORS.border } },
  left: { style: 'thin', color: { rgb: COLORS.border } },
  right: { style: 'thin', color: { rgb: COLORS.border } },
}

const headerStyle = {
  fill: { fgColor: { rgb: COLORS.header } },
  font: { bold: true, color: { rgb: COLORS.headerText } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: thinBorder,
}

const bodyStyle = (options: { wrap?: boolean; center?: boolean; zebra?: boolean } = {}) => ({
  alignment: {
    vertical: 'top',
    horizontal: options.center ? 'center' : 'left',
    wrapText: options.wrap ?? false,
  },
  font: { color: { rgb: COLORS.text } },
  fill: options.zebra ? { fgColor: { rgb: COLORS.zebra } } : undefined,
  border: thinBorder,
})

const priorityLabel: Record<TaskPriority, string> = { high: 'Alta', medium: 'Media', low: 'Baja' }

function dateCell(value: string | null): CellValue {
  return value ? { t: 'n', v: dateKeyToExcelSerial(value), z: 'dd-mm-yyyy' } : ''
}

function fileSafeName(name: string) {
  return name.replace(/[^\w\s-áéíóúñÁÉÍÓÚÑ]/g, '').trim() || 'tablero'
}

/** Altura aproximada de fila para texto ajustado (Excel no la calcula al abrir). */
function rowHeightFor(texts: Array<[string, number]>, minimum = 18) {
  const lines = Math.max(
    1,
    ...texts.map(([text, width]) =>
      text
        .split('\n')
        .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / Math.max(width - 2, 8))), 0),
    ),
  )
  return Math.min(409, Math.max(minimum, lines * 14 + 6))
}

function styleRange(sheet: WorkSheet, XLSX: typeof import('xlsx-js-style'), row: number, fromCol: number, toCol: number, style: object) {
  for (let column = fromCol; column <= toCol; column += 1) {
    const address = XLSX.utils.encode_cell({ r: row, c: column })
    sheet[address] = sheet[address] ?? { t: 's', v: '' }
    sheet[address].s = style
  }
}

// ---------------------------------------------------------------------------
// Plantilla y exportación de datos (mismo formato, reimportable)
// ---------------------------------------------------------------------------

type ActivityRow = {
  number: number | ''
  column: string
  title: string
  /** Texto libre que no pertenece a ninguna sección con columna propia. */
  description: string
  /** Secciones de la descripción con columna propia (título → contenido). */
  sections: Record<string, string>
  priority: string
  start: string | null
  end: string | null
  predecessors: string
}

const MAX_SECTION_COLUMNS = 10
const BASE_WIDTHS = { number: 9, column: 14, title: 30, description: 34, priority: 10, date: 12, predecessors: 13 }
const SECTION_WIDTH = 44

/**
 * Reparte las descripciones con secciones «▌Título» en columnas propias para
 * que el Excel se lea como tabla. Si las secciones no son regulares (títulos
 * repetidos, demasiados o que chocan con columnas fijas) se deja todo en
 * «Descripción».
 */
function splitIntoSectionColumns(descriptions: string[]) {
  const reserved = new Set(WORKBOOK_HEADERS.map((header) => header.toLowerCase()))
  const titles: string[] = []
  const split = descriptions.map((description) => splitDescriptionSections(description))

  for (const sections of split) {
    const seen = new Set<string>()
    for (const section of sections) {
      if (!section.title) continue
      const key = section.title.toLowerCase()
      if (seen.has(key) || reserved.has(key)) return null
      seen.add(key)
      if (!titles.some((title) => title.toLowerCase() === key)) titles.push(section.title)
    }
  }
  if (titles.length === 0 || titles.length > MAX_SECTION_COLUMNS) return null

  return {
    titles,
    rows: split.map((sections) => ({
      intro: sections.filter((section) => !section.title).map((section) => section.body).join('\n\n'),
      sections: Object.fromEntries(
        titles.map((title) => [
          title,
          sections.find((section) => section.title?.toLowerCase() === title.toLowerCase())?.body ?? '',
        ]),
      ),
    })),
  }
}

async function writeActivitiesWorkbook(
  rows: ActivityRow[],
  sectionTitles: string[],
  fileName: string,
  includeInstructions: boolean,
) {
  const XLSX = await loadXlsx()
  const headers = [...WORKBOOK_HEADERS, ...sectionTitles]
  const lastColumn = headers.length - 1
  const widths = [
    BASE_WIDTHS.number,
    BASE_WIDTHS.column,
    BASE_WIDTHS.title,
    sectionTitles.length ? BASE_WIDTHS.description : 70,
    BASE_WIDTHS.priority,
    BASE_WIDTHS.date,
    BASE_WIDTHS.date,
    BASE_WIDTHS.predecessors,
    ...sectionTitles.map((title) => (title.length <= 18 ? Math.max(12, title.length + 4) : SECTION_WIDTH)),
  ]

  const sheet = XLSX.utils.aoa_to_sheet([
    headers,
    ...rows.map((row) => [
      row.number,
      row.column,
      row.title,
      row.description,
      row.priority,
      dateCell(row.start),
      dateCell(row.end),
      row.predecessors,
      ...sectionTitles.map((title) => row.sections[title] ?? ''),
    ]),
  ])

  sheet['!cols'] = widths.map((wch) => ({ wch }))
  sheet['!rows'] = [
    { hpt: 32 },
    ...rows.map((row) => ({
      hpt: rowHeightFor([
        [row.title, widths[2]],
        [row.description, widths[3]],
        ...sectionTitles.map((title, index): [string, number] => [row.sections[title] ?? '', widths[8 + index]]),
      ]),
    })),
  ]
  sheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(lastColumn)}${rows.length + 1}` }
  styleRange(sheet, XLSX, 0, 0, lastColumn, headerStyle)
  if (sectionTitles.length) {
    styleRange(sheet, XLSX, 0, 8, lastColumn, { ...headerStyle, fill: { fgColor: { rgb: COLORS.headerAlt } } })
  }

  rows.forEach((row, index) => {
    const r = index + 1
    const zebra = index % 2 === 1
    styleRange(sheet, XLSX, r, 0, lastColumn, bodyStyle({ zebra, wrap: true }))
    styleRange(sheet, XLSX, r, 0, 0, bodyStyle({ zebra, center: true }))
    styleRange(sheet, XLSX, r, 2, 2, { ...bodyStyle({ zebra, wrap: true }), font: { bold: true, color: { rgb: COLORS.text } } })
    styleRange(sheet, XLSX, r, 5, 7, bodyStyle({ zebra, center: true }))
    const priorityKey = (Object.keys(priorityLabel) as TaskPriority[]).find(
      (key) => priorityLabel[key] === row.priority,
    )
    styleRange(sheet, XLSX, r, 4, 4, {
      ...bodyStyle({ zebra, center: true }),
      font: { bold: true, color: { rgb: COLORS.priority[priorityKey ?? 'medium'] } },
    })
  })

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Actividades')

  if (includeInstructions) {
    const lines: string[][] = [
      ['Cómo completar la plantilla'],
      ['N° Tarea', 'Número único de la actividad. Se usa en la columna Predecesoras.'],
      ['Columna', 'Nombre de la columna Kanban (p. ej. Por hacer, En progreso, Completado). Se crea si no existe.'],
      ['Tarea', 'Título corto de la actividad. Obligatorio.'],
      ['Descripción', 'Texto libre. Admite saltos de línea (Alt+Enter).'],
      ['Prioridad', 'Alta, Media o Baja.'],
      ['Fecha inicio / Fecha fin', 'Fecha de Excel o texto AAAA-MM-DD o DD-MM-AAAA. La de inicio no puede ser posterior a la de fin.'],
      ['Predecesoras', 'Números de tarea separados por coma (p. ej. 4, 5). La actividad empieza cuando terminan todas.'],
      ['Columnas extra', 'Puedes añadir columnas después de «Predecesoras» (p. ej. «Historia de usuario», «Criterios de aceptación»). Cada una se importa como una sección de la descripción y el tablero la muestra con su título.'],
      ['Formato del texto', 'Dentro de cualquier celda de texto: «1.» para pasos numerados y «•» o «-» para viñetas. En Descripción también puedes crear secciones con «▌Título» o «## Título».'],
    ]
    const instructions = XLSX.utils.aoa_to_sheet(lines)
    instructions['!cols'] = [{ wch: 24 }, { wch: 100 }]
    instructions['!rows'] = lines.map((_, index) => ({ hpt: index === 0 ? 26 : 32 }))
    instructions.A1.s = { font: { bold: true, sz: 14, color: { rgb: COLORS.header } } }
    for (let row = 1; row < lines.length; row += 1) {
      styleRange(instructions, XLSX, row, 0, 0, { font: { bold: true, color: { rgb: COLORS.header } }, alignment: { vertical: 'top' } })
      styleRange(instructions, XLSX, row, 1, 1, { alignment: { vertical: 'top', wrapText: true } })
    }
    XLSX.utils.book_append_sheet(workbook, instructions, 'Instrucciones')
  }

  XLSX.writeFile(workbook, fileName)
}

export async function downloadBoardTemplate() {
  const sectionTitles = ['Historia de usuario', 'Criterios de aceptación', 'Definition of Done']
  const example = (description: string, sections: string[]): Pick<ActivityRow, 'description' | 'sections'> => ({
    description,
    sections: Object.fromEntries(sectionTitles.map((title, index) => [title, sections[index] ?? ''])),
  })

  await writeActivitiesWorkbook(
    [
      {
        number: 1, column: 'Por hacer', title: 'Ejemplo: definir alcance', priority: 'Alta', start: '2026-12-01', end: '2026-12-11', predecessors: '',
        ...example('Sprint 1 · Peso 3', [
          'Como responsable del proyecto,\nquiero definir el alcance,\npara alinear al equipo.',
          '1. Alcance documentado.\n2. Validado con el cliente.',
          '• Documento publicado en el repositorio.',
        ]),
      },
      {
        number: 2, column: 'Por hacer', title: 'Ejemplo: diseñar solución', priority: 'Media', start: '2026-12-14', end: '2026-12-18', predecessors: '1',
        ...example('Reemplaza o elimina estas filas. Las columnas extra son opcionales.', []),
      },
      {
        number: 3, column: 'Completado', title: 'Ejemplo: reunión inicial', priority: 'Baja', start: '2026-11-30', end: '2026-11-30', predecessors: '',
        ...example('', []),
      },
    ],
    sectionTitles,
    'plantilla-kanban.xlsx',
    true,
  )
}

export async function exportBoardWorkbook(
  board: Board,
  columns: BoardColumn[],
  tasksByColumn: Record<string, Task[]>,
) {
  const numbers = activityNumbers(columns, tasksByColumn)
  const entries = columns.flatMap((column) => (tasksByColumn[column.id] ?? []).map((task) => ({ column, task })))
  const sectionColumns = splitIntoSectionColumns(entries.map(({ task }) => task.description ?? ''))

  const rows: ActivityRow[] = entries.map(({ column, task }, index) => ({
    number: numbers.get(task.id) ?? '',
    column: column.name,
    title: task.title,
    description: sectionColumns ? sectionColumns.rows[index].intro : task.description ?? '',
    sections: sectionColumns ? sectionColumns.rows[index].sections : {},
    priority: priorityLabel[task.priority],
    start: task.start_date,
    end: task.end_date,
    predecessors: (task.predecessor_ids ?? [])
      .map((id) => numbers.get(id))
      .filter((value): value is number => value !== undefined)
      .join(', '),
  }))
  // Un tablero sin tareas exporta igualmente sus columnas.
  const exportRows = rows.length > 0
    ? rows
    : columns.map((column) => ({ number: '' as const, column: column.name, title: '', description: '', sections: {}, priority: 'Media', start: null, end: null, predecessors: '' }))

  await writeActivitiesWorkbook(exportRows, sectionColumns?.titles ?? [], `${fileSafeName(board.name)}.xlsx`, false)
}

// ---------------------------------------------------------------------------
// Gantt
// ---------------------------------------------------------------------------

const WEEKDAY_INITIALS = ['d', 'l', 'm', 'x', 'j', 'v', 's']

export async function exportBoardGanttWorkbook(
  board: Board,
  columns: BoardColumn[],
  tasksByColumn: Record<string, Task[]>,
) {
  const XLSX = await loadXlsx()
  const schedule = boardSchedule(board)
  const workingDays = schedule.working_days
  const numbers = activityNumbers(columns, tasksByColumn)
  const allTasks = columns.flatMap((column) =>
    (tasksByColumn[column.id] ?? []).map((task) => ({ column, task })),
  )
  const projectSchedule = computeSchedule(allTasks.map(({ task }) => task), workingDays)
  const scheduled = allTasks
    .filter(({ task }) => task.start_date && task.end_date)
    .sort((left, right) =>
      String(left.task.start_date).localeCompare(String(right.task.start_date)) ||
      (numbers.get(left.task.id) ?? 0) - (numbers.get(right.task.id) ?? 0),
    )

  const firstDate = startOfWeek(
    scheduled.reduce((earliest, { task }) => (task.start_date! < earliest ? task.start_date! : earliest), scheduled[0]?.task.start_date ?? todayKey()),
  )
  let lastDate = scheduled.reduce((latest, { task }) => (task.end_date! > latest ? task.end_date! : latest), firstDate)
  // Al menos 8 semanas y siempre semanas completas.
  if (lastDate < addDays(firstDate, 55)) lastDate = addDays(firstDate, 55)
  lastDate = addDays(startOfWeek(lastDate), 6)
  const dates: string[] = []
  for (let date = firstDate; date <= lastDate; date = addDays(date, 1)) dates.push(date)

  const timelineStart = 8
  const lastColumn = timelineStart + dates.length - 1
  const predecessorText = (task: Task) =>
    (task.predecessor_ids ?? [])
      .map((id) => numbers.get(id))
      .filter((value): value is number => value !== undefined)
      .join(', ')
  const projectStart = scheduled[0]?.task.start_date ?? null
  const projectEnd = scheduled.reduce<string | null>((latest, { task }) => (!latest || task.end_date! > latest ? task.end_date! : latest), null)
  const criticalCount = scheduled.filter(({ task }) => projectSchedule.tasks.get(task.id)?.critical).length

  const blankTimeline = () => dates.map(() => '')
  const rows: CellValue[][] = [
    [`Diagrama Gantt · ${board.name}`, ...Array(timelineStart - 1).fill(''), ...blankTimeline()],
    [
      `Inicio: ${projectStart ? formatDateKey(projectStart) : '—'}   ·   Fin: ${projectEnd ? formatDateKey(projectEnd) : '—'}   ·   Jornada: ${describeWorkingDays(workingDays)} ${schedule.work_start_time}–${schedule.work_end_time}   ·   ${criticalCount} actividad(es) crítica(s)   ·   Generado: ${formatDateKey(localDateToKey(new Date()))}`,
    ],
    ['Leyenda', '', 'Ruta crítica', 'Normal', 'Avance', 'Completada', 'No laborable'],
    [],
    ['', '', '', '', '', '', '', '', ...dates.map((date) =>
      weekdayNumber(date) === 2 ? formatDateKey(date, { day: 'numeric', month: 'short', year: 'numeric' }) : '',
    )],
    ['', '', '', '', '', '', '', '', ...dates.map((date) => Number(date.slice(8, 10)))],
    ['', '', '', '', '', '', '', '', ...dates.map((date) => WEEKDAY_INITIALS[weekdayNumber(date) - 1])],
    ['N°', 'TAREA', 'COLUMNA', 'AVANCE', 'INICIO', 'FIN', 'DÍAS HÁB.', 'PRED.', ...blankTimeline()],
    ...scheduled.map(({ task, column }) => [
      numbers.get(task.id) ?? '',
      task.title,
      column.name,
      { t: 'n' as const, v: columnStatusProgress[resolveColumnStatus(column)] / 100, z: '0%' },
      dateCell(task.start_date),
      dateCell(task.end_date),
      taskDuration(task.start_date!, task.end_date!, workingDays),
      predecessorText(task),
      ...blankTimeline(),
    ]),
  ]

  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols'] = [
    { wch: 5 }, { wch: 40 }, { wch: 16 }, { wch: 9 }, { wch: 11 }, { wch: 11 }, { wch: 9 }, { wch: 9 },
    ...dates.map(() => ({ wch: 3.2 })),
  ]
  sheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastColumn } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastColumn } },
    ...Array.from({ length: dates.length / 7 }, (_, week) => ({
      s: { r: 4, c: timelineStart + week * 7 },
      e: { r: 4, c: timelineStart + week * 7 + 6 },
    })),
  ]
  sheet['!autofilter'] = { ref: `A8:H${rows.length}` }
  sheet['!rows'] = [
    { hpt: 28 }, { hpt: 20 }, { hpt: 20 }, { hpt: 8 }, { hpt: 20 }, { hpt: 18 }, { hpt: 16 }, { hpt: 30 },
    ...scheduled.map(({ task }) => ({ hpt: rowHeightFor([[task.title, 40]], 22) })),
  ]

  styleRange(sheet, XLSX, 0, 0, lastColumn, {
    fill: { fgColor: { rgb: COLORS.header } },
    font: { bold: true, sz: 15, color: { rgb: COLORS.headerText } },
    alignment: { vertical: 'center' },
  })
  styleRange(sheet, XLSX, 1, 0, lastColumn, {
    fill: { fgColor: { rgb: 'F1F5F3' } },
    font: { color: { rgb: COLORS.muted } },
    alignment: { vertical: 'center' },
  })
  const legend: Array<[number, string, string]> = [
    [2, COLORS.critical, COLORS.white],
    [3, COLORS.normal, COLORS.white],
    [4, COLORS.normalDone, COLORS.white],
    [5, COLORS.complete, COLORS.white],
    [6, COLORS.nonWorking, COLORS.text],
  ]
  styleRange(sheet, XLSX, 2, 0, 1, { font: { bold: true, color: { rgb: COLORS.header } }, alignment: { vertical: 'center' } })
  legend.forEach(([column, fill, font]) =>
    styleRange(sheet, XLSX, 2, column, column, {
      fill: { fgColor: { rgb: fill } },
      font: { bold: true, color: { rgb: font }, sz: 9 },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: thinBorder,
    }),
  )

  styleRange(sheet, XLSX, 7, 0, timelineStart - 1, headerStyle)
  dates.forEach((date, index) => {
    const column = timelineStart + index
    const monday = weekdayNumber(date) === 2
    const working = isWorkingDay(date, workingDays)
    const style = {
      fill: { fgColor: { rgb: monday ? COLORS.headerAlt : COLORS.header } },
      font: { bold: true, sz: 9, color: { rgb: working ? COLORS.headerText : '9FB3AA' } },
      alignment: { horizontal: monday ? 'left' : 'center', vertical: 'center' },
      border: thinBorder,
    }
    ;[4, 5, 6, 7].forEach((row) => styleRange(sheet, XLSX, row, column, column, style))
  })

  scheduled.forEach(({ task, column }, index) => {
    const r = index + 8
    const info = projectSchedule.tasks.get(task.id)
    const critical = info?.critical ?? false
    const status = resolveColumnStatus(column)
    const progress = columnStatusProgress[status]
    const zebra = index % 2 === 1
    const workingTotal = countWorkingDays(task.start_date!, task.end_date!, workingDays)
    const completedWorkingDays = Math.round((workingTotal * progress) / 100)
    let workingSeen = 0

    styleRange(sheet, XLSX, r, 0, timelineStart - 1, bodyStyle({ zebra, center: true }))
    styleRange(sheet, XLSX, r, 1, 1, {
      ...bodyStyle({ zebra, wrap: true }),
      font: { bold: critical, color: { rgb: critical ? COLORS.critical : COLORS.text } },
    })
    styleRange(sheet, XLSX, r, 2, 2, bodyStyle({ zebra, wrap: true }))
    styleRange(sheet, XLSX, r, 3, 3, {
      ...bodyStyle({ zebra, center: true }),
      font: { bold: true, color: { rgb: progress === 100 ? COLORS.complete : progress > 0 ? COLORS.normalDone : COLORS.muted } },
    })

    dates.forEach((date, dateIndex) => {
      const working = isWorkingDay(date, workingDays)
      const active = date >= task.start_date! && date <= task.end_date!
      let fill: string = working ? (zebra ? COLORS.zebra : COLORS.white) : COLORS.nonWorking
      if (active && working) {
        workingSeen += 1
        const done = workingSeen <= completedWorkingDays
        fill = progress === 100
          ? COLORS.complete
          : critical
            ? (done ? COLORS.criticalDone : COLORS.critical)
            : (done ? COLORS.normalDone : COLORS.normal)
      } else if (active) {
        fill = COLORS.nonWorkingActive
      }
      styleRange(sheet, XLSX, r, timelineStart + dateIndex, timelineStart + dateIndex, {
        fill: { fgColor: { rgb: fill } },
        border: thinBorder,
      })
    })
  })

  // Hoja de datos: todas las tareas, con o sin fechas.
  const dataHeaders = ['N° Tarea', 'Tarea', 'Columna', 'Estado', 'Prioridad', 'Fecha inicio', 'Fecha fin', 'Días hábiles', 'Predecesoras', 'Holgura (días háb.)', 'Ruta crítica', 'Observación']
  const dataRows: CellValue[][] = allTasks.map(({ task, column }) => {
    const info = projectSchedule.tasks.get(task.id)
    const observations = [
      !task.start_date || !task.end_date ? 'Sin fechas: no aparece en el Gantt' : '',
      info?.startsBeforePredecessor ? 'Empieza antes de que termine una predecesora' : '',
      projectSchedule.cyclicTaskIds.has(task.id) ? 'Forma parte de un ciclo de dependencias' : '',
    ].filter(Boolean)
    return [
      numbers.get(task.id) ?? '',
      task.title,
      column.name,
      columnStatusLabels[resolveColumnStatus(column)],
      priorityLabel[task.priority],
      dateCell(task.start_date),
      dateCell(task.end_date),
      info ? info.duration : '',
      predecessorText(task),
      info && Number.isFinite(info.totalFloat) ? info.totalFloat : '',
      info?.critical ? 'Sí' : 'No',
      observations.join('. '),
    ]
  })
  const dataSheet = XLSX.utils.aoa_to_sheet([dataHeaders, ...dataRows])
  const dataWidths = [9, 40, 16, 13, 10, 12, 12, 11, 13, 13, 11, 42]
  dataSheet['!cols'] = dataWidths.map((wch) => ({ wch }))
  dataSheet['!autofilter'] = { ref: `A1:L${dataRows.length + 1}` }
  dataSheet['!rows'] = [{ hpt: 30 }, ...allTasks.map(({ task }) => ({ hpt: rowHeightFor([[task.title, 40]], 20) }))]
  styleRange(dataSheet, XLSX, 0, 0, dataHeaders.length - 1, headerStyle)
  dataRows.forEach((row, index) => {
    const zebra = index % 2 === 1
    styleRange(dataSheet, XLSX, index + 1, 0, dataHeaders.length - 1, bodyStyle({ zebra, center: true }))
    styleRange(dataSheet, XLSX, index + 1, 1, 1, bodyStyle({ zebra, wrap: true }))
    styleRange(dataSheet, XLSX, index + 1, 11, 11, bodyStyle({ zebra, wrap: true }))
    if (row[10] === 'Sí') {
      styleRange(dataSheet, XLSX, index + 1, 10, 10, {
        ...bodyStyle({ zebra, center: true }),
        font: { bold: true, color: { rgb: COLORS.critical } },
      })
    }
  })

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Gantt')
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Datos')
  XLSX.writeFile(workbook, `${fileSafeName(board.name)}-gantt.xlsx`)
}

// ---------------------------------------------------------------------------
// Importación
// ---------------------------------------------------------------------------

function priorityFromValue(value: unknown): TaskPriority {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'alta' || normalized === 'high') return 'high'
  if (normalized === 'baja' || normalized === 'low') return 'low'
  return 'medium'
}

/** Normaliza una fecha de celda. Devuelve null si está vacía y lanza si es inválida. */
export function normalizeImportedDate(value: unknown, context: string): string | null {
  if (value === null || value === undefined || value === '') return null
  // SheetJS entrega las celdas de fecha como Date a medianoche local: se leen
  // con getters locales para no correr un día en zonas UTC+.
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`${context}: fecha inválida.`)
    return localDateToKey(value)
  }
  if (typeof value === 'number') return excelSerialToDateKey(value)

  const text = String(value).trim()
  if (!text) return null
  let key: string | null = null
  const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text)
  if (dayFirst) key = `${dayFirst[3]}-${dayFirst[2].padStart(2, '0')}-${dayFirst[1].padStart(2, '0')}`
  else if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) {
    const [year, month, day] = text.split('-')
    key = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  if (!key || !isValidDateKey(key)) {
    throw new Error(`${context}: "${text}" no es una fecha válida (usa AAAA-MM-DD o DD-MM-AAAA).`)
  }
  return key
}

const KNOWN_IMPORT_HEADERS = new Set<string>([...WORKBOOK_HEADERS, 'N° actividad', 'Fecha vencimiento'])

function cellText(value: unknown) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim()
}

type ImportedRow = Partial<Record<WorkbookHeader | 'N° actividad' | 'Fecha vencimiento', unknown>> & Record<string, unknown>

/**
 * Valida y agrupa las filas. Las columnas que no son del formato base (p. ej.
 * «Criterios de aceptación») se añaden a la descripción como secciones.
 */
export function parseImportedRows(rows: ImportedRow[], fileName: string): ImportResult {
  const warnings: string[] = []
  const errors: string[] = []
  const grouped = new Map<string, ImportedBoard['columns'][number]>()
  const tasksByNumber = new Map<number, ImportedTask>()
  let nextActivityNumber = 1

  rows.forEach((row, index) => {
    const line = `Fila ${index + 2}`
    const columnName = String(row.Columna ?? '').trim()
    const title = String(row.Tarea ?? '').trim()
    if (!columnName) {
      if (title) warnings.push(`${line}: la tarea "${title}" no tiene columna y se omitió.`)
      return
    }
    const column = grouped.get(columnName) ?? { name: columnName, tasks: [] }
    grouped.set(columnName, column)
    if (!title) return

    const declaredNumber = Number.parseInt(String(row['N° Tarea'] ?? row['N° actividad'] ?? ''), 10)
    const activityNumber = Number.isInteger(declaredNumber) && declaredNumber > 0 ? declaredNumber : nextActivityNumber
    if (tasksByNumber.has(activityNumber)) {
      errors.push(`${line}: el N° de tarea ${activityNumber} está repetido.`)
      return
    }

    let startDate: string | null = null
    let endDate: string | null = null
    try {
      startDate = normalizeImportedDate(row['Fecha inicio'], `${line}, Fecha inicio`)
      endDate = normalizeImportedDate(row['Fecha fin'], `${line}, Fecha fin`) ??
        normalizeImportedDate(row['Fecha vencimiento'], `${line}, Fecha vencimiento`)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
      return
    }
    if (startDate && endDate && startDate > endDate) {
      errors.push(`${line}: la fecha de inicio es posterior a la de fin.`)
      return
    }

    const task: ImportedTask = {
      title,
      description: composeDescription(
        cellText(row['Descripción']),
        Object.keys(row)
          .filter((key) => !KNOWN_IMPORT_HEADERS.has(key) && !key.startsWith('__EMPTY'))
          .map((key): [string, string] => [key.trim(), cellText(row[key])]),
      ),
      priority: priorityFromValue(row.Prioridad),
      startDate,
      endDate,
      activityNumber,
      predecessorNumbers: [...new Set(
        String(row.Predecesoras ?? '')
          .split(/[,;\s]+/)
          .map((value) => Number.parseInt(value.trim(), 10))
          .filter((value) => Number.isInteger(value) && value > 0),
      )],
    }
    column.tasks.push(task)
    tasksByNumber.set(activityNumber, task)
    nextActivityNumber = Math.max(nextActivityNumber + 1, activityNumber + 1)
  })

  tasksByNumber.forEach((task) => {
    task.predecessorNumbers = task.predecessorNumbers.filter((number) => {
      if (number === task.activityNumber) {
        warnings.push(`Tarea ${number}: no puede ser su propia predecesora; se ignoró.`)
        return false
      }
      if (!tasksByNumber.has(number)) {
        warnings.push(`Tarea ${task.activityNumber}: la predecesora ${number} no existe; se ignoró.`)
        return false
      }
      return true
    })
  })

  const cycle = findCycle(
    new Map([...tasksByNumber].map(([number, task]) => [String(number), task.predecessorNumbers.map(String)])),
  )
  if (cycle) {
    errors.push(`Las predecesoras forman un ciclo: ${[...cycle, cycle[0]].join(' → ')}.`)
  }

  if (errors.length > 0) {
    throw new Error(`No se importó el archivo:\n• ${errors.slice(0, 8).join('\n• ')}${errors.length > 8 ? `\n• y ${errors.length - 8} error(es) más.` : ''}`)
  }
  if (tasksByNumber.size === 0) {
    throw new Error('Incluye al menos una fila con Columna y Tarea.')
  }

  return {
    board: {
      name: fileName.replace(/\.[^.]+$/, '').trim() || 'Tablero importado',
      description: 'Tablero importado desde una plantilla XLSX.',
      color: '#a6b4b8',
      columns: [...grouped.values()],
    },
    warnings,
  }
}

export async function readBoardWorkbook(file: File): Promise<ImportResult> {
  const XLSX = await loadXlsx()
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0] ?? '']
  if (!firstSheet) throw new Error('El archivo no contiene una hoja válida.')
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' })
  if (rows.length === 0) throw new Error('El archivo no contiene actividades.')
  return parseImportedRows(rows, file.name)
}

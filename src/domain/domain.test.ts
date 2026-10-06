import { describe, expect, it } from 'vitest'

import { inferColumnStatus, resolveColumnStatus } from './columnStatus'
import {
  addDays,
  countWorkingDays,
  dateKeyToExcelSerial,
  excelSerialToDateKey,
  isValidDateKey,
  startOfWeek,
  taskDuration,
  weekdayNumber,
} from './dates'
import { createsDependencyCycle, findCycle, relationsFor } from './dependencies'
import {
  composeDescription,
  descriptionField,
  descriptionSummary,
  parseDescription,
  splitDescriptionSections,
} from './description'
import { activityNumbers } from './numbering'
import { computeSchedule } from './schedule'

const WEEKDAYS = [2, 3, 4, 5, 6] // lunes a viernes
const ALL = [1, 2, 3, 4, 5, 6, 7]

describe('dates', () => {
  it('valida claves de fecha reales', () => {
    expect(isValidDateKey('2026-02-28')).toBe(true)
    expect(isValidDateKey('2026-02-30')).toBe(false)
    expect(isValidDateKey('2026-13-01')).toBe(false)
    expect(isValidDateKey('01-02-2026')).toBe(false)
  })

  it('suma días cruzando el cambio de horario sin desfases', () => {
    // Chile cambia de horario en septiembre y abril.
    expect(addDays('2026-09-05', 2)).toBe('2026-09-07')
    expect(addDays('2026-04-04', 1)).toBe('2026-04-05')
  })

  it('usa 1 = domingo ... 7 = sábado', () => {
    expect(weekdayNumber('2026-10-04')).toBe(1) // domingo
    expect(weekdayNumber('2026-10-05')).toBe(2) // lunes
    expect(weekdayNumber('2026-10-10')).toBe(7) // sábado
  })

  it('cuenta días laborables incluyendo ambos extremos', () => {
    expect(countWorkingDays('2026-10-05', '2026-10-16', WEEKDAYS)).toBe(10)
    expect(countWorkingDays('2026-10-05', '2026-10-16', ALL)).toBe(12)
    expect(countWorkingDays('2026-10-05', '2026-10-05', WEEKDAYS)).toBe(1)
    expect(countWorkingDays('2026-10-10', '2026-10-11', WEEKDAYS)).toBe(0)
    expect(taskDuration('2026-10-10', '2026-10-11', WEEKDAYS)).toBe(1)
  })

  it('calcula el lunes de la semana', () => {
    expect(startOfWeek('2026-10-07')).toBe('2026-10-05')
    expect(startOfWeek('2026-10-04')).toBe('2026-09-28')
  })

  it('convierte números de serie de Excel en ambos sentidos', () => {
    expect(dateKeyToExcelSerial('2026-12-01')).toBe(46357)
    expect(excelSerialToDateKey(46357)).toBe('2026-12-01')
  })
})

describe('column status', () => {
  it('infiere estados de nombres habituales', () => {
    expect(inferColumnStatus('Completado')).toBe('done')
    expect(inferColumnStatus('Terminado')).toBe('done')
    expect(inferColumnStatus('En progreso')).toBe('in_progress')
    expect(inferColumnStatus('En proceso')).toBe('in_progress')
    expect(inferColumnStatus('Por hacer')).toBe('todo')
  })

  it('prioriza el estado guardado sobre el nombre', () => {
    expect(resolveColumnStatus({ name: 'Completado', status: 'todo' })).toBe('todo')
    expect(resolveColumnStatus({ name: 'QA', status: null })).toBe('todo')
  })
})

describe('numbering', () => {
  it('numera por columna y luego por posición', () => {
    const numbers = activityNumbers([{ id: 'c1' }, { id: 'c2' }], {
      c2: [{ id: 'b' }],
      c1: [{ id: 'a1' }, { id: 'a2' }],
    })
    expect([...numbers.entries()]).toEqual([['a1', 1], ['a2', 2], ['b', 3]])
  })
})

describe('dependencies', () => {
  it('detecta ciclos directos e indirectos', () => {
    const tasks = [
      { id: 'a', predecessor_ids: [] },
      { id: 'b', predecessor_ids: ['a'] },
      { id: 'c', predecessor_ids: ['b'] },
    ]
    expect(createsDependencyCycle(tasks, 'a', ['c'])).toBe(true)
    expect(createsDependencyCycle(tasks, 'c', ['a'])).toBe(false)
    expect(findCycle(new Map([['x', ['x']]]))).toEqual(['x'])
  })
})

describe('relationsFor', () => {
  const tasks = [
    { id: '4', predecessor_ids: [] },
    { id: '5', predecessor_ids: ['4'] },
    { id: '6', predecessor_ids: ['5'] },
    { id: '7', predecessor_ids: ['5'] },
    { id: '8', predecessor_ids: ['6', '7'] },
  ]

  it('distingue predecesoras, sucesoras y el resto', () => {
    expect(Object.fromEntries(relationsFor(tasks, '5'))).toEqual({
      '4': 'predecessor',
      '5': 'selected',
      '6': 'successor',
      '7': 'successor',
      '8': 'dimmed',
    })
  })

  it('sin selección no resalta nada', () => {
    expect(relationsFor(tasks, null).size).toBe(0)
    expect(relationsFor(tasks, 'inexistente').size).toBe(0)
  })
})

describe('schedule', () => {
  const task = (id: string, start: string, end: string, predecessors: string[] = []) => ({
    id,
    start_date: start,
    end_date: end,
    predecessor_ids: predecessors,
  })

  it('marca como crítica solo la cadena que determina el fin', () => {
    const schedule = computeSchedule(
      [
        task('a', '2026-10-05', '2026-10-09'),
        task('b', '2026-10-12', '2026-10-13', ['a']),
        task('c', '2026-10-05', '2026-10-30'),
      ],
      WEEKDAYS,
    )
    expect(schedule.tasks.get('c')?.critical).toBe(true)
    // a termina justo antes de b, pero la cadena a→b tiene holgura frente a c.
    expect(schedule.tasks.get('a')?.critical).toBe(false)
    expect(schedule.tasks.get('b')?.critical).toBe(false)
    expect(schedule.tasks.get('b')?.totalFloat).toBe(13)
  })

  it('reconoce la ruta crítica de la plantilla NexuStock', () => {
    const schedule = computeSchedule(
      [
        task('1', '2026-10-05', '2026-10-16'),
        task('2', '2026-10-05', '2026-10-16'),
        task('3', '2026-10-19', '2026-10-30'),
        task('4', '2026-10-19', '2026-10-30'),
        task('5', '2026-11-02', '2026-11-13', ['4']),
        task('6', '2026-11-02', '2026-11-13', ['5']),
        task('7', '2026-11-16', '2026-11-27', ['5']),
        task('8', '2026-11-16', '2026-11-27', ['6', '7']),
        task('9', '2026-11-30', '2026-12-11', ['8']),
      ],
      WEEKDAYS,
    )
    const critical = [...schedule.tasks].filter(([, info]) => info.critical).map(([id]) => id)
    // 6 empieza en paralelo con 5 aunque depende de 5, y 8 empieza antes de que termine 7.
    expect(schedule.tasks.get('6')?.startsBeforePredecessor).toBe(true)
    expect(schedule.tasks.get('8')?.startsBeforePredecessor).toBe(true)
    // 9 respeta las fechas guardadas de 8: no hereda el aviso por arrastre.
    expect(schedule.tasks.get('9')?.startsBeforePredecessor).toBe(false)
    expect(critical).toEqual(expect.arrayContaining(['4', '5', '7', '8', '9']))
    expect(schedule.tasks.get('1')?.critical).toBe(false)
    expect(schedule.tasks.get('1')?.duration).toBe(10)
  })

  it('aísla ciclos sin romper el cálculo', () => {
    const schedule = computeSchedule(
      [
        task('a', '2026-10-05', '2026-10-06', ['b']),
        task('b', '2026-10-07', '2026-10-08', ['a']),
        task('c', '2026-10-05', '2026-10-09'),
      ],
      WEEKDAYS,
    )
    expect([...schedule.cyclicTaskIds].sort()).toEqual(['a', 'b'])
    expect(schedule.tasks.get('c')?.critical).toBe(true)
  })
})

describe('description', () => {
  const story = [
    '▌HISTORIA DE USUARIO',
    'Como Administrador TI,',
    'quiero configurar una arquitectura de monorepo,',
    '──────────────────────────────',
    '▌SPRINT',
    'Sprint 1',
    '──────────────────────────────',
    '▌CRITERIOS DE ACEPTACIÓN',
    '1. Estructura del repositorio.',
    '2. Endpoints iniciales.',
    '▌DEFINITION OF DONE (TÉCNICO)',
    '• Middleware CORS restringido.',
  ].join('\n')

  it('separa secciones, pasos y viñetas', () => {
    const sections = parseDescription(story)
    expect(sections.map((section) => section.title)).toEqual([
      'HISTORIA DE USUARIO',
      'SPRINT',
      'CRITERIOS DE ACEPTACIÓN',
      'DEFINITION OF DONE (TÉCNICO)',
    ])
    expect(sections[2].blocks).toEqual([
      { type: 'numbered', number: '1', text: 'Estructura del repositorio.' },
      { type: 'numbered', number: '2', text: 'Endpoints iniciales.' },
    ])
    expect(sections[3].blocks[0]).toEqual({ type: 'bullet', text: 'Middleware CORS restringido.' })
  })

  it('genera un resumen y extrae campos cortos', () => {
    expect(descriptionSummary(story)).toBe(
      'Como Administrador TI, quiero configurar una arquitectura de monorepo,',
    )
    expect(descriptionField(story, 'Sprint')).toBe('Sprint 1')
  })

  it('divide en secciones y recompone sin pérdida', () => {
    const sections = splitDescriptionSections(story)
    expect(sections[0]).toEqual({
      title: 'HISTORIA DE USUARIO',
      body: 'Como Administrador TI,\nquiero configurar una arquitectura de monorepo,',
    })
    const recomposed = composeDescription('', sections.map((section) => [section.title!, section.body]))
    expect(splitDescriptionSections(recomposed)).toEqual(sections)
  })

  it('deja el texto plano como párrafos', () => {
    expect(parseDescription('Texto simple')).toEqual([
      { title: null, blocks: [{ type: 'paragraph', text: 'Texto simple' }] },
    ])
  })
})

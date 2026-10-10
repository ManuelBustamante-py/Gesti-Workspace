import { describe, expect, it } from 'vitest'

import { initialModel } from './examples'
import { directedArrow, generatePlantUml } from './generatePlantUml'
import { containerMap, edgeRoute, nodeSize } from './geometry'
import { KIND_SPECS } from './kinds'
import { nextId, type GraphModel, type SequenceModel } from './visualModel'

const auto = (model: GraphModel): GraphModel => ({ ...model, layout: 'auto' })

describe('generatePlantUml · casos de uso', () => {
  it('agrupa en el límite del sistema lo que está dentro y genera include', () => {
    const source = generatePlantUml(auto(initialModel('usecase', true) as GraphModel))
    expect(source).toBe([
      '@startuml',
      'left to right direction',
      'rectangle "Tienda en línea" as n3 {',
      '  usecase "Buscar producto" as n4',
      '  usecase "Comprar" as n5',
      '  usecase "Pagar" as n6',
      '  usecase "Gestionar catálogo" as n7',
      '}',
      'actor "Cliente" as n1',
      'actor "Administrador" as n2',
      'n1 -- n4',
      'n1 -- n5',
      'n5 ..> n6 : <<include>>',
      'n2 -- n7',
      '@enduml',
    ].join('\n'))
  })

  it('con «aproximar el lienzo» cada relación lleva la dirección según las posiciones', () => {
    const source = generatePlantUml(initialModel('usecase', true))
    expect(source).not.toContain('left to right direction')
    expect(source).toContain('n1 -right- n4')
    expect(source).toContain('n5 .right.> n6 : <<include>>')
  })

  it('escapa comillas y saltos de línea en los nombres', () => {
    const model: GraphModel = {
      kind: 'usecase', version: 1, direction: 'top-to-bottom', layout: 'auto',
      nodes: [{ id: 'n1', type: 'usecase', name: 'Pagar "rápido"\ncon tarjeta', x: 0, y: 0 }],
      edges: [],
    }
    expect(generatePlantUml(model)).toContain(`usecase "Pagar 'rápido'\\ncon tarjeta" as n1`)
  })
})

describe('generatePlantUml · clases', () => {
  it('genera clases con miembros, enum y relaciones con multiplicidades', () => {
    const source = generatePlantUml(auto(initialModel('class', true) as GraphModel))
    expect(source).toContain('class "Usuario" as n1 {\n  - id: UUID\n  - email: String\n  --\n  + iniciarSesion(clave: String): boolean\n}')
    expect(source).toContain('enum "Prioridad" as n4 {\n  ALTA\n  MEDIA\n  BAJA\n}')
    expect(source).toContain('n1 "1" -- "*" n2 : posee')
    expect(source).toContain('n2 "1" *-- "*" n3')
    expect(source).toContain('n3 --> n4')
  })

  it('anida paquetes y protege llaves sueltas', () => {
    const model: GraphModel = {
      kind: 'class', version: 1, direction: 'top-to-bottom', layout: 'auto',
      nodes: [
        { id: 'n1', type: 'package', name: 'app', x: 0, y: 0, width: 600, height: 400 },
        { id: 'n2', type: 'package', name: 'dominio', x: 40, y: 40, width: 300, height: 200 },
        { id: 'n3', type: 'interface', name: 'Repo', x: 60, y: 80, methods: ['}'], stereotype: 'puerto' },
      ],
      edges: [{ id: 'e1', type: 'realization', source: 'n9', target: 'n3' }],
    }
    expect(generatePlantUml(model)).toBe([
      '@startuml', 'hide empty members',
      'package "app" as n1 {', '  package "dominio" as n2 {', '    interface "Repo" as n3 <<puerto>> {', '      --', '      "}"', '    }', '  }', '}',
      '@enduml',
    ].join('\n'))
  })
})

describe('generatePlantUml · otros tipos', () => {
  it('estados: [*] dentro de su compuesto y pseudoestados', () => {
    const model: GraphModel = {
      kind: 'state', version: 1, direction: 'top-to-bottom', layout: 'auto',
      nodes: [
        { id: 'n1', type: 'composite', name: 'Activo', x: 0, y: 0, width: 400, height: 300 },
        { id: 'n2', type: 'initial', name: 'Inicio', x: 30, y: 50 },
        { id: 'n3', type: 'state', name: 'Editando', x: 30, y: 120 },
        { id: 'n4', type: 'choice', name: '¿Válido?', x: 500, y: 100 },
        { id: 'n5', type: 'final', name: 'Fin', x: 500, y: 300 },
      ],
      edges: [
        { id: 'e1', type: 'flow', source: 'n2', target: 'n3' },
        { id: 'e2', type: 'flow', source: 'n3', target: 'n4', label: 'guardar' },
        { id: 'e3', type: 'flow', source: 'n4', target: 'n5', label: 'sí' },
      ],
    }
    expect(generatePlantUml(model)).toBe([
      '@startuml',
      'state "Activo" as n1 {', '  state "Editando" as n3', '  [*] --> n3', '}',
      'state "¿Válido?" as n4 <<choice>>',
      'n3 --> n4 : guardar', 'n4 --> [*] : sí',
      '@enduml',
    ].join('\n'))
  })

  it('entidad-relación: cardinalidades como patas de gallo', () => {
    const model: GraphModel = {
      kind: 'er', version: 1, direction: 'top-to-bottom', layout: 'auto',
      nodes: [{ id: 'n1', type: 'entity', name: 'usuario', x: 0, y: 0 }, { id: 'n2', type: 'entity', name: 'tablero', x: 0, y: 200 }],
      edges: [{ id: 'e1', type: 'er', source: 'n1', target: 'n2', sourceLabel: '1', targetLabel: '0..*', label: 'posee' }],
    }
    expect(generatePlantUml(model)).toContain('n1 ||--o{ n2 : posee')
  })

  it('requisitos y C4 usan su estereotipo fijo', () => {
    expect(generatePlantUml(initialModel('requirement', true))).toMatch(/class "REQ-01 Autenticación" as n\d+ <<requirement>>/)
    expect(generatePlantUml(initialModel('c4', true))).toMatch(/rectangle ".*" as n\d+ <<Contenedor>>/)
  })

  it('inserta la dirección en cualquier flecha', () => {
    expect(directedArrow('--|>', 'up')).toBe('-up-|>')
    expect(directedArrow('..>', 'left')).toBe('.left.>')
    expect(directedArrow('||--o{', 'down')).toBe('||-down-o{')
    expect(directedArrow('*--', 'right')).toBe('*-right-')
  })

  it('todos los tipos del registro generan un diagrama a partir de su ejemplo', () => {
    for (const spec of KIND_SPECS) {
      const source = generatePlantUml(initialModel(spec.kind, true))
      expect(source.startsWith('@startuml'), spec.kind).toBe(true)
      expect((initialModel(spec.kind, true) as GraphModel).nodes.length, spec.kind).toBeGreaterThan(0)
    }
  })
})

describe('generatePlantUml · secuencia', () => {
  it('declara participantes en orden, mensajes según su tipo y filas libres en su lugar', () => {
    const model: SequenceModel = {
      kind: 'sequence', version: 1, autonumber: true,
      participants: [{ id: 'p1', type: 'actor', name: 'Usuario' }, { id: 'p2', type: 'database', name: 'BD' }],
      messages: [
        { id: 'm0', from: '', to: '', label: '', type: 'sync', raw: 'alt hay datos' },
        { id: 'm1', from: 'p1', to: 'p2', label: 'consulta', type: 'sync' },
        { id: 'm2', from: 'p2', to: 'p1', label: 'filas', type: 'reply' },
        { id: 'm5', from: '', to: '', label: '', type: 'sync', raw: 'end' },
        { id: 'm3', from: 'p1', to: 'p1', label: '', type: 'async' },
        { id: 'm4', from: 'p1', to: 'p9', label: 'huérfano', type: 'sync' },
      ],
    }
    expect(generatePlantUml(model)).toBe([
      '@startuml', 'autonumber', 'actor "Usuario" as p1', 'database "BD" as p2',
      'alt hay datos', 'p1 -> p2 : consulta', 'p2 --> p1 : filas', 'end', 'p1 ->> p1', '@enduml',
    ].join('\n'))
  })
})

describe('geometría', () => {
  it('agrupa por el contenedor más pequeño que encierra el centro', () => {
    const model = initialModel('usecase', true) as GraphModel
    const parents = containerMap(model.kind, model.nodes)
    expect(parents.get('n1')).toBeNull()
    expect(parents.get('n5')).toBe('n3')
    expect(parents.get('n3')).toBeNull()
  })

  it('las relaciones pasan por sus codos y se recortan en los bordes', () => {
    const a = { id: 'a', type: 'class', name: 'A', x: 0, y: 0 }
    const b = { id: 'b', type: 'class', name: 'B', x: 400, y: 0 }
    const straight = edgeRoute('class', { id: 'e', type: 'association', source: 'a', target: 'b' }, a, b)
    expect(straight).toHaveLength(2)
    expect(straight[0].x).toBeCloseTo(nodeSize('class', a).width)
    const bent = edgeRoute('class', { id: 'e', type: 'association', source: 'a', target: 'b', points: [{ x: 200, y: 300 }] }, a, b)
    expect(bent).toHaveLength(3)
    expect(bent[1]).toEqual({ x: 200, y: 300 })
  })

  it('genera ids únicos por prefijo', () => {
    expect(nextId('n', ['n1', 'n7', 'e3'])).toBe('n8')
    expect(nextId('e', [])).toBe('e1')
  })
})

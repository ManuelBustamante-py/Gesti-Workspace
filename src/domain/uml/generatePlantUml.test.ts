import { describe, expect, it } from 'vitest'

import { generatePlantUml } from './generatePlantUml'
import { containerMap, edgeLine, nodeSize } from './geometry'
import { initialModel, nextId, type GraphModel, type SequenceModel } from './visualModel'

describe('generatePlantUml · casos de uso', () => {
  it('agrupa en el límite del sistema lo que está dentro y genera include', () => {
    const source = generatePlantUml(initialModel('usecase', true))
    expect(source).toBe([
      '@startuml',
      'left to right direction',
      'actor "Cliente" as n1',
      'actor "Administrador" as n2',
      'rectangle "Tienda en línea" as n3 {',
      '  usecase "Buscar producto" as n4',
      '  usecase "Comprar" as n5',
      '  usecase "Pagar" as n6',
      '  usecase "Gestionar catálogo" as n7',
      '}',
      'n1 -- n4',
      'n1 -- n5',
      'n5 ..> n6 : <<include>>',
      'n2 -- n7',
      '@enduml',
    ].join('\n'))
  })

  it('escapa comillas y saltos de línea en los nombres', () => {
    const model: GraphModel = {
      kind: 'usecase', version: 1, direction: 'top-to-bottom',
      nodes: [{ id: 'n1', type: 'usecase', name: 'Pagar "rápido"\ncon tarjeta', x: 0, y: 0 }],
      edges: [],
    }
    expect(generatePlantUml(model)).toContain(`usecase "Pagar 'rápido'\\ncon tarjeta" as n1`)
  })
})

describe('generatePlantUml · clases', () => {
  it('genera clases con miembros, enum y relaciones con multiplicidades', () => {
    const source = generatePlantUml(initialModel('class', true))
    expect(source).toContain('class "Usuario" as n1 {\n  - id: UUID\n  - email: String\n  --\n  + iniciarSesion(clave: String): boolean\n}')
    expect(source).toContain('enum "Prioridad" as n4 {\n  ALTA\n  MEDIA\n  BAJA\n}')
    expect(source).toContain('n1 "1" -- "*" n2 : posee')
    expect(source).toContain('n2 "1" *-- "*" n3')
    expect(source).toContain('n3 --> n4')
  })

  it('anida paquetes dentro de paquetes y protege llaves sueltas', () => {
    const model: GraphModel = {
      kind: 'class', version: 1, direction: 'top-to-bottom',
      nodes: [
        { id: 'n1', type: 'package', name: 'app', x: 0, y: 0, width: 600, height: 400 },
        { id: 'n2', type: 'package', name: 'dominio', x: 40, y: 40, width: 300, height: 200 },
        { id: 'n3', type: 'interface', name: 'Repo', x: 60, y: 80, methods: ['}'], stereotype: 'puerto' },
      ],
      edges: [{ id: 'e1', type: 'realization', source: 'n9', target: 'n3' }],
    }
    expect(generatePlantUml(model)).toBe([
      '@startuml',
      'hide empty members',
      'package "app" as n1 {',
      '  package "dominio" as n2 {',
      '    interface "Repo" as n3 <<puerto>> {',
      '      --',
      '      "}"',
      '    }',
      '  }',
      '}',
      '@enduml',
    ].join('\n'))
  })
})

describe('generatePlantUml · secuencia', () => {
  it('declara participantes en orden y mensajes según su tipo', () => {
    const model: SequenceModel = {
      kind: 'sequence', version: 1, autonumber: true,
      participants: [{ id: 'p1', type: 'actor', name: 'Usuario' }, { id: 'p2', type: 'database', name: 'BD' }],
      messages: [
        { id: 'm1', from: 'p1', to: 'p2', label: 'consulta', type: 'sync' },
        { id: 'm2', from: 'p2', to: 'p1', label: 'filas', type: 'reply' },
        { id: 'm3', from: 'p1', to: 'p1', label: '', type: 'async' },
        { id: 'm4', from: 'p1', to: 'p9', label: 'huérfano', type: 'sync' },
      ],
    }
    expect(generatePlantUml(model)).toBe([
      '@startuml', 'autonumber', 'actor "Usuario" as p1', 'database "BD" as p2',
      'p1 -> p2 : consulta', 'p2 --> p1 : filas', 'p1 ->> p1', '@enduml',
    ].join('\n'))
  })
})

describe('geometría', () => {
  it('agrupa por el contenedor más pequeño que encierra el centro', () => {
    const model = initialModel('usecase', true) as GraphModel
    const parents = containerMap(model.nodes)
    expect(parents.get('n1')).toBeNull()
    expect(parents.get('n5')).toBe('n3')
    expect(parents.get('n3')).toBeNull()
  })

  it('recorta las líneas en el borde de cada elemento', () => {
    const a = { id: 'a', type: 'class' as const, name: 'A', x: 0, y: 0 }
    const b = { id: 'b', type: 'class' as const, name: 'B', x: 400, y: 0 }
    const { start, end } = edgeLine(a, b)
    expect(start.x).toBeCloseTo(nodeSize(a).width)
    expect(end.x).toBeCloseTo(400)
  })

  it('genera ids únicos por prefijo', () => {
    expect(nextId('n', ['n1', 'n7', 'e3'])).toBe('n8')
    expect(nextId('e', [])).toBe('e1')
  })
})

import { describe, expect, it } from 'vitest'

import { UML_DIAGRAM_TYPES } from '../umlCatalog'
import { initialModel } from './examples'
import { generatePlantUml } from './generatePlantUml'
import { containerMap } from './geometry'
import { interpretModel } from './interpret'
import { isGraphKind } from './kinds'
import { parsePlantUml } from './parsePlantUml'
import type { GraphModel, SequenceModel } from './visualModel'

const graph = (source: string, kind: string, previous: GraphModel | null = null) => parsePlantUml(source, kind, previous).model as GraphModel
const names = (model: GraphModel) => model.nodes.map((node) => `${node.type}:${node.name}`)

describe('parsePlantUml · clases', () => {
  it('lee declaraciones, miembros, relaciones con multiplicidad y relaciones invertidas', () => {
    const model = graph([
      '@startuml',
      'class Usuario {',
      '  - id: UUID',
      '  + login(clave: String): boolean',
      '}',
      'interface "Repositorio de datos" as Repo',
      'abstract class Base',
      'Usuario "1" -- "*" Tablero : posee >',
      'Base <|-- Usuario',
      'Repo <|.. RepoSql',
      'Tablero *-- Tarea',
      '@enduml',
    ].join('\n'), 'class')
    expect(names(model)).toEqual(['class:Usuario', 'interface:Repositorio de datos', 'abstract:Base', 'class:Tablero', 'class:RepoSql', 'class:Tarea'])
    const usuario = model.nodes[0]
    expect(usuario.attributes).toEqual(['- id: UUID'])
    expect(usuario.methods).toEqual(['+ login(clave: String): boolean'])
    const byName = (name: string) => model.nodes.find((node) => node.name === name)!.id
    expect(model.edges.map((edge) => [edge.type, edge.source, edge.target, edge.sourceLabel ?? '', edge.targetLabel ?? '', edge.label ?? ''])).toEqual([
      ['association', byName('Usuario'), byName('Tablero'), '1', '*', 'posee >'],
      ['generalization', byName('Usuario'), byName('Base'), '', '', ''],
      ['realization', byName('RepoSql'), byName('Repositorio de datos'), '', '', ''],
      ['composition', byName('Tablero'), byName('Tarea'), '', '', ''],
    ])
  })

  it('reconoce las formas cortas [Componente], (Caso de uso), :Actor: y () Interfaz', () => {
    const component = graph(['@startuml', '[Aplicación web] as web', '() "HTTPS" as https', 'web --> https', '@enduml'].join('\n'), 'component')
    expect(names(component)).toEqual(['component:Aplicación web', 'interface:HTTPS'])
    expect(component.edges).toHaveLength(1)
    const usecase = graph(['@startuml', ':Cliente: as c', '(Comprar) as UC1', 'c --> UC1', '@enduml'].join('\n'), 'usecase')
    expect(names(usecase)).toEqual(['actor:Cliente', 'usecase:Comprar'])
  })

  it('ignora las pistas de dirección y conserva lo que no entiende', () => {
    const result = parsePlantUml('@startuml\nskinparam classAttributeIconSize 0\nA -right-> B\nB .up.|> C\n@enduml', 'class')
    const model = result.model as GraphModel
    expect(model.edges.map((edge) => edge.type)).toEqual(['directed', 'realization'])
    expect(result.kept).toEqual(['skinparam classAttributeIconSize 0'])
    expect(model.extra).toEqual(['skinparam classAttributeIconSize 0'])
  })
})

describe('parsePlantUml · ida y vuelta', () => {
  it('lo generado desde el lienzo se vuelve a leer igual (mismos elementos, relaciones e ids)', () => {
    for (const kind of ['usecase', 'class', 'state', 'component', 'er', 'c4', 'requirement', 'archimate', 'dfd', 'deployment']) {
      const original = initialModel(kind, true) as GraphModel
      const again = graph(generatePlantUml(original), kind, original)
      // El orden puede cambiar (lo de cada contenedor se declara dentro de él): se compara ordenado.
      const sorted = (model: GraphModel) => model.nodes.map((node) => [node.id, node.type, node.name].join('|')).sort()
      expect(sorted(again), kind).toEqual(sorted(original))
      const edges = (model: GraphModel) => model.edges.map((edge) => [edge.type, edge.source, edge.target, edge.label ?? ''].join('|')).sort()
      expect(edges(again), kind).toEqual(edges(original))
    }
  })

  it('conserva posiciones y codos de lo que ya estaba en el lienzo y ubica lo nuevo a un lado', () => {
    const original = initialModel('class', true) as GraphModel
    original.edges[0].points = [{ x: 300, y: 10 }]
    const source = generatePlantUml(original).replace('@enduml', 'class Nueva\nn1 --> Nueva\n@enduml')
    const again = graph(source, 'class', original)
    expect(again.nodes.slice(0, 4).map((node) => [node.x, node.y])).toEqual(original.nodes.map((node) => [node.x, node.y]))
    expect(again.edges[0].points).toEqual([{ x: 300, y: 10 }])
    const nueva = again.nodes.find((node) => node.name === 'Nueva')!
    expect(nueva.x).toBeGreaterThan(Math.max(...original.nodes.map((node) => node.x)))
  })

  it('todas las plantillas de los tipos con lienzo se pueden pasar al lienzo y volver a generar', () => {
    for (const type of UML_DIAGRAM_TYPES.filter((item) => isGraphKind(item.id))) {
      const model = graph(type.template, type.id)
      expect(model.nodes.length, type.id).toBeGreaterThan(0)
      expect(model.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)), type.id).toBe(true)
      expect(generatePlantUml(model).startsWith('@startuml'), type.id).toBe(true)
    }
  })
})

describe('parsePlantUml · actividades', () => {
  it('convierte la sintaxis estructurada en un grafo con decisiones y bifurcaciones', () => {
    const model = graph([
      '@startuml', 'start', ':Recibir pedido;', 'if (¿Hay stock?) then (sí)', '  fork', '    :Cobrar;', '  fork again', '    :Preparar;', '  end fork',
      'else (no)', '  :Notificar;', 'endif', 'stop', '@enduml',
    ].join('\n'), 'activity')
    expect(model.nodes.map((node) => node.type)).toEqual(['initial', 'action', 'choice', 'fork', 'action', 'action', 'join', 'action', 'final'])
    const choice = model.nodes.find((node) => node.type === 'choice')!
    expect(model.edges.filter((edge) => edge.source === choice.id).map((edge) => edge.label)).toEqual(['sí', 'no'])
    const final = model.nodes.find((node) => node.type === 'final')!
    expect(model.edges.filter((edge) => edge.target === final.id)).toHaveLength(2)
  })

  it('los carriles de la plantilla BPMN quedan uno al lado del otro, no anidados', () => {
    const template = UML_DIAGRAM_TYPES.find((type) => type.id === 'bpmn')!.template
    const model = graph(template, 'bpmn')
    const parents = containerMap('bpmn', model.nodes)
    const lanes = model.nodes.filter((node) => node.type === 'lane')
    expect(lanes.map((lane) => lane.name).sort()).toEqual(['Bodega', 'Cliente', 'Ventas'])
    expect(lanes.every((lane) => parents.get(lane.id) === null)).toBe(true)
    // Cada tarea queda dentro de su carril.
    const lane = (name: string) => lanes.find((item) => item.name === name)!.id
    const task = (name: string) => model.nodes.find((node) => node.name === name)!.id
    expect(parents.get(task('Preparar productos'))).toBe(lane('Bodega'))
    expect(parents.get(task('Validar pedido'))).toBe(lane('Ventas'))
  })

  it('los carriles (swimlanes) se convierten en contenedores en BPMN', () => {
    const model = graph('@startuml\n|Cliente|\nstart\n:Pedir;\n|Ventas|\n:Validar;\nstop\n@enduml', 'bpmn')
    expect(model.nodes.filter((node) => node.type === 'lane').map((node) => node.name)).toEqual(['Cliente', 'Ventas'])
  })
})

describe('parsePlantUml · secuencia', () => {
  it('lee participantes, mensajes y conserva fragmentos en su posición', () => {
    const model = parsePlantUml([
      '@startuml', 'actor Usuario', 'participant "API" as api', 'Usuario -> api : login', 'alt ok', 'api --> Usuario : token', 'else error', 'api --> Usuario : 401', 'end', 'api ->> api : log', '@enduml',
    ].join('\n'), 'sequence').model as SequenceModel
    expect(model.participants.map((participant) => [participant.type, participant.name])).toEqual([['actor', 'Usuario'], ['participant', 'API']])
    expect(model.messages.map((message) => message.raw ?? `${message.type}:${message.label}`)).toEqual([
      'sync:login', 'alt ok', 'reply:token', 'else error', 'reply:401', 'end', 'async:log',
    ])
    expect(generatePlantUml(model)).toContain('alt ok\np2 --> p1 : token\nelse error')
  })
})

describe('interpretación', () => {
  it('casos de uso: narra lo que hace cada actor y detecta casos sin actor', () => {
    const model = initialModel('usecase', true) as GraphModel
    const result = interpretModel(model)
    expect(result.summary).toContain('«Cliente» puede «Buscar producto» y «Comprar».')
    expect(result.summary.some((line) => line.includes('Siempre que se realiza «Comprar», también se realiza «Pagar»'))).toBe(true)
    const orphan = interpretModel({ ...model, nodes: [...model.nodes, { id: 'n9', type: 'usecase', name: 'Exportar', x: 300, y: 380 }] })
    expect(orphan.findings.some((finding) => finding.level === 'warning' && finding.text.includes('«Exportar»'))).toBe(true)
  })

  it('clases: detecta interfaces sin implementar y herencia circular', () => {
    const model = graph('@startuml\ninterface Repo\nclass A\nclass B\nA --|> B\nB --|> A\n@enduml', 'class')
    const texts = interpretModel(model).findings.map((finding) => finding.text)
    expect(texts.some((text) => text.includes('Nadie implementa la interfaz «Repo»'))).toBe(true)
    expect(texts.some((text) => text.startsWith('Herencia circular'))).toBe(true)
  })

  it('flujos: decisiones con una sola salida y pasos inalcanzables', () => {
    const model = graph('@startuml\n[*] --> A\nA --> C\nstate C <<choice>>\nC --> B : sí\nstate Huerfano\n@enduml', 'state')
    const texts = interpretModel(model).findings.map((finding) => finding.text)
    expect(texts.some((text) => text.includes('una sola salida'))).toBe(true)
    expect(texts.some((text) => text.includes('«Huerfano»'))).toBe(true)
  })

  it('secuencia: respuestas sin pedido y fragmentos sin cerrar', () => {
    const model = parsePlantUml('@startuml\nA -> B : hola\nalt x\nC --> A : ¿?\n@enduml', 'sequence').model
    const texts = interpretModel(model).findings.map((finding) => finding.text)
    expect(texts.some((text) => text.includes('sin que se le haya pedido'))).toBe(true)
    expect(texts.some((text) => text.includes('cada fragmento debe cerrarse'))).toBe(true)
  })

  it('entidad-relación y DFD: claves primarias y procesos «milagro»', () => {
    const er = graph('@startuml\nentity usuario {\n  nombre : text\n}\n@enduml', 'er')
    expect(interpretModel(er).findings.some((finding) => finding.text.includes('no tiene clave primaria'))).toBe(true)
    const dfd = graph('@startuml\nusecase "1.0 Calcular" as p1\nrectangle Cliente\np1 --> Cliente : total\n@enduml', 'dfd')
    expect(interpretModel(dfd).findings.some((finding) => finding.text.includes('«milagro»'))).toBe(true)
  })
})

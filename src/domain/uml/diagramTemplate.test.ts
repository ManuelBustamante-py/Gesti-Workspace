import { describe, expect, it } from 'vitest'

import { defaultSettings } from './coherence'
import {
  buildDiagramTemplate,
  exampleTemplate,
  guessDiagramKind,
  parseDiagramFile,
  sanitizeVisualModel,
  serializeTemplate,
  TEMPLATE_FORMAT,
  templateFileName,
  uniqueDiagramName,
} from './diagramTemplate'
import { initialModel } from './examples'
import { generatePlantUml } from './generatePlantUml'
import type { GraphModel } from './visualModel'
import { UML_DIAGRAM_TYPES, umlDiagramType } from '../umlCatalog'

const classTemplate = umlDiagramType('class')!.template
const now = new Date('2026-10-16T12:00:00Z')

describe('plantilla de diagramas', () => {
  it('lo exportado se vuelve a importar igual (código, visual y configuración)', () => {
    const visual = initialModel('class', true)
    const settings = { ...defaultSettings(), style: 'mvc' as const, logicalComponents: ['Inventario'] }
    const template = buildDiagramTemplate({
      project: { name: 'NexuStock', description: 'Inventario' },
      diagrams: [
        { name: 'Clases (código)', kind: 'class', mode: 'code', source: classTemplate, model: null },
        { name: 'Clases (visual)', kind: 'class', mode: 'visual', source: generatePlantUml(visual), model: visual },
      ],
      settings,
      now,
    })
    expect(template.format).toBe(TEMPLATE_FORMAT)
    expect(template.generatedAt).toBe('2026-10-16T12:00:00.000Z')

    const parsed = parseDiagramFile('nexustock.diagramas.json', serializeTemplate(template))
    expect(parsed.warnings).toEqual([])
    expect(parsed.projectName).toBe('NexuStock')
    expect(parsed.settings).toEqual(settings)
    expect(parsed.diagrams).toEqual([
      { name: 'Clases (código)', kind: 'class', mode: 'code', source: classTemplate, guessedKind: false },
      { name: 'Clases (visual)', kind: 'class', mode: 'visual', source: generatePlantUml(visual), model: visual, guessedKind: false },
    ])
  })

  it('un diagrama visual sin modelo se exporta como código', () => {
    const template = buildDiagramTemplate({
      project: { name: 'P' },
      diagrams: [{ name: 'A', kind: 'class', mode: 'visual', source: classTemplate, model: null }],
    })
    expect(template.diagrams[0]).toEqual({ name: 'A', kind: 'class', mode: 'code', source: classTemplate })
    expect(template).not.toHaveProperty('architectureSettings')
  })

  it('omite o ajusta los diagramas inválidos y lo explica', () => {
    const text = JSON.stringify({
      format: TEMPLATE_FORMAT,
      version: 1,
      diagrams: [
        { name: 'Desconocido', kind: 'inventado', mode: 'code', source: '@startuml\n@enduml' },
        { name: 'Sin código', kind: 'class', mode: 'code', source: '   ' },
        { name: 'Modelo roto', kind: 'class', mode: 'visual', source: classTemplate, model: { kind: 'class', nodes: 'x' } },
        { name: '  Nombre   con  espacios ', kind: 'activity', mode: 'code', source: '@startuml\nstart\nstop\n@enduml' },
        'basura',
      ],
    })
    const parsed = parseDiagramFile('p.json', text)
    expect(parsed.diagrams.map((diagram) => [diagram.name, diagram.mode])).toEqual([
      ['Modelo roto', 'code'],
      ['Nombre con espacios', 'code'],
    ])
    expect(parsed.warnings).toHaveLength(4)
    expect(parsed.warnings[0]).toContain('inventado')
    expect(parsed.settings).toBeNull()
  })

  it('rechaza archivos que no son plantillas', () => {
    expect(() => parseDiagramFile('a.json', '{ roto')).toThrow(/dañado/)
    expect(() => parseDiagramFile('a.json', '{"hola": 1}')).toThrow(/no es una plantilla/)
    expect(() => parseDiagramFile('a.json', JSON.stringify({ format: 'otra-cosa', diagrams: [] }))).toThrow(/no es una plantilla/)
    expect(() => parseDiagramFile('a.json', JSON.stringify({ format: TEMPLATE_FORMAT, version: 99, diagrams: [] }))).toThrow(/versión más nueva/)
    expect(() => parseDiagramFile('a.puml', 'texto sin diagramas')).toThrow(/PlantUML/)
    expect(() => parseDiagramFile('a.puml', '  ')).toThrow(/vacío/)
  })

  it('la plantilla de ejemplo se importa completa', () => {
    const parsed = parseDiagramFile('ejemplo.json', serializeTemplate(exampleTemplate(now)))
    expect(parsed.warnings).toEqual([])
    expect(parsed.diagrams.map((diagram) => diagram.kind)).toEqual(['usecase', 'class', 'sequence', 'activity'])
  })
})

describe('archivos PlantUML', () => {
  it('separa varios diagramas y deduce su nombre y tipo', () => {
    const text = [
      '﻿@startuml',
      'title Login',
      'actor Usuario',
      'Usuario -> Sistema : credenciales',
      '@enduml',
      '',
      '@startuml',
      'class Producto {',
      '  +nombre: String',
      '}',
      '@enduml',
    ].join('\n')
    const parsed = parseDiagramFile('modelo.puml', text)
    expect(parsed.diagrams.map(({ name, kind, mode, guessedKind }) => ({ name, kind, mode, guessedKind }))).toEqual([
      { name: 'Login', kind: 'sequence', mode: 'code', guessedKind: true },
      { name: 'modelo 2', kind: 'class', mode: 'code', guessedKind: true },
    ])
    expect(parsed.diagrams[1].source).toBe('@startuml\nclass Producto {\n  +nombre: String\n}\n@enduml\n')
  })

  it('reconoce el tipo de cada plantilla del catálogo', () => {
    for (const type of UML_DIAGRAM_TYPES.filter((item) => item.support !== 'unavailable')) {
      expect([type.id, guessDiagramKind(type.template)]).toEqual([type.id, type.id])
    }
  })

  it('deduce el tipo por palabras clave cuando no hay título conocido', () => {
    expect(guessDiagramKind('@startuml\n[*] --> Activo\n@enduml')).toBe('state')
    expect(guessDiagramKind('@startuml\nstart\n:Revisar;\nstop\n@enduml')).toBe('activity')
    expect(guessDiagramKind('@startuml\nactor Cliente\nusecase Comprar\n@enduml')).toBe('usecase')
    expect(guessDiagramKind('@startuml\nnode Servidor\n@enduml')).toBe('deployment')
    expect(guessDiagramKind('@startmindmap\n* Idea\n@endmindmap')).toBe('mindmap')
  })
})

describe('sanitizeVisualModel', () => {
  it('descarta elementos mal formados y relaciones huérfanas', () => {
    const raw = {
      kind: 'class',
      version: 1,
      direction: 'left-to-right',
      nodes: [
        { id: 'a', type: 'class', name: 'A', x: 0, y: 0, attributes: ['x', 3] },
        { id: 'b', type: 'class', name: 'B', x: 'mal', y: 0 },
      ],
      edges: [
        { id: 'e1', type: 'association', source: 'a', target: 'b' },
        { id: 'e2', type: 'association', source: 'a', target: 'a', points: [{ x: 1, y: 2 }, { x: 'no' }] },
      ],
      inyectado: true,
    }
    const model = sanitizeVisualModel('class', raw) as GraphModel
    expect(model.nodes).toEqual([{ id: 'a', type: 'class', name: 'A', x: 0, y: 0, attributes: ['x'] }])
    expect(model.edges).toEqual([{ id: 'e2', type: 'association', source: 'a', target: 'a', points: [{ x: 1, y: 2 }] }])
    expect(model.direction).toBe('left-to-right')
    expect(model).not.toHaveProperty('inyectado')
  })

  it('rechaza modelos de otro tipo', () => {
    expect(sanitizeVisualModel('class', { kind: 'sequence', participants: [], messages: [] })).toBeNull()
    expect(sanitizeVisualModel('class', null)).toBeNull()
  })
})

describe('nombres', () => {
  it('no repite nombres existentes', () => {
    const taken = new Set(['clases', 'clases (2)'])
    expect(uniqueDiagramName('Clases', taken)).toBe('Clases (3)')
    expect(uniqueDiagramName('Secuencia', taken)).toBe('Secuencia')
    expect(uniqueDiagramName('secuencia', taken)).toBe('secuencia (2)')
  })

  it('genera el nombre del archivo de la plantilla', () => {
    expect(templateFileName('NexuStock - Kanban Cascada')).toBe('nexustock-kanban-cascada.diagramas.json')
    expect(templateFileName('¡¡!!')).toBe('tablero.diagramas.json')
  })
})

import { describe, expect, it } from 'vitest'

import { blankTemplate, UML_CATEGORIES, UML_DIAGRAM_TYPES, umlDiagramType } from './umlCatalog'

describe('umlCatalog', () => {
  it('cada tipo tiene id único, categoría válida y plantilla con directivas de inicio y fin', () => {
    const ids = UML_DIAGRAM_TYPES.map((type) => type.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const type of UML_DIAGRAM_TYPES) {
      expect(UML_CATEGORIES.some((category) => category.id === type.category)).toBe(true)
      if (type.support === 'unavailable') continue
      expect(type.template).toMatch(/^@start\w+/)
      expect(type.template).toMatch(/@end\w+$/)
      expect(type.id).toMatch(/^[a-z0-9-]{1,40}$/)
    }
  })

  it('los tipos adaptados o no disponibles explican por qué', () => {
    expect(UML_DIAGRAM_TYPES.filter((type) => type.support !== 'native' && !type.note)).toEqual([])
  })

  it('el diagrama en blanco conserva las directivas de su tipo', () => {
    expect(blankTemplate(umlDiagramType('gantt')!)).toBe('@startgantt\n\n@endgantt')
    expect(blankTemplate(umlDiagramType('class')!)).toBe('@startuml\n\n@enduml')
  })
})

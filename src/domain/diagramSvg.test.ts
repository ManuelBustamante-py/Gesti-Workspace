import { describe, expect, it } from 'vitest'

import { diagramError, diagramFileName, sanitizeSvg, svgSize } from './diagramSvg'

describe('diagramError', () => {
  it('detecta el error de sintaxis de PlantUML y su línea', () => {
    // Forma real del SVG de error de @plantuml/core (texto simplificado).
    const svg = '<svg><text>[From textarea (line 2) ]</text><text>@startuml</text><text>salt</text><text>Syntax Error? (Assumed diagram type: class)</text></svg>'
    expect(diagramError(svg)).toEqual({ line: 2, message: 'Error de sintaxis' })
  })

  it('detecta diagramas que el motor no soporta y deja pasar los válidos', () => {
    expect(diagramError('<svg><text>Diagram not supported by this release of PlantUML</text></svg>')?.message).toMatch('no soportado')
    expect(diagramError('<svg><text>@startuml</text><text>Empty description (Assumed diagram type: sequence)</text></svg>')?.message).toMatch('vacío')
    expect(diagramError('<svg><text>Usuario</text></svg>')).toBeNull()
  })
})

describe('svgSize', () => {
  it('lee width/height o, si faltan, el viewBox', () => {
    expect(svgSize('<svg xmlns="x" width="320px" height="200px" viewBox="0 0 320 200">')).toEqual({ width: 320, height: 200 })
    expect(svgSize('<svg viewBox="0 0 640 480">')).toEqual({ width: 640, height: 480 })
    expect(svgSize('<svg>')).toEqual({ width: 800, height: 600 })
  })
})

describe('sanitizeSvg', () => {
  it('quita scripts, manejadores de eventos y enlaces javascript:', () => {
    const svg = '<svg onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><text onclick=\'x()\'>A</text></a><a href="https://ok.cl">B</a></svg>'
    expect(sanitizeSvg(svg)).toBe('<svg><a><text>A</text></a><a href="https://ok.cl">B</a></svg>')
  })
})

describe('diagramFileName', () => {
  it('genera nombres de archivo sin tildes ni símbolos', () => {
    expect(diagramFileName('Diagrama de clases: Módulo Pago', 'svg')).toBe('diagrama-de-clases-modulo-pago.svg')
    expect(diagramFileName('***', 'puml')).toBe('diagrama.puml')
  })
})

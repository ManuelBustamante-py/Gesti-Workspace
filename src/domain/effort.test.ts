import { describe, expect, it } from 'vitest'

import { effortWeights, formatEffort, isValidEffort, parseEffort, taskEffort } from './effort'

describe('parseEffort', () => {
  it('lee números, decimales con coma y textos de plantilla', () => {
    expect(parseEffort(5)).toBe(5)
    expect(parseEffort('8 pts')).toBe(8)
    expect(parseEffort('Peso 3')).toBe(3)
    expect(parseEffort('3 (M)')).toBe(3)
    expect(parseEffort('2,5')).toBe(2.5)
  })

  it('acepta tallas de camiseta', () => {
    expect(parseEffort('M')).toBe(3)
    expect(parseEffort('talla xl')).toBe(8)
  })

  it('rechaza vacíos y valores fuera de rango', () => {
    expect(parseEffort('')).toBeNull()
    expect(parseEffort(null)).toBeNull()
    expect(parseEffort('0')).toBeNull()
    expect(parseEffort(500)).toBeNull()
    expect(parseEffort('mucho')).toBeNull()
  })

  it('valida con un decimal como máximo', () => {
    expect(isValidEffort(0.5)).toBe(true)
    expect(isValidEffort(1.25)).toBe(false)
  })
})

describe('taskEffort', () => {
  it('prefiere el campo propio sobre la descripción', () => {
    expect(taskEffort({ effort: 5, description: '▌Estimación\n3 (M)' })).toEqual({ value: 5, source: 'field' })
  })

  it('usa la sección «Estimación» si no hay campo', () => {
    expect(taskEffort({ effort: null, description: '▌Estimación\n3 (M)' })).toEqual({ value: 3, source: 'description' })
  })

  it('convierte el numeric que llega como texto', () => {
    expect(taskEffort({ effort: '13.0', description: null })).toEqual({ value: 13, source: 'field' })
  })

  it('sin estimación devuelve null', () => {
    expect(taskEffort({ effort: null, description: 'Texto libre' })).toBeNull()
  })
})

describe('effortWeights', () => {
  it('pondera las tareas sin estimar con el promedio de las estimadas', () => {
    const result = effortWeights([
      { id: 'a', effort: 2, description: null },
      { id: 'b', effort: 8, description: null },
      { id: 'c', effort: null, description: null },
    ])
    expect(result.fallback).toBe(5)
    expect(result.weights.get('c')).toBe(5)
    expect(result.estimated).toBe(2)
    expect(result.estimatedPoints).toBe(10)
  })

  it('sin ninguna estimada cada tarea pesa 1', () => {
    const result = effortWeights([{ id: 'a', effort: null, description: null }])
    expect(result.fallback).toBe(1)
    expect(result.weights.get('a')).toBe(1)
  })
})

describe('formatEffort', () => {
  it('usa singular y plural', () => {
    expect(formatEffort(1)).toBe('1 pt')
    expect(formatEffort(2.5)).toBe('2,5 pts')
  })
})

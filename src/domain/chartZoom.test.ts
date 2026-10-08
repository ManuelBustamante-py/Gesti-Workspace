import { describe, expect, it } from 'vitest'

import { clampView, isFullView, niceScale, panView, rangeView, zoomView } from './chartZoom'

describe('chartZoom', () => {
  it('mantiene la ventana dentro del eje y con un largo mínimo de una semana', () => {
    expect(clampView({ from: -5, to: 20 }, 100)).toEqual({ from: 0, to: 25 })
    expect(clampView({ from: 90, to: 120 }, 100)).toEqual({ from: 70, to: 100 })
    expect(clampView({ from: 50, to: 52 }, 100)).toEqual({ from: 50, to: 57 })
    expect(clampView({ from: 0, to: 3 }, 4)).toEqual({ from: 0, to: 4 })
  })

  it('acerca manteniendo fijo el punto de anclaje', () => {
    const view = zoomView({ from: 0, to: 100 }, 0.5, 80, 100)
    expect(view).toEqual({ from: 40, to: 90 })
    // El ancla queda a la misma proporción (80 %) de la ventana.
    expect((80 - view.from) / (view.to - view.from)).toBeCloseTo(0.8)
  })

  it('no acerca más de una semana ni aleja más allá del eje completo', () => {
    expect(zoomView({ from: 10, to: 18 }, 0.1, 14, 100).to - zoomView({ from: 10, to: 18 }, 0.1, 14, 100).from).toBe(7)
    expect(zoomView({ from: 10, to: 60 }, 5, 30, 100)).toEqual({ from: 0, to: 100 })
  })

  it('desplaza sin salirse del eje', () => {
    expect(panView({ from: 10, to: 30 }, 5, 100)).toEqual({ from: 15, to: 35 })
    expect(panView({ from: 10, to: 30 }, -50, 100)).toEqual({ from: 0, to: 20 })
    expect(panView({ from: 10, to: 30 }, 500, 100)).toEqual({ from: 80, to: 100 })
  })

  it('crea una ventana desde una selección en cualquier dirección', () => {
    expect(rangeView(60, 20, 100)).toEqual({ from: 20, to: 60 })
    expect(isFullView({ from: 0, to: 100 }, 100)).toBe(true)
    expect(isFullView({ from: 1, to: 100 }, 100)).toBe(false)
  })

  it('genera ejes Y con pasos enteros redondos', () => {
    expect(niceScale(0, 50)).toEqual({ min: 0, max: 50, ticks: [0, 10, 20, 30, 40, 50] })
    expect(niceScale(21, 33)).toEqual({ min: 20, max: 35, ticks: [20, 25, 30, 35] })
    expect(niceScale(0, 3).ticks).toEqual([0, 1, 2, 3])
    expect(niceScale(5, 5)).toEqual({ min: 5, max: 6, ticks: [5, 6] })
  })
})

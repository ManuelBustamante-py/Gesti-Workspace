import { describe, expect, it } from 'vitest'

import { fitWithin, formatBytes } from './imageCompression'

describe('imageCompression', () => {
  it('reduce el lado mayor a 1600 px manteniendo la proporción', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(1080, 2400)).toEqual({ width: 720, height: 1600 })
  })

  it('no agranda imágenes pequeñas', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('formatea tamaños legibles', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(245760)).toBe('240 KB')
    expect(formatBytes(1572864)).toBe('1.5 MB')
  })
})

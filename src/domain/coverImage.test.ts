import { describe, expect, it } from 'vitest'

import { coverStyle, normalizeCoverUrl } from './coverImage'

describe('normalizeCoverUrl', () => {
  it('acepta https y deja vacío como sin fondo', () => {
    expect(normalizeCoverUrl('  https://example.com/img.jpg ')).toBe('https://example.com/img.jpg')
    expect(normalizeCoverUrl('   ')).toBeNull()
  })

  it('rechaza otros esquemas y textos que no son URL', () => {
    expect(() => normalizeCoverUrl('http://example.com/a.jpg')).toThrow('https')
    expect(() => normalizeCoverUrl('javascript:alert(1)')).toThrow('https')
    expect(() => normalizeCoverUrl('data:image/png;base64,AAAA')).toThrow('https')
    expect(() => normalizeCoverUrl('imagen.jpg')).toThrow('URL completa')
    expect(() => normalizeCoverUrl(`https://example.com/${'a'.repeat(2100)}`)).toThrow('larga')
  })
})

describe('coverStyle', () => {
  it('escapa la URL para que no pueda salir de url()', () => {
    const style = coverStyle('https://example.com/a.jpg?x=");background:red;("') as Record<string, string>
    expect(style['--board-cover']).toBe('url("https://example.com/a.jpg?x=\\");background:red;(\\"")')
    expect(coverStyle(null)).toBeUndefined()
  })
})

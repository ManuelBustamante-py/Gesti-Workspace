import { describe, expect, it } from 'vitest'

import { prependUniqueById } from './collections'

describe('prependUniqueById', () => {
  it('no duplica un tablero que Realtime ya añadió', () => {
    const imported = { id: 'b2', name: 'Importado' }
    const afterRealtime = [{ id: 'b2', name: 'Importado (parcial)' }, { id: 'b1', name: 'Viejo' }]
    expect(prependUniqueById(afterRealtime, imported)).toEqual([imported, { id: 'b1', name: 'Viejo' }])
  })

  it('añade al principio si no estaba', () => {
    expect(prependUniqueById([{ id: 'b1' }], { id: 'b2' })).toEqual([{ id: 'b2' }, { id: 'b1' }])
  })
})

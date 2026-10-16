import { afterEach, describe, expect, it, vi } from 'vitest'

import { confirmAction } from './confirmAction'

describe('confirmAction', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sin diálogo montado recurre a window.confirm', async () => {
    const confirm = vi.fn(() => true)
    vi.stubGlobal('window', { confirm })
    await expect(confirmAction('¿Eliminar?')).resolves.toBe(true)
    expect(confirm).toHaveBeenCalledWith('¿Eliminar?')
  })
})

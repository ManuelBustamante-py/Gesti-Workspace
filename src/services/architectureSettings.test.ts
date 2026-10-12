import { beforeEach, describe, expect, it, vi } from 'vitest'

type Result = { data: unknown; error: { message: string; code?: string } | null }
const state: { read: Result; write: Result } = { read: { data: null, error: null }, write: { data: null, error: null } }

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => state.read }) }),
      upsert: () => ({ select: async () => state.write }),
    }),
  },
}))

const { ARCHITECTURE_MIGRATION_MESSAGE, getArchitectureSettings, saveArchitectureSettings } = await import('./architectureSettings')
const { defaultSettings } = await import('../domain/uml/coherence')

describe('architectureSettings', () => {
  beforeEach(() => {
    state.read = { data: null, error: null }
    state.write = { data: null, error: null }
  })

  it('sin configuración guardada devuelve la de por defecto', async () => {
    expect(await getArchitectureSettings('b1')).toEqual({ settings: defaultSettings(), available: true })
  })

  it('sanea la configuración guardada', async () => {
    state.read = { data: { settings: { style: 'mvc', disabledRules: ['x', 3] } }, error: null }
    const { settings } = await getArchitectureSettings('b1')
    expect(settings.style).toBe('mvc')
    expect(settings.disabledRules).toEqual(['x'])
  })

  it('si falta la migración permite analizar con la configuración por defecto, sin guardar', async () => {
    state.read = { data: null, error: { message: 'relation "public.board_architecture_settings" does not exist' } }
    expect(await getArchitectureSettings('b1')).toEqual({ settings: defaultSettings(), available: false })
    state.write = { data: null, error: { message: 'Could not find the table public.board_architecture_settings in the schema cache' } }
    await expect(saveArchitectureSettings('b1', defaultSettings())).rejects.toThrow(ARCHITECTURE_MIGRATION_MESSAGE)
  })

  it('propaga los fallos del servicio y la falta de permisos', async () => {
    state.read = { data: null, error: { message: 'network down' } }
    await expect(getArchitectureSettings('b1')).rejects.toMatchObject({ message: 'network down' })
    state.write = { data: [], error: null }
    await expect(saveArchitectureSettings('b1', defaultSettings())).rejects.toThrow(/permiso/i)
  })
})

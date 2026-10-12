import { sanitizeSettings, type ArchitectureSettings } from '../domain/uml/coherence'
import { supabase } from '../lib/supabase'
import { NO_PERMISSION_MESSAGE } from './tasks'

export const ARCHITECTURE_MIGRATION_MESSAGE =
  'Para guardar la configuración del análisis aplica la migración 20261012120000_board_architecture_settings.sql en Supabase. Mientras tanto se usa la configuración por defecto.'

export type StoredArchitectureSettings = {
  settings: ArchitectureSettings
  /** false si la tabla aún no existe: se puede analizar, pero no guardar. */
  available: boolean
}

const missingTable = (error: { message: string; code?: string }) =>
  /board_architecture_settings/.test(error.message) && /does not exist|schema cache|not find/i.test(error.message)

/** Configuración del tablero (o la de por defecto si no hay ninguna guardada). */
export async function getArchitectureSettings(boardId: string): Promise<StoredArchitectureSettings> {
  const { data, error } = await supabase.from('board_architecture_settings').select('settings').eq('board_id', boardId).maybeSingle()
  if (error) {
    if (missingTable(error)) return { settings: sanitizeSettings(null), available: false }
    throw error
  }
  return { settings: sanitizeSettings(data?.settings ?? null), available: true }
}

export async function saveArchitectureSettings(boardId: string, settings: ArchitectureSettings) {
  const { data, error } = await supabase
    .from('board_architecture_settings')
    .upsert({ board_id: boardId, settings }, { onConflict: 'board_id' })
    .select('settings')
  if (error) throw missingTable(error) ? new Error(ARCHITECTURE_MIGRATION_MESSAGE) : error
  if (!data || data.length === 0) throw new Error(NO_PERMISSION_MESSAGE)
  return sanitizeSettings(data[0].settings)
}

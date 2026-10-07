import { supabase } from '../lib/supabase'
import type { StatusEvent } from '../domain/cfd'

// Tabla inexistente (migración 20261007120000 sin aplicar): PostgREST responde
// PGRST205 en versiones recientes y 42P01 en las anteriores.
const MISSING_TABLE = new Set(['PGRST205', '42P01'])
const PAGE_SIZE = 1000

/** Historial de estados de un tablero, en orden cronológico. */
export async function getBoardStatusEvents(boardId: string) {
  const events: StatusEvent[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('task_status_events')
      .select('task_id, status, occurred_at')
      .eq('board_id', boardId)
      .order('occurred_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      if (error.code && MISSING_TABLE.has(error.code)) return { events: [], supported: false }
      throw error
    }
    events.push(...((data ?? []) as StatusEvent[]))
    if (!data || data.length < PAGE_SIZE) break
  }
  return { events, supported: true }
}

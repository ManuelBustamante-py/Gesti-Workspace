import { supabase } from '../lib/supabase'
import { summarizeBoards, type BoardSummary, type SummaryRow } from '../domain/boardSummary'
import { todayKey } from '../domain/dates'

// PGRST202: la función RPC no existe (migración 20261007200000 sin aplicar).
const MISSING_FUNCTION = 'PGRST202'

/** Resumen ejecutivo de todos los tableros accesibles, en una sola llamada. */
export async function getBoardSummaries(): Promise<{ summaries: Record<string, BoardSummary>; supported: boolean }> {
  const { data, error } = await supabase.rpc('get_board_summaries')
  if (error) {
    if (error.code === MISSING_FUNCTION) return { summaries: {}, supported: false }
    throw error
  }
  return { summaries: summarizeBoards((data ?? []) as SummaryRow[], todayKey()), supported: true }
}

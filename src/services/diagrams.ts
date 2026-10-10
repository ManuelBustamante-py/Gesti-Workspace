import { supabase } from '../lib/supabase'
import { NO_PERMISSION_MESSAGE } from './tasks'

export type DiagramMode = 'code' | 'visual'

export interface DiagramSummary {
  id: string
  board_id: string
  name: string
  kind: string
  mode: DiagramMode
  updated_at: string
  updated_by: string | null
}

export interface Diagram extends DiagramSummary {
  source: string
  model: unknown
  created_by: string | null
  created_at: string
}

const MIGRATION_MESSAGE = 'Para usar diagramas aplica la migración 20261011090000_board_diagrams.sql en Supabase.'
export const DIAGRAM_CONFLICT_MESSAGE =
  'Otra persona guardó cambios en este diagrama mientras lo editabas. Copia tu código, recarga el diagrama y vuelve a aplicar tus cambios.'

function translateError(error: { message: string; code?: string }) {
  if (/board_diagrams/.test(error.message) && /does not exist|schema cache|not find/i.test(error.message)) {
    return new Error(MIGRATION_MESSAGE)
  }
  return error
}

/** Lista liviana (sin el código) para la galería del tablero. */
export async function listDiagrams(boardId: string) {
  const { data, error } = await supabase
    .from('board_diagrams')
    .select('id, board_id, name, kind, mode, updated_at, updated_by')
    .eq('board_id', boardId)
    .order('updated_at', { ascending: false })
  if (error) throw translateError(error)
  return data as DiagramSummary[]
}

export async function getDiagram(id: string) {
  const { data, error } = await supabase.from('board_diagrams').select('*').eq('id', id).maybeSingle()
  if (error) throw translateError(error)
  return data as Diagram | null
}

export async function createDiagram(boardId: string, values: { name: string; kind: string; mode: DiagramMode; source: string }) {
  const name = values.name.trim()
  if (!name) throw new Error('El diagrama debe tener un nombre.')
  const { data, error } = await supabase
    .from('board_diagrams')
    .insert({ board_id: boardId, name, kind: values.kind, mode: values.mode, source: values.source })
    .select()
  if (error) throw translateError(error)
  if (!data || data.length === 0) throw new Error(NO_PERMISSION_MESSAGE)
  return data[0] as Diagram
}

/**
 * Guarda cambios solo si nadie más guardó desde `expectedUpdatedAt`
 * (concurrencia optimista): así no se pisan los cambios de otro colaborador.
 */
export async function updateDiagram(
  id: string,
  values: { name?: string; source?: string },
  expectedUpdatedAt: string,
) {
  const patch: Record<string, string> = {}
  if (values.name !== undefined) {
    const name = values.name.trim()
    if (!name) throw new Error('El diagrama debe tener un nombre.')
    patch.name = name
  }
  if (values.source !== undefined) patch.source = values.source

  const { data, error } = await supabase
    .from('board_diagrams')
    .update(patch)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select()
  if (error) throw translateError(error)
  if (data && data.length > 0) return data[0] as Diagram

  // Sin filas: o cambió entretanto o no hay permiso.
  const current = await getDiagram(id)
  if (current && current.updated_at !== expectedUpdatedAt) throw new Error(DIAGRAM_CONFLICT_MESSAGE)
  throw new Error(NO_PERMISSION_MESSAGE)
}

export async function deleteDiagram(id: string) {
  const { data, error } = await supabase.from('board_diagrams').delete().eq('id', id).select('id')
  if (error) throw translateError(error)
  if (!data || data.length === 0) throw new Error(NO_PERMISSION_MESSAGE)
}

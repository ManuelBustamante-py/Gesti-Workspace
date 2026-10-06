import { supabase } from '../lib/supabase'
import type { CommentKind } from './taskComments'

export interface BoardMessage {
  id: string
  task_id: string
  task_title: string
  author_id: string
  author_name: string
  author_avatar_url: string | null
  kind: CommentKind
  body: string
  attachment_count: number
  created_at: string
  is_unread: boolean
}

export interface MessagePreview {
  board_id: string
  board_name: string
  task_id: string
  task_title: string
  author_id: string
  author_name: string
  kind: CommentKind
  body: string
  muted: boolean
}

/** No leídos y silenciado por tablero. */
export type MessageCounts = Record<string, { unread: number; muted: boolean }>

export const MESSAGES_PAGE_SIZE = 30
// PGRST202: la función RPC no existe (migración 20261006220000 sin aplicar).
const MISSING_FUNCTION = 'PGRST202'

export async function getUnreadMessageCounts() {
  const { data, error } = await supabase.rpc('get_unread_message_counts')
  if (error) {
    if (error.code === MISSING_FUNCTION) return { counts: {} as MessageCounts, supported: false }
    throw error
  }
  const counts: MessageCounts = {}
  for (const row of (data ?? []) as Array<{ board_id: string; unread: number; muted: boolean }>) {
    counts[row.board_id] = { unread: row.unread, muted: row.muted }
  }
  return { counts, supported: true }
}

export async function getBoardMessages(boardId: string, before?: string) {
  const { data, error } = await supabase.rpc('get_board_messages', {
    target_board_id: boardId,
    before_created_at: before ?? null,
    max_rows: MESSAGES_PAGE_SIZE,
  })
  if (error) throw error
  return (data ?? []) as BoardMessage[]
}

export async function getMessagePreview(commentId: string) {
  const { data, error } = await supabase.rpc('get_message_preview', { target_comment_id: commentId })
  if (error) throw error
  return ((data ?? []) as MessagePreview[])[0] ?? null
}

export async function markBoardMessagesRead(boardId: string) {
  const { error } = await supabase.rpc('mark_board_messages_read', { target_board_id: boardId })
  if (error) throw error
}

export async function setBoardNotificationsMuted(boardId: string, muted: boolean) {
  const { error } = await supabase.rpc('set_board_notifications_muted', {
    target_board_id: boardId,
    is_muted: muted,
  })
  if (error) throw error
}

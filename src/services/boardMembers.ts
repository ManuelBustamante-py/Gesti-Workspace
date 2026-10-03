import { supabase } from '../lib/supabase'

export type BoardMemberRole = 'viewer' | 'editor'

export interface BoardInvitation {
  id: string
  board_id: string
  email: string
  role: BoardMemberRole
  status: 'pending' | 'accepted' | 'declined'
  token: string
  created_at: string
}

export interface BoardMember {
  id: string
  board_id: string
  user_id: string
  role: BoardMemberRole
  created_at: string
  profile?: {
    username: string | null
    display_name: string | null
    avatar_url: string | null
  } | null
}

export async function getBoardMembers(boardId: string) {
  const { data, error } = await supabase
    .from('board_members')
    .select('*, profile:profiles(username, display_name, avatar_url)')
    .eq('board_id', boardId)
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  return data as BoardMember[]
}

export async function getBoardInvitations(boardId: string) {
  const { data, error } = await supabase
    .from('board_invitations')
    .select('*')
    .eq('board_id', boardId)
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  return data as BoardInvitation[]
}

export async function inviteBoardMember(
  boardId: string,
  email: string,
  role: BoardMemberRole,
) {
  const trimmedEmail = email.trim().toLowerCase()

  if (!trimmedEmail || !trimmedEmail.includes('@')) {
    throw new Error('Indica un correo electrónico válido.')
  }

  const { data, error } = await supabase
    .from('board_invitations')
    .upsert(
      {
        board_id: boardId,
        email: trimmedEmail,
        role,
        status: 'pending',
      },
      { onConflict: 'board_id,email' },
    )
    .select()
    .single()

  if (error) {
    throw error
  }

  return data as BoardInvitation
}

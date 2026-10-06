import { supabase } from '../lib/supabase'
import { NO_PERMISSION_MESSAGE } from './tasks'

export type BoardMemberRole = 'viewer' | 'editor'

export interface BoardInvitation {
  id: string
  board_id: string
  recipient_id: string | null
  email: string
  role: BoardMemberRole
  status: 'pending' | 'accepted' | 'declined'
  token: string
  created_at: string
  board?: {
    name: string
    color: string
    owner_id: string
  } | null
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
  const { data, error } = await supabase.rpc('get_board_collaborators', {
    target_board_id: boardId,
  })

  if (error) {
    throw error
  }

  const collaborators = (data ?? []) as Array<{
    id: string
    board_id: string
    user_id: string
    role: BoardMemberRole
    created_at: string
    username: string | null
    display_name: string | null
    avatar_url: string | null
  }>

  return collaborators.map((member) => ({
    ...member,
    profile: {
      username: member.username,
      display_name: member.display_name,
      avatar_url: member.avatar_url,
    },
  })) as BoardMember[]
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

  const { data, error } = await supabase.rpc('invite_board_member', {
    target_board_id: boardId,
    target_email: trimmedEmail,
    target_role: role,
  })

  if (error) {
    throw error
  }

  return data as BoardInvitation
}

export async function updateBoardMemberRole(memberId: string, role: BoardMemberRole) {
  const { data, error } = await supabase
    .from('board_members')
    .update({ role })
    .eq('id', memberId)
    .select('id')

  if (error) {
    throw error
  }
  if (!data || data.length === 0) {
    throw new Error(NO_PERMISSION_MESSAGE)
  }
}

/** El propietario quita a un miembro, o un miembro abandona el tablero. */
export async function removeBoardMember(memberId: string) {
  const { data, error } = await supabase
    .from('board_members')
    .delete()
    .eq('id', memberId)
    .select('id')

  if (error) {
    throw error
  }
  if (!data || data.length === 0) {
    throw new Error(NO_PERMISSION_MESSAGE)
  }
}

export async function cancelBoardInvitation(invitationId: string) {
  const { data, error } = await supabase
    .from('board_invitations')
    .delete()
    .eq('id', invitationId)
    .select('id')

  if (error) {
    throw error
  }
  if (!data || data.length === 0) {
    throw new Error(NO_PERMISSION_MESSAGE)
  }
}

export async function getReceivedBoardInvitations() {
  const { data, error } = await supabase.rpc('get_received_board_invitations')

  if (error) {
    throw error
  }

  return (data as Array<BoardInvitation & {
    board_name: string
    board_color: string
  }>).map((invitation) => ({
    ...invitation,
    board: {
      name: invitation.board_name,
      color: invitation.board_color,
      owner_id: '',
    },
  }))
}

export async function respondToBoardInvitation(
  invitationId: string,
  response: 'accept' | 'decline',
) {
  const functionName =
    response === 'accept'
      ? 'accept_board_invitation'
      : 'decline_board_invitation'
  const { data, error } = await supabase.rpc(functionName, {
    invitation_id: invitationId,
  })

  if (error) {
    throw error
  }

  return data as BoardInvitation
}

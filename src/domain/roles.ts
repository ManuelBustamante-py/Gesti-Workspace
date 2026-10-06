export type BoardRole = 'owner' | 'editor' | 'viewer'

export const roleLabels: Record<BoardRole, string> = {
  owner: 'Propietario',
  editor: 'Editor',
  viewer: 'Lector',
}

/** Emote por rol: identifica de un vistazo quién puede hacer qué. */
export const roleEmotes: Record<BoardRole, string> = {
  owner: '👑',
  editor: '✏️',
  viewer: '👀',
}

export const roleDescriptions: Record<BoardRole, string> = {
  owner: 'Gestiona el tablero, su jornada y sus colaboradores.',
  editor: 'Crea, edita, mueve y elimina columnas y tareas.',
  viewer: 'Consulta el tablero, el Gantt y las exportaciones.',
}

export function resolveBoardRole(
  board: { owner_id: string } | null | undefined,
  userId: string | null | undefined,
  members: Array<{ user_id: string; role: 'viewer' | 'editor' }>,
): BoardRole {
  if (board && userId && board.owner_id === userId) return 'owner'
  const membership = members.find((member) => member.user_id === userId)
  return membership?.role ?? 'viewer'
}

export function boardPermissions(role: BoardRole) {
  return {
    canEditContent: role === 'owner' || role === 'editor',
    canManageBoard: role === 'owner',
  }
}

/** Hito de avance para el tablero (gamificación ligera, sin puntajes individuales). */
export function progressMilestone(percent: number) {
  if (percent >= 100) return { emote: '🏆', label: 'Proyecto completado' }
  if (percent >= 75) return { emote: '🏁', label: 'Recta final' }
  if (percent >= 25) return { emote: '🚀', label: 'En marcha' }
  if (percent > 0) return { emote: '🌱', label: 'Primeros avances' }
  return { emote: '🧭', label: 'Por comenzar' }
}

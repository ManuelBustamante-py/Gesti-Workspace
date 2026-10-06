import type { BoardRole } from './roles'

export type BoardPerson = {
  userId: string
  name: string
  username: string | null
  avatarUrl: string | null
  role: BoardRole
}

type ProfileLike = {
  display_name: string | null
  username: string | null
  avatar_url: string | null
} | null | undefined

type MemberLike = {
  user_id: string
  role: 'viewer' | 'editor'
  profile?: ProfileLike
}

function displayName(profile: ProfileLike, fallback: string) {
  return profile?.display_name?.trim() || profile?.username?.trim() || fallback
}

/** Propietario + colaboradores: las personas que pueden ser responsables de una tarea. */
export function buildBoardPeople(
  ownerId: string,
  ownerProfile: ProfileLike,
  ownerFallbackName: string,
  members: MemberLike[],
): BoardPerson[] {
  return [
    {
      userId: ownerId,
      name: displayName(ownerProfile, ownerFallbackName),
      username: ownerProfile?.username ?? null,
      avatarUrl: ownerProfile?.avatar_url ?? null,
      role: 'owner' as const,
    },
    ...members
      .filter((member) => member.user_id !== ownerId)
      .map((member) => ({
        userId: member.user_id,
        name: displayName(member.profile, 'Colaborador'),
        username: member.profile?.username ?? null,
        avatarUrl: member.profile?.avatar_url ?? null,
        role: member.role,
      })),
  ]
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)
  return letters.toUpperCase()
}

/** Nombres de responsables en orden de asignación; omite personas que ya no están en el tablero. */
export function assigneeNames(userIds: string[] | undefined, people: BoardPerson[]) {
  return (userIds ?? [])
    .map((userId) => people.find((person) => person.userId === userId)?.name)
    .filter((name): name is string => Boolean(name))
}

import { describe, expect, it } from 'vitest'

import { assigneeNames, buildBoardPeople, initials } from './people'

describe('people', () => {
  const people = buildBoardPeople(
    'owner',
    { display_name: 'Manuel Bustamante', username: 'manuel', avatar_url: null },
    'Propietario',
    [
      { user_id: 'ana', role: 'editor', profile: { display_name: null, username: 'ana', avatar_url: null } },
      { user_id: 'owner', role: 'viewer', profile: null },
      { user_id: 'luis', role: 'viewer', profile: null },
    ],
  )

  it('pone primero al propietario y no lo duplica', () => {
    expect(people.map((person) => [person.userId, person.role, person.name])).toEqual([
      ['owner', 'owner', 'Manuel Bustamante'],
      ['ana', 'editor', 'ana'],
      ['luis', 'viewer', 'Colaborador'],
    ])
  })

  it('omite responsables que ya no están en el tablero', () => {
    expect(assigneeNames(['ana', 'removed', 'owner'], people)).toEqual(['ana', 'Manuel Bustamante'])
  })

  it('genera iniciales legibles', () => {
    expect(initials('Manuel Bustamante Aliaga')).toBe('MA')
    expect(initials('ana')).toBe('AN')
  })
})

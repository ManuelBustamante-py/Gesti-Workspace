import type { User } from '@supabase/supabase-js'

import { supabase } from '../lib/supabase'

export interface Profile {
  id: string
  username: string | null
  display_name: string | null
  first_name: string | null
  last_name: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export async function getProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) {
    throw error
  }

  return data as Profile
}

export async function syncProfileFromAuthUser(user: User) {
  const profile = await getProfile(user.id)
  const metadata = user.user_metadata
  const fullName =
    metadata.full_name ?? metadata.name ?? metadata.display_name ?? ''
  const nameParts = String(fullName).trim().split(/\s+/).filter(Boolean)
  const firstName = String(
    metadata.first_name ?? metadata.given_name ?? nameParts[0] ?? '',
  ).trim()
  const lastName = String(
    metadata.last_name ??
      metadata.family_name ??
      nameParts.slice(1).join(' '),
  ).trim()
  const username = String(
    metadata.username ?? user.email?.split('@')[0] ?? '',
  ).trim()
  const displayName = `${firstName} ${lastName}`.trim() || fullName.trim()
  const updates: Partial<Profile> & { updated_at: string } = {
    updated_at: new Date().toISOString(),
  }

  if (!profile.first_name && firstName) {
    updates.first_name = firstName
  }

  if (!profile.last_name && lastName) {
    updates.last_name = lastName
  }

  if (!profile.username && username) {
    updates.username = username
  }

  if (!profile.display_name && displayName) {
    updates.display_name = displayName
  }

  if (!profile.avatar_url && metadata.avatar_url) {
    updates.avatar_url = String(metadata.avatar_url)
  }

  if (Object.keys(updates).length === 1) {
    return profile
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', user.id)
    .select()
    .single()

  if (error) {
    throw error
  }

  return data as Profile
}

export async function updateProfile(
  userId: string,
  avatarUrl: string,
) {
  const { data, error } = await supabase
    .from('profiles')
    .update({
      avatar_url: avatarUrl.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select()
    .single()

  if (error) {
    throw error
  }

  return data as Profile
}

export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    throw error
  }

}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    throw new Error('No se pudo identificar el correo de la sesión.')
  }

  const { error: reauthenticationError } =
    await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    })

  if (reauthenticationError) {
    throw new Error('La contraseña actual no es correcta.')
  }

  await updatePassword(newPassword)
}

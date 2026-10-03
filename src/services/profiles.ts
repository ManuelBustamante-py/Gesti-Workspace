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

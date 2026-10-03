import { supabase } from '../lib/supabase'

export async function register(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
) {
  const normalizedEmail = email.trim().toLowerCase()
  const username = normalizedEmail.split('@')[0] ?? ''
  const displayName = `${firstName.trim()} ${lastName.trim()}`.trim()

  const { data, error } = await supabase.auth.signUp({
    email: normalizedEmail,
    password,
    options: {
      data: {
        username,
        display_name: displayName,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      },
    },
  })

  if (error) {
    throw error
  }

  return data
}

export async function login(
  email: string,
  password: string,
) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    throw error
  }

  return data
}

export async function logout() {
  const { error } = await supabase.auth.signOut()

  if (error) {
    throw error
  }
}
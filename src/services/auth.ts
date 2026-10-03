import { supabase } from '../lib/supabase'

export type OAuthProvider = 'google' | 'github'

export async function signInWithOAuthProvider(provider: OAuthProvider) {
  const redirectUrl = new URL(
    `${import.meta.env.BASE_URL}dashboard`,
    window.location.origin,
  ).toString()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: redirectUrl,
    },
  })

  if (error) {
    throw error
  }

  return data
}

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

export async function requestPasswordReset(email: string) {
  const redirectUrl = new URL(
    `${import.meta.env.BASE_URL}reset-password`,
    window.location.origin,
  ).toString()
  const { error } = await supabase.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    { redirectTo: redirectUrl },
  )

  if (error) {
    throw error
  }
}

export async function logout() {
  const { error } = await supabase.auth.signOut()

  if (error) {
    throw error
  }
}
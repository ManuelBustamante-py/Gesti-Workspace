import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { updatePassword } from '../services/profiles'
import { supabase } from '../lib/supabase'

function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const subscription = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setReady(true)
      }
    })

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true)
    })

    return () => subscription.data.subscription.unsubscribe()
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')

    if (!ready) {
      setError('El enlace de recuperación no es válido o ha expirado.')
      return
    }
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    if (password !== confirmation) {
      setError('Las contraseñas no coinciden.')
      return
    }

    try {
      setLoading(true)
      await updatePassword(password)
      setMessage('Contraseña actualizada correctamente. Redirigiendo...')
      window.setTimeout(() => navigate('/login', { replace: true }), 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la contraseña.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="mb-6 text-sm font-semibold tracking-wide text-[var(--accent-ui)]">KANBAN / WORKSPACE</div>
        <h1 className="text-3xl font-bold text-[var(--text-main)]">Nueva contraseña</h1>
        <p className="mt-2 text-[var(--text-muted)]">Elige una contraseña segura para tu cuenta.</p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Nueva contraseña"
            required
            className="theme-input w-full rounded-lg px-4 py-3"
          />
          <input
            type="password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="Confirmar nueva contraseña"
            required
            className="theme-input w-full rounded-lg px-4 py-3"
          />
          {error && <div className="alert-error rounded-lg p-3 text-sm">{error}</div>}
          {message && <div className="status-success rounded-lg p-3 text-sm">{message}</div>}
          <button type="submit" disabled={loading} className="btn-mint-primary w-full px-4 py-3 font-semibold disabled:opacity-50">
            {loading ? 'Actualizando...' : 'Guardar contraseña'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
          <Link to="/login" className="font-medium text-[var(--accent-ui)] hover:text-[var(--text-main)]">
            Volver a iniciar sesión
          </Link>
        </p>
      </div>
    </main>
  )
}

export default ResetPassword

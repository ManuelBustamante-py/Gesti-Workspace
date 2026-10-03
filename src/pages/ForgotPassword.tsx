import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { requestPasswordReset } from '../services/auth'

function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    try {
      await requestPasswordReset(email)
      setMessage('Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el enlace de recuperación.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="mb-6 text-sm font-semibold tracking-wide text-[var(--accent-ui)]">KANBAN / WORKSPACE</div>
        <h1 className="text-3xl font-bold text-[var(--text-main)]">Recuperar contraseña</h1>
        <p className="mt-2 text-[var(--text-muted)]">
          Te enviaremos un enlace para crear una nueva contraseña.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label htmlFor="recovery-email" className="mb-2 block text-sm font-medium text-[var(--text-main)]">
              Correo electrónico
            </label>
            <input
              id="recovery-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="theme-input w-full rounded-lg px-4 py-3"
              placeholder="tu@email.com"
            />
          </div>

          {error && <div className="alert-error rounded-lg p-3 text-sm">{error}</div>}
          {message && <div className="status-success rounded-lg p-3 text-sm">{message}</div>}

          <button type="submit" disabled={loading} className="btn-mint-primary w-full px-4 py-3 font-semibold disabled:opacity-50">
            {loading ? 'Enviando...' : 'Enviar enlace'}
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

export default ForgotPassword

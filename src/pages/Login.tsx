import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { login } from '../services/auth'

function Login() {
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setError('')
    setLoading(true)

    try {
      await login(email, password)
      navigate('/dashboard')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo iniciar sesión.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="mb-6 text-sm font-semibold tracking-wide text-[var(--accent-mint)]">KANBAN / WORKSPACE</div>
        <h1 className="text-3xl font-bold text-[var(--text-main)]">
          Iniciar sesión
        </h1>

        <p className="mt-2 text-[var(--text-muted)]">
          Accede a tus tableros Kanban.
        </p>

        <form
          onSubmit={handleSubmit}
          className="mt-8 space-y-5"
        >
          <div>
            <label
              htmlFor="email"
              className="mb-2 block text-sm font-medium text-[var(--text-main)]"
            >
              Correo electrónico
            </label>

            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="theme-input w-full rounded-lg px-4 py-3"
              placeholder="tu@email.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-2 block text-sm font-medium text-[var(--text-main)]"
            >
              Contraseña
            </label>

            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="theme-input w-full rounded-lg px-4 py-3"
              placeholder="••••••••"
            />
          </div>

          <div className="text-right">
            <Link to="/forgot-password" className="text-sm text-[var(--accent-ui)] hover:text-[var(--text-main)]">
              ¿Olvidaste tu contraseña?
            </Link>
          </div>

          {error && (
            <div className="alert-error rounded-lg p-3 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-mint-primary w-full px-4 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
          ¿No tienes una cuenta?{' '}
          <Link
            to="/register"
            className="font-medium text-[var(--accent-mint)] hover:text-[var(--text-main)]"
          >
            Crear cuenta
          </Link>
        </p>
      </div>
    </main>
  )
}

export default Login
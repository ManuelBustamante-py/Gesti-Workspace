import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { register } from '../services/auth'
import OAuthProviderButtons from '../components/auth/OAuthProviderButtons'

function Register() {
  const navigate = useNavigate()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setError('')

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }

    setLoading(true)

    try {
      const data = await register(
        email,
        password,
        firstName,
        lastName,
      )

      if (data.session) {
        navigate('/dashboard')
      } else {
        navigate('/login?registered=true')
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo crear la cuenta.',
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
          Crear cuenta
        </h1>

        <p className="mt-2 text-[var(--text-muted)]">
          Crea tu cuenta para comenzar a organizar tus proyectos.
        </p>

        <OAuthProviderButtons
          actionLabel="Registrarse utilizando sus cuentas de:"
          onError={setError}
        />

        <form
          onSubmit={handleSubmit}
          className="mt-6 space-y-4"
        >
          <div>
            <label className="mb-2 block text-sm font-medium text-[var(--text-main)]">
              Nombre
            </label>

            <input
              type="text"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              required
              className="theme-input w-full rounded-lg px-4 py-3"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[var(--text-main)]">
              Apellido
            </label>

            <input
              type="text"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              required
              className="theme-input w-full rounded-lg px-4 py-3"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[var(--text-main)]">
              Correo electrónico
            </label>

            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="theme-input w-full rounded-lg px-4 py-3"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[var(--text-main)]">
              Contraseña
            </label>

            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="theme-input w-full rounded-lg px-4 py-3"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[var(--text-main)]">
              Confirmar contraseña
            </label>

            <input
              type="password"
              value={confirmPassword}
              onChange={(event) =>
                setConfirmPassword(event.target.value)
              }
              required
              className="theme-input w-full rounded-lg px-4 py-3"
            />
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
            {loading ? 'Creando cuenta...' : 'Crear cuenta'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
          ¿Ya tienes una cuenta?{' '}
          <Link
            to="/login"
            className="auth-link-recovery font-medium"
          >
            Iniciar sesión
          </Link>
        </p>
      </div>
    </main>
  )
}

export default Register
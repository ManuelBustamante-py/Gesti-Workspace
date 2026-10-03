import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'
import { logout } from '../services/auth'
import {
  changePassword,
  getProfile,
  updateProfile,
  type Profile as ProfileData,
} from '../services/profiles'

function Profile() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [username, setUsername] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadProfile() {
      if (!user) {
        return
      }

      try {
        const data = await getProfile(user.id)
        setProfile(data)
        setUsername(data.username ?? '')
        const nameParts = (data.display_name ?? '').trim().split(/\s+/)
        setFirstName(data.first_name ?? nameParts[0] ?? '')
        setLastName(data.last_name ?? nameParts.slice(1).join(' '))
        setAvatarUrl(data.avatar_url ?? '')
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'No se pudo cargar el perfil.',
        )
      } finally {
        setLoading(false)
      }
    }

    loadProfile()
  }, [user])

  const initials = useMemo(() => {
    const value = `${firstName} ${lastName}`.trim() || username || user?.email || 'U'
    return value.slice(0, 2).toUpperCase()
  }, [firstName, lastName, username, user?.email])

  async function handleSaveProfile() {
    if (!user) {
      return
    }

    try {
      setSaving(true)
      setError('')
      setMessage('')
      const data = await updateProfile(user.id, avatarUrl)
      setProfile(data)
      setMessage('Perfil actualizado correctamente.')
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo actualizar el perfil.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleChangePassword() {
    if (!currentPassword) {
      setError('Introduce tu contraseña actual.')
      return
    }

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }

    if (password !== passwordConfirmation) {
      setError('La confirmación de la nueva contraseña no coincide.')
      return
    }

    try {
      setChangingPassword(true)
      setError('')
      setMessage('')
      await changePassword(currentPassword, password)
      setCurrentPassword('')
      setPassword('')
      setPasswordConfirmation('')
      setMessage('Contraseña actualizada correctamente.')
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo cambiar la contraseña.',
      )
    } finally {
      setChangingPassword(false)
    }
  }

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <main className="min-h-screen p-4 text-[var(--text-main)] md:p-10">
      <div className="mx-auto max-w-3xl">
        <Link to="/dashboard" className="text-sm text-[var(--accent-mint)] hover:text-[var(--text-main)]">
          ← Volver al dashboard
        </Link>
        <div className="profile-card mt-6">
          <div className="flex items-center gap-4">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar del usuario" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent-mint)] text-xl font-bold text-[var(--bg-main)]">
                {initials}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold">Mi perfil</h1>
              <p className="text-sm text-[var(--text-muted)]">{user?.email}</p>
            </div>
          </div>

          {loading ? (
            <p className="mt-8 text-[var(--text-muted)]">Cargando perfil...</p>
          ) : (
            <>
              <section className="mt-8 space-y-4">
                <h2 className="text-lg font-semibold">Información personal</h2>
                <input value={firstName} readOnly aria-readonly="true" placeholder="Nombre" className="theme-input w-full rounded-lg px-4 py-3 opacity-70" />
                <input value={lastName} readOnly aria-readonly="true" placeholder="Apellido" className="theme-input w-full rounded-lg px-4 py-3 opacity-70" />
                <input value={user?.email ?? ''} readOnly aria-readonly="true" placeholder="Correo" className="theme-input w-full rounded-lg px-4 py-3 opacity-70" />
                <input value={username} readOnly aria-readonly="true" placeholder="Nombre de usuario" className="theme-input w-full rounded-lg px-4 py-3 opacity-70" />
                <input value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} placeholder="URL de imagen de perfil (opcional)" className="theme-input w-full rounded-lg px-4 py-3" />
                <button type="button" onClick={handleSaveProfile} disabled={saving} className="btn-mint-primary px-4 py-3 font-semibold disabled:opacity-50">
                  {saving ? 'Guardando...' : 'Guardar perfil'}
                </button>
              </section>

              <section className="mt-8 space-y-4 border-t border-white/10 pt-8">
                <h2 className="text-lg font-semibold">Seguridad</h2>
                <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Contraseña actual" className="theme-input w-full rounded-lg px-4 py-3" />
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Nueva contraseña" className="theme-input w-full rounded-lg px-4 py-3" />
                <input type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} placeholder="Confirmar nueva contraseña" className="theme-input w-full rounded-lg px-4 py-3" />
                <button type="button" onClick={handleChangePassword} disabled={changingPassword} className="btn-security-action px-4 py-3 font-semibold disabled:opacity-50">
                  {changingPassword ? 'Actualizando...' : 'Cambiar contraseña'}
                </button>
              </section>
            </>
          )}

          {(message || error) && (
            <p className={`mt-6 rounded-lg p-3 text-sm ${error ? 'alert-error' : 'status-success'}`}>
              {error || message}
            </p>
          )}

          <button type="button" onClick={handleLogout} className="btn-logout mt-8 px-4 py-3 font-semibold">
            Cerrar sesión
          </button>
          {profile && <p className="mt-3 text-xs text-[var(--text-muted)]">Perfil creado el {new Date(profile.created_at).toLocaleDateString()}</p>}
        </div>
      </div>
    </main>
  )
}

export default Profile

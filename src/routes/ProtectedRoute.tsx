import { Navigate, Outlet } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'

function ProtectedRoute() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <main className="auth-shell">
        <p className="text-[var(--text-muted)]">
          Cargando...
        </p>
      </main>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

export default ProtectedRoute
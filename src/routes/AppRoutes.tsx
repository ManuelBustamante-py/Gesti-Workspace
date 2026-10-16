import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { BrowserRouter } from 'react-router-dom'

import Login from '../pages/Login'
import Register from '../pages/Register'
import ProtectedRoute from './ProtectedRoute'
import ForgotPassword from '../pages/ForgotPassword'
import ResetPassword from '../pages/ResetPassword'

// Las páginas internas se descargan al entrar a ellas: así la pantalla de
// inicio de sesión no carga el tablero, el Gantt, el flujo ni los diagramas.
const Dashboard = lazy(() => import('../pages/Dashboard'))
const Profile = lazy(() => import('../pages/Profile'))
const BoardGantt = lazy(() => import('../pages/BoardGantt'))
const BoardFlow = lazy(() => import('../pages/BoardFlow'))
const BoardDiagrams = lazy(() => import('../pages/BoardDiagrams'))

function PageLoading() {
  return (
    <main className="auth-shell">
      <p className="text-[var(--text-muted)]">
        Cargando...
      </p>
    </main>
  )
}

function AppRoutes() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/dashboard/gantt/:boardId" element={<BoardGantt />} />
            <Route path="/dashboard/flujo/:boardId" element={<BoardFlow />} />
            <Route path="/dashboard/uml/:boardId" element={<BoardDiagrams />} />
            <Route path="/dashboard/uml/:boardId/:diagramId" element={<BoardDiagrams />} />
            <Route path="/profile" element={<Profile />} />
          </Route>

          <Route
            path="/"
            element={<Navigate to="/login" replace />}
          />

          <Route
            path="*"
            element={<Navigate to="/login" replace />}
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default AppRoutes

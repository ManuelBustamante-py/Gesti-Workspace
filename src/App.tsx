import AppRoutes from './routes/AppRoutes'
import { AuthProvider } from './context/AuthContext'
import ErrorBoundary from './components/ErrorBoundary'
import { ConfirmHost } from './components/ui/ConfirmDialog'

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppRoutes />
        <ConfirmHost />
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App
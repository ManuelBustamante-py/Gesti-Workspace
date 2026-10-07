import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Evita la pantalla en blanco: si un componente falla al renderizar, muestra
 * un aviso con el detalle técnico y opciones para recuperarse.
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error no controlado en la interfaz:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <main className="auth-shell">
        <section className="auth-card" role="alert">
          <p className="text-sm font-semibold tracking-wide text-[var(--accent-mint)]">GESTI · WORKSPACE</p>
          <h1 className="mt-3 text-2xl font-bold text-white">Algo salió mal</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            La pantalla encontró un error inesperado. Tus datos guardados no se perdieron; puedes reintentar o recargar la página.
          </p>
          <details className="mt-4 rounded-lg bg-black/30 p-3 text-xs text-[var(--text-muted)]">
            <summary className="cursor-pointer">Detalle técnico</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words">{error.message}</pre>
          </details>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => this.setState({ error: null })} className="btn-ghost px-4 py-2 text-sm">
              Reintentar
            </button>
            <button type="button" onClick={() => window.location.reload()} className="btn-mint-primary px-4 py-2 text-sm font-semibold">
              Recargar página
            </button>
          </div>
        </section>
      </main>
    )
  }
}

export default ErrorBoundary

import { useState } from 'react'

import {
  signInWithOAuthProvider,
  type OAuthProvider,
} from '../../services/auth'

interface OAuthProviderButtonsProps {
  actionLabel: string
  onError: (message: string) => void
}

const providers: Array<{ id: OAuthProvider; label: string }> = [
  { id: 'google', label: 'Google' },
  { id: 'github', label: 'GitHub' },
]

function ProviderLogo({ provider }: { provider: OAuthProvider }) {
  if (provider === 'google') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="oauth-provider-logo">
        <path fill="#4285f4" d="M21.8 12.23c0-.7-.06-1.37-.18-2H12v3.79h5.5a4.7 4.7 0 0 1-2.04 3.08v2.52h3.3c1.93-1.78 3.04-4.4 3.04-7.39Z" />
        <path fill="#34a853" d="M12 22c2.76 0 5.08-.91 6.77-2.48l-3.3-2.52c-.91.61-2.07.97-3.47.97-2.67 0-4.94-1.8-5.75-4.22H2.84v2.6A10.22 10.22 0 0 0 12 22Z" />
        <path fill="#fbbc05" d="M6.25 13.75a6.13 6.13 0 0 1 0-3.5v-2.6H2.84a10.01 10.01 0 0 0 0 8.7l3.41-2.6Z" />
        <path fill="#ea4335" d="M12 6.03c1.5 0 2.85.52 3.91 1.54l2.93-2.93C17.07 2.96 14.76 2 12 2a10.22 10.22 0 0 0-9.16 5.65l3.41 2.6C7.06 7.83 9.33 6.03 12 6.03Z" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="oauth-provider-logo">
      <path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.1.68-.22.68-.48v-1.7c-2.78.61-3.37-1.18-3.37-1.18-.45-1.15-1.11-1.46-1.11-1.46-.91-.62.07-.61.07-.61 1 .07 1.52 1.03 1.52 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.56-1.11-4.56-4.95 0-1.1.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03A9.55 9.55 0 0 1 12 7.91a9.6 9.6 0 0 1 2.5.34c1.9-1.3 2.74-1.03 2.74-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.69 0 3.85-2.34 4.7-4.57 4.95.36.31.68.92.68 1.86v2.76c0 .27.18.59.69.48A10 10 0 0 0 12 2Z" />
    </svg>
  )
}

function OAuthProviderButtons({
  actionLabel,
  onError,
}: OAuthProviderButtonsProps) {
  const [loadingProvider, setLoadingProvider] = useState<OAuthProvider | null>(null)

  async function handleProviderLogin(provider: OAuthProvider) {
    setLoadingProvider(provider)
    onError('')

    try {
      await signInWithOAuthProvider(provider)
    } catch (error) {
      setLoadingProvider(null)
      onError(
        error instanceof Error
          ? error.message
          : `No se pudo ${actionLabel.toLowerCase()} con ${provider}.`,
      )
    }
  }

  return (
    <section className="oauth-providers" aria-label={actionLabel}>
      <p className="oauth-providers-heading">{actionLabel}</p>
      <div className="oauth-providers-grid">
        {providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            className="oauth-provider-button"
            disabled={loadingProvider !== null}
            onClick={() => handleProviderLogin(provider.id)}
          >
            <ProviderLogo provider={provider.id} />
            <span>
              {loadingProvider === provider.id
                ? 'Conectando...'
                : provider.label}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

export default OAuthProviderButtons

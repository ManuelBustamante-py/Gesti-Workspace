export interface ConfirmOptions {
  title?: string
  confirmLabel?: string
  /** Acción destructiva: el botón de confirmar se muestra en rojo. */
  danger?: boolean
}

export type ConfirmRequest = ConfirmOptions & { message: string; resolve: (value: boolean) => void }

let pending: ConfirmRequest | null = null
const listeners = new Set<(request: ConfirmRequest | null) => void>()

export function publishConfirm(request: ConfirmRequest | null) {
  pending = request
  for (const listener of listeners) listener(request)
}

export const pendingConfirm = () => pending

/** Suscribe al diálogo montado; devuelve la función para desuscribirse. */
export function subscribeConfirm(listener: (request: ConfirmRequest | null) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Sustituye a window.confirm. El diálogo nativo deja de mostrarse (y devuelve
 * false sin preguntar) si el usuario marca «no permitir más diálogos» en el
 * navegador; este diálogo es de la app y siempre aparece.
 */
export function confirmAction(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  // Sin diálogo montado (p. ej. en pruebas) se conserva el comportamiento nativo.
  if (!listeners.size) return Promise.resolve(window.confirm(message))
  pending?.resolve(false)
  return new Promise((resolve) => publishConfirm({ ...options, message, resolve }))
}

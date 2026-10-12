import { useEffect, useState } from 'react'

import Modal from './Modal'

interface ConfirmOptions {
  title?: string
  confirmLabel?: string
  /** Acción destructiva: el botón de confirmar se muestra en rojo. */
  danger?: boolean
}

type Request = ConfirmOptions & { message: string; resolve: (value: boolean) => void }

let pending: Request | null = null
const listeners = new Set<(request: Request | null) => void>()

function publish(request: Request | null) {
  pending = request
  for (const listener of listeners) listener(request)
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
  return new Promise((resolve) => publish({ ...options, message, resolve }))
}

/** Monta una sola vez, en la raíz de la app. */
export function ConfirmHost() {
  const [request, setRequest] = useState<Request | null>(pending)
  useEffect(() => {
    listeners.add(setRequest)
    return () => {
      listeners.delete(setRequest)
    }
  }, [])
  if (!request) return null
  const answer = (value: boolean) => {
    request.resolve(value)
    publish(null)
  }
  return (
    <Modal
      title={request.title ?? (request.danger ? 'Confirmar eliminación' : 'Confirmar')}
      size="md"
      onClose={() => answer(false)}
      footer={
        <>
          <button type="button" onClick={() => answer(false)} className="btn-ghost px-4 py-2 text-sm">Cancelar</button>
          <button type="button" onClick={() => answer(true)} className={request.danger ? 'btn-danger px-4 py-2 text-sm font-semibold' : 'btn-mint-primary px-4 py-2 text-sm font-semibold'}>
            {request.confirmLabel ?? (request.danger ? 'Eliminar' : 'Continuar')}
          </button>
        </>
      }
    >
      <p className="whitespace-pre-line text-sm text-[var(--text-main)]">{request.message}</p>
    </Modal>
  )
}

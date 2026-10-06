import { useEffect, useRef } from 'react'

import type { MessageToast } from '../../hooks/useMessageNotifications'
import { commentKindIcons, commentKindLabels } from '../../services/taskComments'

interface ToastStackProps {
  toasts: MessageToast[]
  onOpen: (toast: MessageToast) => void
  onDismiss: (commentId: string) => void
}

const AUTO_DISMISS_MS = 8000

function Toast({ toast, onOpen, onDismiss }: { toast: MessageToast; onOpen: () => void; onDismiss: () => void }) {
  // El temporizador se crea una sola vez aunque el padre vuelva a renderizar.
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])
  useEffect(() => {
    const timer = setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [])

  const title = toast.kind === 'comment' ? 'Nuevo comentario' : commentKindLabels[toast.kind]

  return (
    <li className={`toast toast-${toast.kind}`}>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[var(--text-muted)]">
          {commentKindIcons[toast.kind]} {title} · <span className="text-[var(--text-main)]">{toast.board_name}</span>
        </p>
        <p className="mt-0.5 truncate text-sm text-[var(--text-main)]">
          <strong>{toast.author_name}</strong> en «{toast.task_title}»
        </p>
        <p className="truncate text-xs text-[var(--text-muted)]">{toast.body || '🖼 Imagen adjunta'}</p>
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <button type="button" onClick={onOpen} className="btn-mint-primary px-3 py-1 text-xs font-semibold">Ver</button>
        <button type="button" onClick={onDismiss} className="text-xs text-[var(--text-muted)] hover:text-white" aria-label="Cerrar aviso">
          Cerrar
        </button>
      </div>
    </li>
  )
}

/** Avisos de mensajes nuevos; se anuncian a lectores de pantalla sin interrumpir. */
function ToastStack({ toasts, onOpen, onDismiss }: ToastStackProps) {
  return (
    <ul className="toast-stack" aria-live="polite" aria-label="Avisos">
      {toasts.map((toast) => (
        <Toast
          key={toast.commentId}
          toast={toast}
          onOpen={() => onOpen(toast)}
          onDismiss={() => onDismiss(toast.commentId)}
        />
      ))}
    </ul>
  )
}

export default ToastStack

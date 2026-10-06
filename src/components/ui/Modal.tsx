import { useEffect, useId, useRef, type ReactNode } from 'react'

interface ModalProps {
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg' | 'xl'
  /** Enfoca el primer campo al abrir (formularios). Si no, se enfoca el diálogo: no abre el teclado en móvil. */
  focusFirstField?: boolean
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Diálogo accesible: role="dialog", cierre con Escape o clic fuera, foco
 * inicial dentro, Tab contenido y foco devuelto al cerrar. En móvil ocupa la
 * pantalla completa (ver .modal-panel en index.css).
 */
function Modal({ title, subtitle, onClose, children, footer, size = 'lg', focusFirstField = false }: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  // Solo cuenta al abrir: el enfoque inicial no se repite si cambia después.
  const focusFirstFieldRef = useRef(focusFirstField)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const firstField = focusFirstFieldRef.current ? panel?.querySelector<HTMLElement>('input, select, textarea') : null
    ;(firstField ?? panel)?.focus()
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
      previouslyFocused?.focus?.()
    }
  }, [])

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={panelRef}
        className={`modal-panel modal-panel-${size} glass-panel`}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="modal-header">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-white sm:text-xl">
              {title}
            </h2>
            {subtitle && <div className="mt-1 text-sm text-[var(--text-muted)]">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className="modal-close" aria-label="Cerrar">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </section>
    </div>
  )
}

export default Modal

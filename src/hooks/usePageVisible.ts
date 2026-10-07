import { useEffect, useState } from 'react'

/**
 * false cuando la pestaña lleva `graceMs` oculta. Sirve para cerrar los canales
 * Realtime de pestañas olvidadas en segundo plano; un cambio rápido de pestaña
 * no desconecta ni recarga nada.
 */
export function usePageVisible(graceMs = 60_000) {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const update = () => {
      if (timer) clearTimeout(timer)
      timer = null
      if (document.hidden) {
        timer = setTimeout(() => setVisible(false), graceMs)
      } else {
        setVisible(true)
      }
    }
    document.addEventListener('visibilitychange', update)
    return () => {
      document.removeEventListener('visibilitychange', update)
      if (timer) clearTimeout(timer)
    }
  }, [graceMs])

  return visible
}

import { useCallback, useEffect, useRef, useState } from 'react'

import { supabase } from '../lib/supabase'
import {
  getMessagePreview,
  getUnreadMessageCounts,
  type MessageCounts,
  type MessagePreview,
} from '../services/boardMessages'
import { commentKindLabels } from '../services/taskComments'

export type MessageToast = MessagePreview & { commentId: string }

const browserNotificationsAvailable = typeof window !== 'undefined' && 'Notification' in window

function showBrowserNotification(preview: MessagePreview, onClick: () => void) {
  if (!browserNotificationsAvailable || Notification.permission !== 'granted') return
  const kind = preview.kind === 'comment' ? 'Nuevo comentario' : commentKindLabels[preview.kind]
  const notification = new Notification(`${kind} · ${preview.board_name}`, {
    body: `${preview.author_name} en «${preview.task_title}»: ${preview.body || '🖼 Imagen adjunta'}`.slice(0, 180),
    tag: `gesti-board-${preview.board_id}`,
  })
  notification.onclick = () => {
    window.focus()
    onClick()
    notification.close()
  }
}

// Realtime acepta como máximo 100 valores en un filtro «in».
const MAX_FILTERED_BOARDS = 100

/**
 * Contadores de mensajes no leídos por tablero y avisos de comentarios nuevos
 * de otras personas. Los tableros silenciados no generan avisos ni contador.
 * Sigue activo con la pestaña oculta: de él salen los avisos del navegador.
 */
export function useMessageNotifications(
  userId: string | undefined,
  boardIds: string[],
  onOpen: (toast: MessageToast) => void,
) {
  // Clave estable: renombrar un tablero no vuelve a suscribir el canal.
  const boardKey = [...boardIds].sort().join(',')
  const [counts, setCounts] = useState<MessageCounts>({})
  const [supported, setSupported] = useState(true)
  const [toasts, setToasts] = useState<MessageToast[]>([])
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    browserNotificationsAvailable ? Notification.permission : 'unsupported',
  )
  const onOpenRef = useRef(onOpen)
  useEffect(() => {
    onOpenRef.current = onOpen
  }, [onOpen])

  const refresh = useCallback(async () => {
    try {
      const result = await getUnreadMessageCounts()
      setCounts(result.counts)
      setSupported(result.supported)
    } catch (err) {
      console.error('Error al cargar los mensajes no leídos:', err)
    }
  }, [])

  const dismissToast = useCallback((commentId: string) => {
    setToasts((current) => current.filter((toast) => toast.commentId !== commentId))
  }, [])

  useEffect(() => {
    // Sin tableros (o mientras cargan) no hay mensajes que contar ni escuchar.
    if (!userId || !boardKey) return
    void refresh()

    let timer: ReturnType<typeof setTimeout> | null = null
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void refresh(), 400)
    }

    // Solo comentarios de los tableros propios: Realtime no evalúa RLS del resto.
    const ids = boardKey.split(',')
    const insertFilter = ids.length <= MAX_FILTERED_BOARDS ? { filter: `board_id=in.(${boardKey})` } : {}

    const channel = supabase
      .channel(`messages-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_comments', ...insertFilter }, async (payload) => {
        const comment = payload.new as { id?: string; author_id?: string }
        if (!comment.id || comment.author_id === userId) return
        scheduleRefresh()
        try {
          const preview = await getMessagePreview(comment.id)
          if (!preview || preview.muted) return
          const toast = { ...preview, commentId: comment.id }
          // Máximo 3 avisos en pantalla para no saturar en equipos grandes.
          setToasts((current) => [toast, ...current].slice(0, 3))
          if (document.hidden) showBrowserNotification(preview, () => onOpenRef.current(toast))
        } catch (err) {
          console.error('Error al preparar el aviso del mensaje:', err)
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'task_comments' }, scheduleRefresh)
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [boardKey, refresh, userId])

  async function requestBrowserPermission() {
    if (!browserNotificationsAvailable) return
    setPermission(await Notification.requestPermission())
  }

  return {
    counts,
    setCounts,
    supported,
    refresh,
    toasts,
    dismissToast,
    browserPermission: permission,
    requestBrowserPermission,
  }
}

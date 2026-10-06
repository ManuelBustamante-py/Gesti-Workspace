import { useCallback, useEffect, useState } from 'react'

import Modal from '../ui/Modal'
import { supabase } from '../../lib/supabase'
import { initials } from '../../domain/people'
import type { Board } from '../../services/boards'
import {
  getBoardMessages,
  markBoardMessagesRead,
  MESSAGES_PAGE_SIZE,
  type BoardMessage,
} from '../../services/boardMessages'
import { commentKindIcons, commentKindLabels, type CommentKind } from '../../services/taskComments'

type KindFilter = 'all' | CommentKind

interface MessagesPanelProps {
  board: Board
  numbers: Map<string, number>
  muted: boolean
  browserPermission: NotificationPermission | 'unsupported'
  onRequestBrowserPermission: () => void
  onToggleMuted: (muted: boolean) => Promise<void>
  onMarkedRead: () => void
  onOpenTask: (taskId: string) => void
  onClose: () => void
}

const FILTERS: Array<[KindFilter, string]> = [
  ['all', 'Todos'],
  ['issue', `${commentKindIcons.issue} Problemas`],
  ['workaround', `${commentKindIcons.workaround} Parches`],
  ['comment', `${commentKindIcons.comment} Comentarios`],
]

const dateTime = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Bandeja de mensajes del tablero: comentarios, problemas y parches de todas sus actividades. */
function MessagesPanel({
  board,
  numbers,
  muted,
  browserPermission,
  onRequestBrowserPermission,
  onToggleMuted,
  onMarkedRead,
  onOpenTask,
  onClose,
}: MessagesPanelProps) {
  const [messages, setMessages] = useState<BoardMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<KindFilter>('all')
  const [savingMute, setSavingMute] = useState(false)

  const loadFirstPage = useCallback(async () => {
    try {
      const page = await getBoardMessages(board.id)
      setMessages(page)
      setHasMore(page.length === MESSAGES_PAGE_SIZE)
      setError('')
      // Se marca como leído después de cargar: los «Nuevo» de esta vista se conservan.
      await markBoardMessagesRead(board.id)
      onMarkedRead()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los mensajes.')
    } finally {
      setLoading(false)
    }
  }, [board.id, onMarkedRead])

  useEffect(() => {
    void loadFirstPage()
    let timer: ReturnType<typeof setTimeout> | null = null
    const channel = supabase
      .channel(`messages-panel-${board.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments' }, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => void loadFirstPage(), 400)
      })
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [board.id, loadFirstPage])

  async function loadMore() {
    const last = messages[messages.length - 1]
    if (!last) return
    try {
      setLoadingMore(true)
      const page = await getBoardMessages(board.id, last.created_at)
      setMessages((current) => [...current, ...page.filter((item) => !current.some((existing) => existing.id === item.id))])
      setHasMore(page.length === MESSAGES_PAGE_SIZE)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar más mensajes.')
    } finally {
      setLoadingMore(false)
    }
  }

  async function toggleMuted() {
    try {
      setSavingMute(true)
      await onToggleMuted(!muted)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la configuración.')
    } finally {
      setSavingMute(false)
    }
  }

  const visible = filter === 'all' ? messages : messages.filter((message) => message.kind === filter)

  return (
    <Modal
      title={<>✉ Mensajes · {board.name}</>}
      subtitle="Comentarios, problemas y parches publicados en las actividades de este tablero."
      onClose={onClose}
    >
      <div className="messages-settings">
        <button
          type="button"
          role="switch"
          aria-checked={muted}
          onClick={() => void toggleMuted()}
          disabled={savingMute}
          className={`mute-switch ${muted ? 'mute-switch-on' : ''}`}
        >
          <span className="mute-switch-track" aria-hidden="true"><span className="mute-switch-thumb" /></span>
          <span>
            <strong className="block text-sm text-[var(--text-main)]">{muted ? '🔕 Tablero silenciado' : '🔔 Notificaciones activas'}</strong>
            <span className="block text-xs text-[var(--text-muted)]">
              {muted ? 'No recibirás avisos ni contador. Los mensajes siguen aquí.' : 'Recibes un aviso cuando alguien publica en este tablero.'}
            </span>
          </span>
        </button>
        {browserPermission === 'default' && !muted && (
          <button type="button" onClick={onRequestBrowserPermission} className="btn-ghost px-3 py-2 text-xs">
            Avisarme también con la pestaña en segundo plano
          </button>
        )}
        {browserPermission === 'denied' && (
          <p className="text-xs text-[var(--text-muted)]">
            El navegador bloquea las notificaciones de este sitio; solo verás los avisos dentro de la aplicación.
          </p>
        )}
      </div>

      <div className="filter-chips mt-4" role="group" aria-label="Filtrar mensajes por tipo">
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            className={`filter-chip ${filter === value ? 'filter-chip-active' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="alert-error mt-3 rounded-lg p-3 text-sm" role="alert">{error}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-[var(--text-muted)]">Cargando mensajes...</p>
      ) : visible.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-[var(--text-muted)]">
          {messages.length === 0
            ? 'Aún no hay mensajes. Se publican desde el detalle de cada actividad.'
            : 'No hay mensajes de este tipo en lo cargado.'}
        </p>
      ) : (
        <ul className="message-list mt-4">
          {visible.map((message) => (
            <li key={message.id}>
              <button
                type="button"
                onClick={() => onOpenTask(message.task_id)}
                className={`message-item message-item-${message.kind} ${message.is_unread ? 'message-item-unread' : ''}`}
              >
                {message.author_avatar_url ? (
                  <img src={message.author_avatar_url} alt="" className="assignee-avatar assignee-avatar-inline" />
                ) : (
                  <span className="assignee-avatar assignee-avatar-inline" aria-hidden="true">{initials(message.author_name)}</span>
                )}
                <span className="min-w-0 flex-1 text-left">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--text-muted)]">
                    <strong className="text-sm text-[var(--text-main)]">{message.author_name}</strong>
                    {message.kind !== 'comment' && (
                      <span className={`comment-kind comment-kind-${message.kind}`}>
                        {commentKindIcons[message.kind]} {commentKindLabels[message.kind]}
                      </span>
                    )}
                    <time dateTime={message.created_at}>{dateTime.format(new Date(message.created_at))}</time>
                    {message.is_unread && <span className="message-new">Nuevo</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-[var(--accent-ui)]">
                    #{numbers.get(message.task_id) ?? '?'} · {message.task_title}
                  </span>
                  <span className="message-body">
                    {message.body || 'Imagen adjunta'}
                    {message.attachment_count > 0 && ` · 🖼 ${message.attachment_count}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasMore && !loading && (
        <div className="mt-4 text-center">
          <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="btn-ghost px-4 py-2 text-sm">
            {loadingMore ? 'Cargando...' : 'Cargar mensajes anteriores'}
          </button>
        </div>
      )}
    </Modal>
  )
}

export default MessagesPanel

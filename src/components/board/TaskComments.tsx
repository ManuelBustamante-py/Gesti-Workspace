import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react'

import { supabase } from '../../lib/supabase'
import { formatBytes, MAX_ATTACHMENTS } from '../../lib/imageCompression'
import { initials } from '../../domain/people'
import {
  commentKindIcons,
  commentKindLabels,
  createTaskComment,
  deleteTaskComment,
  getAttachmentUrls,
  getTaskComments,
  updateTaskComment,
  type CommentKind,
  type TaskComment,
} from '../../services/taskComments'

interface TaskCommentsProps {
  boardId: string
  taskId: string
  currentUserId: string | undefined
  /** Propietario y editores comentan; los lectores solo leen. */
  canComment: boolean
  isBoardOwner: boolean
}

type PendingImage = { id: string; file: File; previewUrl: string }

const KINDS: CommentKind[] = ['comment', 'issue', 'workaround']

const relativeTime = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })

function timeAgo(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000)
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60],
  ]
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relativeTime.format(Math.round(seconds / size), unit)
  }
  return 'hace un momento'
}

function errorText(err: unknown, fallback: string) {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return fallback
}

function TaskComments({ boardId, taskId, currentUserId, canComment, isBoardOwner }: TaskCommentsProps) {
  const [comments, setComments] = useState<TaskComment[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<CommentKind>('comment')
  const [images, setImages] = useState<PendingImage[]>([])
  const [posting, setPosting] = useState(false)
  const [editing, setEditing] = useState<{ id: string; body: string; kind: CommentKind } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imagesRef = useRef<PendingImage[]>([])

  const load = useCallback(async () => {
    try {
      const loaded = await getTaskComments(taskId)
      setComments(loaded)
      const paths = loaded.flatMap((comment) => comment.attachments.map((attachment) => attachment.path))
      setUrls(await getAttachmentUrls(paths))
      setError('')
    } catch (err) {
      setError(errorText(err, 'No se pudieron cargar los comentarios.'))
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel(`task-comments-${taskId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments', filter: `task_id=eq.${taskId}` }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load, taskId])

  // Libera las vistas previas al cerrar el diálogo.
  useEffect(() => {
    imagesRef.current = images
  }, [images])
  useEffect(() => () => imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl)), [])

  function addFiles(files: File[]) {
    const accepted = files.filter((file) => file.type.startsWith('image/'))
    if (accepted.length < files.length) setError('Solo se pueden adjuntar imágenes.')
    setImages((current) => {
      const room = MAX_ATTACHMENTS - current.length
      if (accepted.length > room) setError(`Puedes adjuntar hasta ${MAX_ATTACHMENTS} imágenes por comentario.`)
      return [
        ...current,
        ...accepted.slice(0, Math.max(room, 0)).map((file) => ({
          id: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
        })),
      ]
    })
  }

  function removeImage(id: string) {
    setImages((current) => {
      const image = current.find((item) => item.id === id)
      if (image) URL.revokeObjectURL(image.previewUrl)
      return current.filter((item) => item.id !== id)
    })
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'))
    if (pasted.length > 0) {
      event.preventDefault()
      addFiles(pasted)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!currentUserId) return
    try {
      setPosting(true)
      setError('')
      await createTaskComment({ boardId, taskId, authorId: currentUserId, kind, body, files: images.map((image) => image.file) })
      images.forEach((image) => URL.revokeObjectURL(image.previewUrl))
      setImages([])
      setBody('')
      setKind('comment')
      await load()
    } catch (err) {
      setError(errorText(err, 'No se pudo publicar el comentario.'))
    } finally {
      setPosting(false)
    }
  }

  async function handleSaveEdit() {
    if (!editing) return
    try {
      await updateTaskComment(editing.id, editing.body, editing.kind)
      setEditing(null)
      await load()
    } catch (err) {
      setError(errorText(err, 'No se pudo editar el comentario.'))
    }
  }

  async function handleDelete(comment: TaskComment) {
    if (!window.confirm('¿Eliminar este comentario y sus imágenes?')) return
    try {
      await deleteTaskComment(comment)
      setComments((current) => current.filter((item) => item.id !== comment.id))
    } catch (err) {
      setError(errorText(err, 'No se pudo eliminar el comentario.'))
    }
  }

  return (
    <section aria-labelledby={`comments-${taskId}`}>
      <h3 id={`comments-${taskId}`} className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Comentarios {comments.length > 0 && `· ${comments.length}`}
      </h3>

      {error && <p className="alert-error mb-3 rounded-lg p-3 text-sm" role="alert">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--text-muted)]">Cargando comentarios...</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          Aún no hay comentarios.{!canComment && ' Los lectores pueden leerlos, pero no publicar.'}
        </p>
      ) : (
        <ol className="comment-list">
          {comments.map((comment) => {
            const isAuthor = comment.author_id === currentUserId
            const isEditing = editing?.id === comment.id
            return (
              <li key={comment.id} className={`comment comment-${comment.kind}`}>
                <div className="flex items-start gap-3">
                  {comment.author_avatar_url ? (
                    <img src={comment.author_avatar_url} alt="" className="assignee-avatar assignee-avatar-inline" />
                  ) : (
                    <span className="assignee-avatar assignee-avatar-inline" aria-hidden="true">{initials(comment.author_name)}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <strong className="text-[var(--text-main)]">{comment.author_name}</strong>
                      {isAuthor && <span className="text-xs text-[var(--text-muted)]">(tú)</span>}
                      {comment.kind !== 'comment' && (
                        <span className={`comment-kind comment-kind-${comment.kind}`}>
                          {commentKindIcons[comment.kind]} {commentKindLabels[comment.kind]}
                        </span>
                      )}
                      <time className="text-xs text-[var(--text-muted)]" dateTime={comment.created_at} title={new Date(comment.created_at).toLocaleString('es-CL')}>
                        {timeAgo(comment.created_at)}
                        {comment.updated_at !== comment.created_at && ' · editado'}
                      </time>
                    </p>

                    {isEditing ? (
                      <div className="mt-2 space-y-2">
                        <select
                          value={editing.kind}
                          onChange={(event) => setEditing({ ...editing, kind: event.target.value as CommentKind })}
                          className="control-input rounded-lg px-2 py-1.5 text-sm"
                          aria-label="Tipo de comentario"
                        >
                          {KINDS.map((value) => <option key={value} value={value}>{commentKindLabels[value]}</option>)}
                        </select>
                        <textarea
                          value={editing.body}
                          onChange={(event) => setEditing({ ...editing, body: event.target.value })}
                          rows={3}
                          maxLength={4000}
                          className="control-input w-full rounded-lg px-3 py-2 text-sm"
                          aria-label="Editar comentario"
                        />
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setEditing(null)} className="btn-ghost px-3 py-1.5 text-xs">Cancelar</button>
                          <button type="button" onClick={() => void handleSaveEdit()} className="btn-mint-primary px-3 py-1.5 text-xs font-semibold">Guardar</button>
                        </div>
                      </div>
                    ) : (
                      comment.body && <p className="comment-body">{comment.body}</p>
                    )}

                    {comment.attachments.length > 0 && (
                      <ul className="comment-images">
                        {comment.attachments.map((attachment, index) => (
                          <li key={attachment.path}>
                            {urls[attachment.path] ? (
                              <a href={urls[attachment.path]} target="_blank" rel="noopener noreferrer" title="Abrir imagen en tamaño completo">
                                <img
                                  src={urls[attachment.path]}
                                  alt={`Imagen ${index + 1} adjunta por ${comment.author_name}`}
                                  width={attachment.width}
                                  height={attachment.height}
                                  loading="lazy"
                                />
                              </a>
                            ) : (
                              <span className="comment-image-missing">Imagen no disponible</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {!isEditing && (isAuthor || isBoardOwner) && (
                      <div className="mt-2 flex gap-3 text-xs">
                        {isAuthor && canComment && (
                          <button type="button" onClick={() => setEditing({ id: comment.id, body: comment.body, kind: comment.kind })} className="text-[var(--text-muted)] hover:text-white">
                            Editar
                          </button>
                        )}
                        <button type="button" onClick={() => void handleDelete(comment)} className="text-[var(--priority-high)] hover:underline">
                          Eliminar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {canComment && (
        <form onSubmit={handleSubmit} className="comment-composer">
          <label className="sr-only" htmlFor={`comment-body-${taskId}`}>Nuevo comentario</label>
          <textarea
            id={`comment-body-${taskId}`}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onPaste={handlePaste}
            rows={3}
            maxLength={4000}
            placeholder="Escribe un comentario. Puedes pegar capturas de pantalla con Ctrl+V."
            className="control-input w-full rounded-lg px-3 py-2 text-sm"
          />

          {images.length > 0 && (
            <ul className="comment-images comment-images-pending">
              {images.map((image) => (
                <li key={image.id}>
                  <img src={image.previewUrl} alt={`Vista previa de ${image.file.name}`} />
                  <span className="comment-image-size">{formatBytes(image.file.size)}</span>
                  <button type="button" onClick={() => removeImage(image.id)} className="comment-image-remove" aria-label={`Quitar ${image.file.name}`}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="comment-composer-actions">
            <select value={kind} onChange={(event) => setKind(event.target.value as CommentKind)} className="control-input rounded-lg px-2 py-2 text-sm" aria-label="Tipo de comentario">
              {KINDS.map((value) => <option key={value} value={value}>{commentKindIcons[value]} {commentKindLabels[value]}</option>)}
            </select>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={images.length >= MAX_ATTACHMENTS}
              className="btn-ghost px-3 py-2 text-sm disabled:opacity-50"
            >
              🖼 Imagen ({images.length}/{MAX_ATTACHMENTS})
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                addFiles([...(event.target.files ?? [])])
                event.target.value = ''
              }}
            />
            <button type="submit" disabled={posting || (!body.trim() && images.length === 0)} className="btn-mint-primary px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {posting ? (images.length ? 'Comprimiendo y subiendo...' : 'Publicando...') : 'Publicar'}
            </button>
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            Las imágenes se convierten a WebP (máx. 1600 px y 1 MB) antes de subirse a un almacenamiento privado.
          </p>
        </form>
      )}
    </section>
  )
}

export default TaskComments

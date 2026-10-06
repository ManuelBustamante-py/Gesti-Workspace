import { supabase } from '../lib/supabase'
import { compressImage, MAX_ATTACHMENTS } from '../lib/imageCompression'
import { NO_PERMISSION_MESSAGE } from './tasks'

export type CommentKind = 'comment' | 'issue' | 'workaround'

export const commentKindLabels: Record<CommentKind, string> = {
  comment: 'Comentario',
  issue: 'Problema',
  workaround: 'Parche temporal',
}

export const commentKindIcons: Record<CommentKind, string> = {
  comment: '💬',
  issue: '⚠',
  workaround: '🩹',
}

export type CommentAttachment = {
  path: string
  type: string
  width: number
  height: number
  size: number
}

export interface TaskComment {
  id: string
  task_id: string
  author_id: string
  kind: CommentKind
  body: string
  attachments: CommentAttachment[]
  created_at: string
  updated_at: string
  author_name: string
  author_username: string | null
  author_avatar_url: string | null
}

/** Totales por tarea: comentarios y avisos (problemas o parches temporales). */
export type CommentStats = Record<string, { total: number; alerts: number }>

const BUCKET = 'task-attachments'
const MISSING_FUNCTION = 'PGRST202'

export async function getTaskComments(taskId: string) {
  const { data, error } = await supabase.rpc('get_task_comments', { target_task_id: taskId })
  if (error) throw error
  return (data ?? []) as TaskComment[]
}

export async function getBoardCommentStats(boardId: string) {
  const { data, error } = await supabase.rpc('get_board_comment_stats', { target_board_id: boardId })
  if (error) {
    if (error.code === MISSING_FUNCTION) return { stats: {} as CommentStats, supported: false }
    throw error
  }
  const stats: CommentStats = {}
  for (const row of (data ?? []) as Array<{ task_id: string; total: number; alerts: number }>) {
    stats[row.task_id] = { total: row.total, alerts: row.alerts }
  }
  return { stats, supported: true }
}

/** URLs firmadas temporales: el bucket es privado. */
export async function getAttachmentUrls(paths: string[]) {
  if (paths.length === 0) return {} as Record<string, string>
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 60 * 60)
  if (error) throw error
  const urls: Record<string, string> = {}
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) urls[item.path] = item.signedUrl
  }
  return urls
}

export async function createTaskComment({
  boardId,
  taskId,
  authorId,
  kind,
  body,
  files,
}: {
  boardId: string
  taskId: string
  authorId: string
  kind: CommentKind
  body: string
  files: File[]
}) {
  const text = body.trim()
  if (!text && files.length === 0) {
    throw new Error('Escribe un comentario o adjunta una imagen.')
  }
  if (text.length > 4000) {
    throw new Error('El comentario no puede superar los 4000 caracteres.')
  }
  if (files.length > MAX_ATTACHMENTS) {
    throw new Error(`Puedes adjuntar hasta ${MAX_ATTACHMENTS} imágenes por comentario.`)
  }

  // Se comprimen todas antes de subir nada, para fallar pronto.
  const images = await Promise.all(files.map(compressImage))
  const uploaded: string[] = []

  try {
    const attachments: CommentAttachment[] = []
    for (const image of images) {
      const extension = image.type === 'image/webp' ? 'webp' : 'jpg'
      const path = `${boardId}/${taskId}/${authorId}/${crypto.randomUUID()}.${extension}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, image.blob, {
        contentType: image.type,
        cacheControl: '31536000',
        upsert: false,
      })
      if (error) throw error
      uploaded.push(path)
      attachments.push({ path, type: image.type, width: image.width, height: image.height, size: image.blob.size })
    }

    const { error } = await supabase
      .from('task_comments')
      .insert({ task_id: taskId, author_id: authorId, kind, body: text, attachments })
    if (error) throw error
  } catch (error) {
    // Sin comentario no deben quedar archivos huérfanos.
    if (uploaded.length > 0) {
      await supabase.storage.from(BUCKET).remove(uploaded).catch(() => undefined)
    }
    throw error
  }
}

export async function updateTaskComment(commentId: string, body: string, kind: CommentKind) {
  const { data, error } = await supabase
    .from('task_comments')
    .update({ body: body.trim(), kind })
    .eq('id', commentId)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error(NO_PERMISSION_MESSAGE)
}

export async function deleteTaskComment(comment: Pick<TaskComment, 'id' | 'attachments'>) {
  const { data, error } = await supabase.from('task_comments').delete().eq('id', comment.id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error(NO_PERMISSION_MESSAGE)
  const paths = comment.attachments.map((attachment) => attachment.path)
  if (paths.length > 0) {
    // El comentario ya no existe: si falla el borrado del archivo, solo queda un huérfano.
    await supabase.storage.from(BUCKET).remove(paths).catch(() => undefined)
  }
}

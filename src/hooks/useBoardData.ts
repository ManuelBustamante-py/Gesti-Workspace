import { useCallback, useEffect, useRef, useState } from 'react'

import { supabase } from '../lib/supabase'
import {
  getBoardInvitations,
  getBoardMembers,
  type BoardInvitation,
  type BoardMember,
} from '../services/boardMembers'
import { getBoardSnapshot, type BoardColumn } from '../services/columns'
import { usePageVisible } from './usePageVisible'
import { getBoardTaskAssignees, type TaskAssignments } from '../services/taskAssignees'
import { getBoardCommentStats, type CommentStats } from '../services/taskComments'
import type { Task } from '../services/tasks'

type TaskChange = { id?: string }
type AssigneeChange = { task_id?: string }

/**
 * Columnas, tareas, miembros e invitaciones de un tablero, sincronizados por
 * Realtime. No escribe nada al leer (antes se creaban columnas por defecto al
 * abrir un tablero vacío, lo que fallaba para lectores).
 */
export function useBoardData(boardId: string | null, enabled: boolean) {
  const [columns, setColumns] = useState<BoardColumn[]>([])
  const [tasksByColumn, setTasksByColumn] = useState<Record<string, Task[]>>({})
  const [members, setMembers] = useState<BoardMember[]>([])
  const [invitations, setInvitations] = useState<BoardInvitation[]>([])
  const [assignments, setAssignments] = useState<TaskAssignments>({})
  const [assigneesSupported, setAssigneesSupported] = useState(true)
  const [commentStats, setCommentStats] = useState<CommentStats>({})
  const [commentsSupported, setCommentsSupported] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const visible = usePageVisible()
  // Tablero ya cargado: al volver a la pestaña se recarga sin mostrar «Cargando».
  const loadedBoardRef = useRef<string | null>(null)
  // Mientras se arrastra una tarjeta, las recargas por Realtime esperan: si el
  // tablero cambiara bajo el cursor, el arrastre se desordenaría.
  const pausedRef = useRef(false)
  const pendingContentRef = useRef<(() => void) | null>(null)
  const taskIdsRef = useRef(new Set<string>())
  useEffect(() => {
    taskIdsRef.current = new Set(Object.values(tasksByColumn).flat().map((task) => task.id))
  }, [tasksByColumn])

  const loadContent = useCallback(async (targetBoardId: string) => {
    const [snapshot, assignees, comments] = await Promise.all([
      getBoardSnapshot(targetBoardId),
      getBoardTaskAssignees(targetBoardId),
      getBoardCommentStats(targetBoardId),
    ])
    setColumns(snapshot.columns)
    setTasksByColumn(snapshot.tasksByColumn)
    setAssignments(assignees.assignments)
    setAssigneesSupported(assignees.supported)
    setCommentStats(comments.stats)
    setCommentsSupported(comments.supported)
  }, [])

  const loadPeople = useCallback(async (targetBoardId: string) => {
    const [nextMembers, nextInvitations] = await Promise.all([
      getBoardMembers(targetBoardId),
      getBoardInvitations(targetBoardId),
    ])
    setMembers(nextMembers)
    setInvitations(nextInvitations)
  }, [])

  const reload = useCallback(async () => {
    if (!boardId) return
    try {
      await Promise.all([loadContent(boardId), loadPeople(boardId)])
      setError('')
    } catch (err) {
      console.error('Error al cargar el tablero:', err)
      setError(err instanceof Error ? err.message : 'No se pudo cargar el tablero.')
    }
  }, [boardId, loadContent, loadPeople])

  useEffect(() => {
    if (!boardId || !enabled) {
      setColumns([])
      setTasksByColumn({})
      setMembers([])
      setInvitations([])
      setAssignments({})
      loadedBoardRef.current = null
      return
    }
    // En una pestaña olvidada se cierra el canal; los datos siguen en pantalla y
    // se recargan al volver, por si cambiaron mientras tanto.
    if (!visible) return

    let cancelled = false
    if (loadedBoardRef.current !== boardId) {
      setLoading(true)
      setError('')
    }
    Promise.all([loadContent(boardId), loadPeople(boardId)])
      .then(() => {
        if (!cancelled) {
          loadedBoardRef.current = boardId
          setError('')
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Error al cargar el tablero:', err)
          setError(err instanceof Error ? err.message : 'No se pudo cargar el tablero.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    const timers: Record<'content' | 'people', ReturnType<typeof setTimeout> | null> = { content: null, people: null }
    const schedule = (kind: 'content' | 'people') => {
      if (timers[kind]) clearTimeout(timers[kind])
      timers[kind] = setTimeout(() => {
        const run = () => {
          const task = kind === 'content' ? loadContent(boardId) : loadPeople(boardId)
          task.catch((err) => console.error('Error al sincronizar el tablero en tiempo real:', err))
        }
        if (kind === 'content' && pausedRef.current) {
          pendingContentRef.current = run
          return
        }
        run()
      }, 150)
    }

    const boardFilter = `board_id=eq.${boardId}`
    const scheduleIfKnownTask = (taskId?: string) => {
      if (taskId && taskIdsRef.current.has(taskId)) schedule('content')
    }

    // Altas y cambios se filtran en el servidor por board_id. Los DELETE no
    // admiten filtro (solo traen la clave primaria): se comprueban aquí.
    const channel = supabase
      .channel(`board-live-${boardId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_columns', filter: boardFilter }, () => schedule('content'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: boardFilter }, () => schedule('content'))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tasks' }, (payload) => {
        scheduleIfKnownTask((payload.old as TaskChange).id)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments', filter: boardFilter }, () => schedule('content'))
      // Un comentario borrado solo trae su id: no se sabe de qué tarea era.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'task_comments' }, () => schedule('content'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignees', filter: boardFilter }, () => schedule('content'))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'task_assignees' }, (payload) => {
        scheduleIfKnownTask((payload.old as AssigneeChange).task_id)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_members', filter: boardFilter }, () => schedule('people'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_invitations', filter: boardFilter }, () => schedule('people'))
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.error('No se pudo conectar al canal Realtime del tablero.')
        }
      })

    return () => {
      cancelled = true
      Object.values(timers).forEach((timer) => timer && clearTimeout(timer))
      void supabase.removeChannel(channel)
    }
  }, [boardId, enabled, visible, loadContent, loadPeople])

  return {
    columns,
    setColumns,
    tasksByColumn,
    setTasksByColumn,
    members,
    invitations,
    assignments,
    setAssignments,
    assigneesSupported,
    commentStats,
    commentsSupported,
    loading,
    error,
    reload,
    reloadPeople: () => (boardId ? loadPeople(boardId) : Promise.resolve()),
    /** Pausa o reanuda las recargas de contenido por Realtime (arrastre en curso). */
    setRealtimePaused: (paused: boolean) => {
      pausedRef.current = paused
      if (!paused && pendingContentRef.current) {
        const pending = pendingContentRef.current
        pendingContentRef.current = null
        pending()
      }
    },
  }
}

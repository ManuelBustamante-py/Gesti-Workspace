import { useCallback, useEffect, useRef, useState } from 'react'

import { supabase } from '../lib/supabase'
import {
  getBoardInvitations,
  getBoardMembers,
  type BoardInvitation,
  type BoardMember,
} from '../services/boardMembers'
import { getBoardSnapshot, type BoardColumn } from '../services/columns'
import type { Task } from '../services/tasks'

type TaskChange = { id?: string; column_id?: string }

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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const columnIdsRef = useRef(new Set<string>())
  const taskIdsRef = useRef(new Set<string>())
  useEffect(() => {
    columnIdsRef.current = new Set(columns.map((column) => column.id))
    taskIdsRef.current = new Set(Object.values(tasksByColumn).flat().map((task) => task.id))
  }, [columns, tasksByColumn])

  const loadContent = useCallback(async (targetBoardId: string) => {
    const snapshot = await getBoardSnapshot(targetBoardId)
    setColumns(snapshot.columns)
    setTasksByColumn(snapshot.tasksByColumn)
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
      return
    }

    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([loadContent(boardId), loadPeople(boardId)])
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
        const task = kind === 'content' ? loadContent(boardId) : loadPeople(boardId)
        task.catch((err) => console.error('Error al sincronizar el tablero en tiempo real:', err))
      }, 150)
    }

    const channel = supabase
      .channel(`board-live-${boardId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_columns', filter: `board_id=eq.${boardId}` }, () => schedule('content'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload) => {
        // tasks no tiene board_id: solo se recarga si el cambio toca este tablero.
        const next = payload.new as TaskChange
        const previous = payload.old as TaskChange
        const touchesBoard =
          (next?.column_id && columnIdsRef.current.has(next.column_id)) ||
          (previous?.column_id && columnIdsRef.current.has(previous.column_id)) ||
          (previous?.id && taskIdsRef.current.has(previous.id))
        if (touchesBoard) schedule('content')
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_members', filter: `board_id=eq.${boardId}` }, () => schedule('people'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_invitations', filter: `board_id=eq.${boardId}` }, () => schedule('people'))
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
  }, [boardId, enabled, loadContent, loadPeople])

  return {
    columns,
    setColumns,
    tasksByColumn,
    setTasksByColumn,
    members,
    invitations,
    loading,
    error,
    reload,
    reloadPeople: () => (boardId ? loadPeople(boardId) : Promise.resolve()),
  }
}

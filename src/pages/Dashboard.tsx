import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useBoardData } from '../hooks/useBoardData'
import { useMessageNotifications, type MessageToast } from '../hooks/useMessageNotifications'
import Column, { type TaskDraft } from '../components/board/Column'
import type { TaskRelation } from '../components/board/TaskCard'
import TaskDetailDialog from '../components/board/TaskDetailDialog'
import BoardScheduleForm from '../components/dashboard/BoardScheduleForm'
import BoardStats from '../components/dashboard/BoardStats'
import CollaboratorsModal from '../components/dashboard/CollaboratorsModal'
import EditBoardModal from '../components/dashboard/EditBoardModal'
import MessagesPanel from '../components/dashboard/MessagesPanel'
import ToastStack from '../components/ui/ToastStack'
import SecurityInfoDialog from '../components/dashboard/SecurityInfoDialog'
import type { ColumnStatus } from '../domain/columnStatus'
import { createsDependencyCycle } from '../domain/dependencies'
import { prependUniqueById } from '../domain/collections'
import { activityNumbers } from '../domain/numbering'
import { boardPermissions, resolveBoardRole, roleEmotes, roleLabels, type BoardRole } from '../domain/roles'
import { computeSchedule } from '../domain/schedule'
import { boardWorkingDays } from '../domain/workSchedule'
import { assigneeNames, buildBoardPeople, type BoardPerson } from '../domain/people'
import {
  createBoard,
  deleteBoard,
  getBoards,
  type Board,
  type BoardSchedule,
  updateBoard,
  updateBoardSchedule,
} from '../services/boards'
import {
  cancelBoardInvitation,
  getBoardMembers,
  getReceivedBoardInvitations,
  inviteBoardMember,
  removeBoardMember,
  respondToBoardInvitation,
  updateBoardMemberRole,
  type BoardInvitation,
  type BoardMember,
  type BoardMemberRole,
} from '../services/boardMembers'
import { createBoardFromImport } from '../services/boardImport'
import { setBoardNotificationsMuted } from '../services/boardMessages'
import {
  downloadBoardTemplate,
  exportBoardGanttWorkbook,
  exportBoardWorkbook,
  readBoardWorkbook,
} from '../services/boardWorkbook'
import {
  createBoardColumn,
  createDefaultColumns,
  deleteBoardColumn,
  getBoardSnapshot,
  updateBoardColumn,
} from '../services/columns'
import { getProfile, syncProfileFromAuthUser, type Profile } from '../services/profiles'
import { getBoardTaskAssignees, setTaskAssignees, type TaskAssignments } from '../services/taskAssignees'
import { createTask, deleteTask, moveTask, updateTask, type Task, type TaskInput } from '../services/tasks'

type View = 'boards' | 'create' | 'requests'
type OpenTask = { id: string; mode: 'view' | 'edit' }
type AssigneeFilter = 'all' | 'mine' | 'unassigned'

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return fallback
}

function boardIdFromHash() {
  const hash = window.location.hash
  return hash.startsWith('#board-') ? hash.slice('#board-'.length) : null
}

const settingsStorageKey = (boardId: string) => `gesti:board-view-minimized:${boardId}`

function readSettingsCollapsed(boardId: string) {
  try {
    return window.localStorage.getItem(settingsStorageKey(boardId)) === 'true'
  } catch {
    return false
  }
}

function Dashboard() {
  const { user } = useAuth()

  const [boards, setBoards] = useState<Board[]>([])
  const [loadingBoards, setLoadingBoards] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [activeView, setActiveView] = useState<View>('boards')
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(boardIdFromHash)

  const [profile, setProfile] = useState<Profile | null>(null)
  const [boardOwnerProfile, setBoardOwnerProfile] = useState<Profile | null>(null)
  const [receivedInvitations, setReceivedInvitations] = useState<BoardInvitation[]>([])
  const [respondingInvitationId, setRespondingInvitationId] = useState<string | null>(null)

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [settingsCollapsed, setSettingsCollapsed] = useState(() =>
    selectedBoardId ? readSettingsCollapsed(selectedBoardId) : false,
  )
  const [collaboratorsOpen, setCollaboratorsOpen] = useState(false)
  const [securityOpen, setSecurityOpen] = useState(false)
  const [messagesOpen, setMessagesOpen] = useState(false)
  const [editingBoard, setEditingBoard] = useState<Board | null>(null)

  const [newBoard, setNewBoard] = useState({ name: '', description: '', color: '#6366f1' })
  const [creatingBoard, setCreatingBoard] = useState(false)
  const [importingBoard, setImportingBoard] = useState(false)
  const [importWarnings, setImportWarnings] = useState<string[]>([])

  const [boardError, setBoardError] = useState('')
  const [memberError, setMemberError] = useState('')
  const [newColumnName, setNewColumnName] = useState('')
  const [creatingColumn, setCreatingColumn] = useState(false)
  const [creatingTaskColumnId, setCreatingTaskColumnId] = useState<string | null>(null)
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null)
  const [savingTask, setSavingTask] = useState(false)
  const [openTask, setOpenTask] = useState<OpenTask | null>(null)
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null)
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>('all')

  const selectedBoard = boards.find((board) => board.id === selectedBoardId) ?? null
  const boardData = useBoardData(selectedBoardId, Boolean(user && selectedBoard))
  const openBoardRef = useRef<(boardId: string, taskId?: string) => void>(() => undefined)
  const messages = useMessageNotifications(user?.id, (toast) => openBoardRef.current(toast.board_id, toast.task_id))
  const { setCounts: setMessageCounts } = messages
  const selectedMessageInfo = selectedBoardId ? messages.counts[selectedBoardId] : undefined
  const totalUnreadMessages = Object.values(messages.counts).reduce(
    (total, item) => total + (item.muted ? 0 : item.unread),
    0,
  )
  const handleMessagesMarkedRead = useCallback(() => {
    if (!selectedBoardId) return
    setMessageCounts((current) => ({
      ...current,
      [selectedBoardId]: { muted: current[selectedBoardId]?.muted ?? false, unread: 0 },
    }))
  }, [selectedBoardId, setMessageCounts])
  const { columns, tasksByColumn, setColumns, setTasksByColumn, members, invitations, assignments, setAssignments } = boardData

  const role: BoardRole = resolveBoardRole(selectedBoard, user?.id, members)
  const { canEditContent, canManageBoard } = boardPermissions(role)

  const allTasks = useMemo(() => Object.values(tasksByColumn).flat(), [tasksByColumn])
  const numbers = useMemo(() => activityNumbers(columns, tasksByColumn), [columns, tasksByColumn])
  const schedule = useMemo(
    () => computeSchedule(allTasks, boardWorkingDays(selectedBoard)),
    [allTasks, selectedBoard],
  )
  const ownerProfileForBoard = selectedBoard?.owner_id === user?.id ? profile : boardOwnerProfile
  const people = useMemo<BoardPerson[]>(
    () =>
      selectedBoard
        ? buildBoardPeople(
            selectedBoard.owner_id,
            ownerProfileForBoard,
            selectedBoard.owner_id === user?.id ? user?.email ?? 'Propietario' : 'Propietario',
            members,
          )
        : [],
    [members, ownerProfileForBoard, selectedBoard, user?.email, user?.id],
  )
  const peopleById = useMemo(() => new Map(people.map((person) => [person.userId, person])), [people])
  const currentUserId = user?.id
  const assignmentCounts = useMemo(() => {
    let mine = 0
    let unassigned = 0
    allTasks.forEach((task) => {
      const assignees = assignments[task.id] ?? []
      if (currentUserId && assignees.includes(currentUserId)) mine += 1
      if (assignees.length === 0) unassigned += 1
    })
    return { mine, unassigned }
  }, [allTasks, assignments, currentUserId])
  const visibleTasksByColumn = useMemo(() => {
    if (assigneeFilter === 'all') return tasksByColumn
    const matches = (task: Task) => {
      const assignees = assignments[task.id] ?? []
      return assigneeFilter === 'mine' ? Boolean(currentUserId && assignees.includes(currentUserId)) : assignees.length === 0
    }
    return Object.fromEntries(
      Object.entries(tasksByColumn).map(([columnId, tasks]) => [columnId, tasks.filter(matches)]),
    )
  }, [assigneeFilter, assignments, tasksByColumn, currentUserId])

  const relations = useMemo(() => {
    const result = new Map<string, TaskRelation>()
    if (!selectedRelationId) return result
    const selected = allTasks.find((task) => task.id === selectedRelationId)
    if (!selected) return result
    const related = new Set([
      ...(selected.predecessor_ids ?? []),
      ...allTasks.filter((task) => (task.predecessor_ids ?? []).includes(selectedRelationId)).map((task) => task.id),
    ])
    allTasks.forEach((task) => {
      result.set(task.id, task.id === selectedRelationId ? 'selected' : related.has(task.id) ? 'related' : 'dimmed')
    })
    return result
  }, [allTasks, selectedRelationId])

  // --- Carga inicial y sincronización -------------------------------------

  const refreshBoards = useCallback(async () => {
    try {
      setBoards(await getBoards())
    } catch (err) {
      console.error('Error al cargar tableros:', err)
      setError(errorMessage(err, 'No se pudieron cargar los tableros.'))
    } finally {
      setLoadingBoards(false)
    }
  }, [])

  const refreshReceivedInvitations = useCallback(async () => {
    try {
      setReceivedInvitations(await getReceivedBoardInvitations())
    } catch (err) {
      console.error('Error al cargar solicitudes de colaboración:', err)
    }
  }, [])

  useEffect(() => {
    void refreshBoards()
  }, [refreshBoards])

  useEffect(() => {
    if (!user) return
    syncProfileFromAuthUser(user)
      .then(setProfile)
      .catch((err) => console.error('Error al cargar el perfil del dashboard:', err))
    void refreshReceivedInvitations()

    let boardsTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleBoardsRefresh = () => {
      if (boardsTimer) clearTimeout(boardsTimer)
      boardsTimer = setTimeout(() => void refreshBoards(), 200)
    }

    const channel = supabase
      .channel(`user-live-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_invitations', filter: `recipient_id=eq.${user.id}` }, () => void refreshReceivedInvitations())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_members', filter: `user_id=eq.${user.id}` }, scheduleBoardsRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boards' }, scheduleBoardsRefresh)
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') console.error('No se pudo conectar al canal Realtime del usuario.')
      })

    return () => {
      if (boardsTimer) clearTimeout(boardsTimer)
      void supabase.removeChannel(channel)
    }
  }, [user, refreshBoards, refreshReceivedInvitations])

  useEffect(() => {
    function selectBoardFromHash() {
      const boardId = boardIdFromHash()
      if (boardId) {
        setSelectedBoardId(boardId)
        setSettingsCollapsed(readSettingsCollapsed(boardId))
        setActiveView('boards')
      }
    }
    window.addEventListener('hashchange', selectBoardFromHash)
    return () => window.removeEventListener('hashchange', selectBoardFromHash)
  }, [])

  // Si el tablero abierto deja de ser accesible (borrado o acceso retirado), se cierra.
  useEffect(() => {
    if (!loadingBoards && selectedBoardId && !boards.some((board) => board.id === selectedBoardId)) {
      setSelectedBoardId(null)
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [boards, loadingBoards, selectedBoardId])

  useEffect(() => {
    if (!selectedBoard || selectedBoard.owner_id === user?.id) return
    let cancelled = false
    getProfile(selectedBoard.owner_id)
      .then((ownerProfile) => !cancelled && setBoardOwnerProfile(ownerProfile))
      .catch(() => !cancelled && setBoardOwnerProfile(null))
    return () => {
      cancelled = true
    }
  }, [selectedBoard, user?.id])

  // --- Navegación ------------------------------------------------------------

  function openBoard(boardId: string, taskId?: string) {
    setActiveView('boards')
    setSelectedBoardId(boardId)
    setSettingsCollapsed(readSettingsCollapsed(boardId))
    setOpenTask(taskId ? { id: taskId, mode: 'view' } : null)
    setMessagesOpen(false)
    setSelectedRelationId(null)
    setAssigneeFilter('all')
    setBoardError('')
    window.history.replaceState(null, '', `${window.location.pathname}#board-${boardId}`)
  }

  useEffect(() => {
    openBoardRef.current = openBoard
  })

  function closeBoard() {
    setSelectedBoardId(null)
    setMessagesOpen(false)
    setCollaboratorsOpen(false)
    setOpenTask(null)
    window.history.replaceState(null, '', window.location.pathname)
  }

  function goTo(view: View) {
    setActiveView(view)
    closeBoard()
    setMobileMenuOpen(false)
  }

  function toggleSettings() {
    if (!selectedBoardId) return
    setSettingsCollapsed((collapsed) => {
      try {
        window.localStorage.setItem(settingsStorageKey(selectedBoardId), String(!collapsed))
      } catch {
        // Preferencia opcional: sin almacenamiento disponible se mantiene en memoria.
      }
      return !collapsed
    })
  }

  // --- Tableros -------------------------------------------------------------

  async function handleCreateBoard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return
    if (!newBoard.name.trim()) {
      setError('El tablero debe tener un nombre.')
      return
    }
    try {
      setError('')
      setCreatingBoard(true)
      const board = await createBoard(newBoard.name.trim(), newBoard.description.trim(), newBoard.color, user.id)
      setBoards((current) => prependUniqueById(current, board))
      setNewBoard({ name: '', description: '', color: '#6366f1' })
      openBoard(board.id)
    } catch (err) {
      setError(errorMessage(err, 'No se pudo crear el tablero.'))
    } finally {
      setCreatingBoard(false)
    }
  }

  async function handleImportBoard(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !user) return
    try {
      setError('')
      setImportWarnings([])
      setImportingBoard(true)
      const { board: importedBoard, warnings } = await readBoardWorkbook(file)
      const board = await createBoardFromImport(importedBoard, user.id)
      setBoards((current) => prependUniqueById(current, board))
      setImportWarnings(warnings)
      setNotice(`Tablero «${board.name}» importado.`)
      openBoard(board.id)
    } catch (err) {
      setError(errorMessage(err, 'No se pudo importar el tablero.'))
    } finally {
      setImportingBoard(false)
    }
  }

  async function handleUpdateBoard(values: { name: string; description: string; color: string }) {
    if (!editingBoard) return null
    try {
      const updated = await updateBoard(editingBoard.id, values.name, values.description, values.color)
      setBoards((current) => current.map((board) => (board.id === updated.id ? updated : board)))
      setEditingBoard(null)
      return null
    } catch (err) {
      return errorMessage(err, 'No se pudo actualizar el tablero.')
    }
  }

  async function handleDeleteBoard(board: Board) {
    if (!window.confirm(`¿Eliminar el tablero «${board.name}» con todas sus columnas y tareas? Esta acción no se puede deshacer.`)) return
    try {
      setError('')
      await deleteBoard(board.id)
      setBoards((current) => current.filter((item) => item.id !== board.id))
      if (selectedBoardId === board.id) closeBoard()
    } catch (err) {
      setError(errorMessage(err, 'No se pudo eliminar el tablero.'))
    }
  }

  /** Nombres de responsables por tarea; para tableros no abiertos se consultan al exportar. */
  async function loadAssigneeNames(board: Board): Promise<Record<string, string[]>> {
    let boardAssignments: TaskAssignments = assignments
    let boardPeople = people
    if (board.id !== selectedBoardId) {
      const [loaded, boardMembers, ownerProfile] = await Promise.all([
        getBoardTaskAssignees(board.id),
        getBoardMembers(board.id),
        board.owner_id === user?.id ? Promise.resolve(profile) : getProfile(board.owner_id).catch(() => null),
      ])
      boardAssignments = loaded.assignments
      boardPeople = buildBoardPeople(board.owner_id, ownerProfile, 'Propietario', boardMembers)
    }
    return Object.fromEntries(
      Object.entries(boardAssignments).map(([taskId, userIds]) => [taskId, assigneeNames(userIds, boardPeople)]),
    )
  }

  async function withBoardContent(
    board: Board,
    action: (columns: typeof boardData.columns, tasks: Record<string, Task[]>, names: Record<string, string[]>) => Promise<void>,
  ) {
    try {
      setError('')
      setBoardError('')
      const snapshot = board.id === selectedBoardId
        ? { columns, tasksByColumn }
        : await getBoardSnapshot(board.id)
      const names = await loadAssigneeNames(board)
      await action(snapshot.columns, snapshot.tasksByColumn, names)
    } catch (err) {
      const message = errorMessage(err, 'No se pudo exportar el tablero.')
      if (board.id === selectedBoardId) setBoardError(message)
      else setError(message)
    }
  }

  async function handleSaveSchedule(nextSchedule: BoardSchedule) {
    if (!selectedBoard) return false
    try {
      setBoardError('')
      const updated = await updateBoardSchedule(selectedBoard.id, nextSchedule)
      setBoards((current) => current.map((board) => (board.id === updated.id ? updated : board)))
      setNotice('Jornada guardada. El Gantt y las exportaciones ya la usan.')
      return true
    } catch (err) {
      setBoardError(errorMessage(err, 'No se pudo actualizar la jornada del tablero.'))
      return false
    }
  }

  // --- Colaboración ---------------------------------------------------------

  async function handleInvitationResponse(invitationId: string, response: 'accept' | 'decline') {
    try {
      setRespondingInvitationId(invitationId)
      await respondToBoardInvitation(invitationId, response)
      setReceivedInvitations((current) => current.filter((invitation) => invitation.id !== invitationId))
      if (response === 'accept') await refreshBoards()
    } catch (err) {
      setError(errorMessage(err, 'No se pudo responder la solicitud.'))
    } finally {
      setRespondingInvitationId(null)
    }
  }

  async function handleInvite(email: string, memberRole: BoardMemberRole) {
    if (!selectedBoardId) return false
    try {
      setMemberError('')
      await inviteBoardMember(selectedBoardId, email, memberRole)
      await boardData.reloadPeople()
      return true
    } catch (err) {
      setMemberError(errorMessage(err, 'No se pudo invitar al colaborador.'))
      return false
    }
  }

  async function runMemberAction(action: () => Promise<void>, fallback: string) {
    try {
      setMemberError('')
      await action()
      await boardData.reloadPeople()
    } catch (err) {
      setMemberError(errorMessage(err, fallback))
    }
  }

  function handleRemoveMember(member: BoardMember) {
    const leaving = member.user_id === user?.id
    const name = member.profile?.display_name ?? member.profile?.username ?? 'este colaborador'
    if (!window.confirm(leaving ? '¿Salir de este tablero? Perderás el acceso.' : `¿Quitar el acceso de ${name}?`)) return
    void runMemberAction(async () => {
      await removeBoardMember(member.id)
      if (leaving) {
        setCollaboratorsOpen(false)
        closeBoard()
        await refreshBoards()
      }
    }, 'No se pudo quitar al colaborador.')
  }

  // --- Columnas -------------------------------------------------------------

  async function handleCreateColumn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedBoardId) return
    try {
      setBoardError('')
      setCreatingColumn(true)
      const column = await createBoardColumn(selectedBoardId, newColumnName)
      setColumns((current) => [...current, column])
      setNewColumnName('')
    } catch (err) {
      setBoardError(errorMessage(err, 'No se pudo crear la columna.'))
    } finally {
      setCreatingColumn(false)
    }
  }

  async function handleCreateDefaultColumns() {
    if (!selectedBoardId) return
    try {
      setBoardError('')
      setColumns(await createDefaultColumns(selectedBoardId))
    } catch (err) {
      setBoardError(errorMessage(err, 'No se pudieron crear las columnas.'))
    }
  }

  async function handleRenameColumn(columnId: string, name: string, status: ColumnStatus) {
    try {
      setBoardError('')
      const updated = await updateBoardColumn(columnId, name, status)
      setColumns((current) => current.map((column) => (column.id === updated.id ? updated : column)))
      return true
    } catch (err) {
      setBoardError(errorMessage(err, 'No se pudo actualizar la columna.'))
      return false
    }
  }

  async function handleDeleteColumn(columnId: string) {
    const column = columns.find((item) => item.id === columnId)
    const taskCount = tasksByColumn[columnId]?.length ?? 0
    const warning = taskCount > 0 ? ` También se eliminarán sus ${taskCount} tarea(s).` : ''
    if (!window.confirm(`¿Eliminar la columna «${column?.name ?? ''}»?${warning}`)) return
    try {
      setBoardError('')
      await deleteBoardColumn(columnId)
      setColumns((current) => current.filter((item) => item.id !== columnId))
      setTasksByColumn((current) => {
        const next = { ...current }
        delete next[columnId]
        return next
      })
    } catch (err) {
      setBoardError(errorMessage(err, 'No se pudo eliminar la columna.'))
    }
  }

  // --- Tareas ---------------------------------------------------------------

  async function handleCreateTask(columnId: string, draft: TaskDraft) {
    try {
      setBoardError('')
      setCreatingTaskColumnId(columnId)
      const task = await createTask(columnId, {
        title: draft.title,
        priority: draft.priority,
        startDate: draft.startDate || null,
        endDate: draft.endDate || null,
      })
      setTasksByColumn((current) => ({ ...current, [columnId]: [...(current[columnId] ?? []), task] }))
      return true
    } catch (err) {
      setBoardError(errorMessage(err, 'No se pudo crear la tarea.'))
      return false
    } finally {
      setCreatingTaskColumnId(null)
    }
  }

  async function handleSaveTask(task: Task, input: TaskInput & { predecessorIds: string[] }) {
    try {
      setBoardError('')
      setSavingTask(true)
      if (createsDependencyCycle(allTasks, task.id, input.predecessorIds)) {
        throw new Error('Las dependencias formarían un ciclo. Elige otra predecesora.')
      }
      const updated = await updateTask(task.id, input)
      setTasksByColumn((current) => ({
        ...current,
        [updated.column_id]: (current[updated.column_id] ?? []).map((item) => (item.id === updated.id ? updated : item)),
      }))
      return true
    } catch (err) {
      const message = errorMessage(err, 'No se pudo actualizar la tarea.')
      setBoardError(message)
      window.alert(message)
      return false
    } finally {
      setSavingTask(false)
    }
  }

  const handleMoveTask = useCallback(async (task: Task, targetColumnId: string) => {
    if (task.column_id === targetColumnId) return
    try {
      setBoardError('')
      setMovingTaskId(task.id)
      const position = (tasksByColumn[targetColumnId] ?? []).reduce((max, item) => Math.max(max, item.position + 1), 0)
      const moved = await moveTask(task.id, targetColumnId, position)
      setTasksByColumn((current) => ({
        ...current,
        [task.column_id]: (current[task.column_id] ?? []).filter((item) => item.id !== task.id),
        [targetColumnId]: [...(current[targetColumnId] ?? []), moved],
      }))
    } catch (err) {
      setBoardError(errorMessage(err, 'No se pudo mover la tarea.'))
    } finally {
      setMovingTaskId(null)
    }
  }, [setTasksByColumn, tasksByColumn])

  const handleDeleteTask = useCallback(async (task: Task) => {
    if (!window.confirm(`¿Eliminar la tarea «${task.title}»?`)) return
    try {
      setBoardError('')
      await deleteTask(task.id)
      setTasksByColumn((current) => {
        const next: Record<string, Task[]> = {}
        // La base de datos retira la tarea de las predecesoras; se refleja localmente.
        Object.entries(current).forEach(([columnId, tasks]) => {
          next[columnId] = tasks
            .filter((item) => item.id !== task.id)
            .map((item) =>
              item.predecessor_ids?.includes(task.id)
                ? { ...item, predecessor_ids: item.predecessor_ids.filter((id) => id !== task.id) }
                : item,
            )
        })
        return next
      })
      setOpenTask((current) => (current?.id === task.id ? null : current))
    } catch (err) {
      setBoardError(errorMessage(err, 'No se pudo eliminar la tarea.'))
    }
  }, [setTasksByColumn])

  async function handleToggleMuted(muted: boolean) {
    if (!selectedBoardId) return
    await setBoardNotificationsMuted(selectedBoardId, muted)
    setMessageCounts((current) => ({
      ...current,
      [selectedBoardId]: { unread: current[selectedBoardId]?.unread ?? 0, muted },
    }))
  }

  function handleOpenToast(toast: MessageToast) {
    messages.dismissToast(toast.commentId)
    openBoard(toast.board_id, toast.task_id)
  }

  async function handleSaveAssignees(task: Task, userIds: string[]) {
    const previous = assignments[task.id] ?? []
    try {
      setBoardError('')
      setAssignments((current) => ({ ...current, [task.id]: userIds }))
      await setTaskAssignees(task.id, userIds)
      return true
    } catch (err) {
      setAssignments((current) => ({ ...current, [task.id]: previous }))
      const message = errorMessage(err, 'No se pudieron asignar los responsables.')
      setBoardError(message)
      window.alert(message)
      return false
    }
  }

  const handleOpenTask = useCallback((task: Task, mode: 'view' | 'edit') => setOpenTask({ id: task.id, mode }), [])
  const handleToggleRelation = useCallback(
    (taskId: string) => setSelectedRelationId((current) => (current === taskId ? null : taskId)),
    [],
  )

  const openTaskData = openTask ? allTasks.find((task) => task.id === openTask.id) ?? null : null

  // --- Render ---------------------------------------------------------------

  const navButton = (view: View, icon: string, label: string, extra?: ReactNode) => (
    <button
      type="button"
      title={label}
      onClick={() => goTo(view)}
      aria-current={activeView === view && !selectedBoardId ? 'page' : undefined}
      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
        activeView === view && !selectedBoardId ? 'bg-[rgba(166,180,184,0.1)] text-[var(--accent-ui)]' : 'text-[var(--text-muted)] hover:bg-white/5'
      }`}
    >
      <span>
        <span aria-hidden="true">{icon} </span>
        <span className="sidebar-label">{label}</span>
      </span>
      {extra}
    </button>
  )

  return (
    <main className="min-h-screen min-w-0 bg-transparent text-[var(--text-main)] md:flex">
      <button
        type="button"
        className={`mobile-menu-button fixed z-50 ${mobileMenuOpen ? 'mobile-menu-button-open' : ''}`}
        onClick={() => setMobileMenuOpen((isOpen) => !isOpen)}
        aria-label={mobileMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
        aria-expanded={mobileMenuOpen}
      >
        {mobileMenuOpen ? '×' : '☰'}
      </button>
      {mobileMenuOpen && (
        <button type="button" className="fixed inset-0 z-20 bg-black/40 md:hidden" onClick={() => setMobileMenuOpen(false)} aria-label="Cerrar menú" />
      )}

      <aside className={`sidebar glass-panel border-b border-white/5 p-5 md:min-h-screen md:border-b-0 md:border-r ${sidebarCollapsed ? 'sidebar-collapsed md:w-19' : 'md:w-64'} ${mobileMenuOpen ? 'sidebar-mobile-open' : ''}`}>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          aria-label={sidebarCollapsed ? 'Expandir panel' : 'Colapsar panel'}
        >
          {sidebarCollapsed ? '›' : '‹'}
        </button>
        <div className="flex items-center gap-3">
          <Link to="/profile" className="flex shrink-0 rounded-xl transition-opacity hover:opacity-80" aria-label="Abrir perfil">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="h-10 w-10 rounded-xl object-cover" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-mint)] font-bold text-[var(--bg-main)]">
                {(profile?.display_name ?? user?.email ?? 'U').slice(0, 2).toUpperCase()}
              </div>
            )}
          </Link>
          <Link to="/profile" className="sidebar-label min-w-0">
            <p className="truncate font-bold">{profile?.display_name ?? 'Mi perfil'}</p>
            <p className="text-xs text-[var(--text-muted)]">Ver perfil</p>
          </Link>
        </div>
        <nav className="mt-8 space-y-2" aria-label="Navegación principal">
          {navButton(
            'boards',
            '▦',
            'Tableros',
            totalUnreadMessages > 0 && (
              <span className="nav-badge" aria-label={`${totalUnreadMessages} mensajes sin leer`}>{totalUnreadMessages}</span>
            ),
          )}
          {navButton('create', '＋', 'Crear tablero')}
          {navButton(
            'requests',
            '♢',
            'Solicitudes',
            receivedInvitations.length > 0 && (
              <span className="rounded-full bg-[var(--priority-medium)]/20 px-2 py-0.5 text-xs text-[var(--priority-medium)]">
                {receivedInvitations.length}
              </span>
            ),
          )}
          {selectedBoard && messages.supported && (
            <button
              type="button"
              title="Mensajes del tablero"
              onClick={() => {
                setMessagesOpen(true)
                setMobileMenuOpen(false)
              }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-[var(--text-muted)] hover:bg-white/5"
            >
              <span>
                <span aria-hidden="true">✉ </span>
                <span className="sidebar-label">Mensajes</span>
              </span>
              {selectedMessageInfo?.muted ? (
                <span title="Notificaciones silenciadas" aria-label="Silenciado">🔕</span>
              ) : (selectedMessageInfo?.unread ?? 0) > 0 ? (
                <span className="nav-badge" aria-label={`${selectedMessageInfo?.unread} sin leer`}>{selectedMessageInfo?.unread}</span>
              ) : null}
            </button>
          )}
          {selectedBoard && (
            <button
              type="button"
              title="Colaboradores"
              onClick={() => {
                setCollaboratorsOpen(true)
                setMobileMenuOpen(false)
              }}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--text-muted)] hover:bg-white/5"
            >
              <span aria-hidden="true">♧ </span>
              <span className="sidebar-label">Colaboradores</span>
            </button>
          )}
          <button
            type="button"
            title="Seguridad y privacidad"
            onClick={() => {
              setSecurityOpen(true)
              setMobileMenuOpen(false)
            }}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--text-muted)] hover:bg-white/5"
          >
            <span aria-hidden="true">🔒 </span>
            <span className="sidebar-label">Seguridad</span>
          </button>
        </nav>
      </aside>

      <div className="w-full min-w-0 p-4 pt-20 sm:p-5 sm:pt-20 md:p-8">
        <div className="mx-auto max-w-6xl">
          <header>
            <h1 className="text-2xl font-bold text-white sm:text-3xl">
              {selectedBoard
                ? selectedBoard.name
                : activeView === 'create'
                  ? 'Crear tablero'
                  : activeView === 'requests'
                    ? 'Solicitudes de colaboración'
                    : 'Mis tableros'}
            </h1>
            <p className="mt-2 text-slate-400">Organiza tus proyectos y tareas.</p>
          </header>

          {error && (
            <div className="alert-error mt-6 whitespace-pre-line rounded-lg p-4 text-sm" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="status-success mt-6 flex items-start justify-between gap-3 rounded-lg p-3 text-sm" role="status">
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice('')} aria-label="Cerrar aviso">✕</button>
            </div>
          )}
          {importWarnings.length > 0 && (
            <div className="alert-warning mt-4 rounded-lg p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <strong>La importación se completó con avisos:</strong>
                <button type="button" onClick={() => setImportWarnings([])} aria-label="Cerrar avisos">✕</button>
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {importWarnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          )}

          {activeView === 'create' && !selectedBoard && (
            <section className="glass-panel mt-8 rounded-2xl p-5 sm:p-6">
              <h2 className="text-xl font-semibold text-white">Crear tablero</h2>
              <form onSubmit={handleCreateBoard} className="mt-5 space-y-4">
                <label className="field-label">
                  Nombre
                  <input type="text" value={newBoard.name} onChange={(event) => setNewBoard({ ...newBoard, name: event.target.value })} required className="theme-input mt-1 w-full rounded-lg px-4 py-3" placeholder="Mi proyecto" />
                </label>
                <label className="field-label">
                  Descripción
                  <textarea value={newBoard.description} onChange={(event) => setNewBoard({ ...newBoard, description: event.target.value })} rows={3} className="theme-input mt-1 w-full resize-none rounded-lg px-4 py-3" placeholder="Descripción opcional..." />
                </label>
                <label className="field-label">
                  Color
                  <input type="color" value={newBoard.color} onChange={(event) => setNewBoard({ ...newBoard, color: event.target.value })} className="theme-input mt-1 block h-10 w-16 cursor-pointer rounded" />
                </label>
                <button type="submit" disabled={creatingBoard} className="btn-mint-primary w-full px-5 py-3 font-semibold disabled:opacity-50 sm:w-auto">
                  {creatingBoard ? 'Creando...' : 'Crear tablero'}
                </button>
              </form>
              <div className="mt-6 border-t border-white/5 pt-5">
                <p className="text-sm text-[var(--text-muted)]">También puedes crear un tablero completo desde una plantilla Excel.</p>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  <button type="button" onClick={() => void downloadBoardTemplate().catch((err) => setError(errorMessage(err, 'No se pudo generar la plantilla.')))} className="btn-ghost px-4 py-2 text-sm">
                    Descargar plantilla XLSX
                  </button>
                  <label className={`btn-action-secondary cursor-pointer border border-white/10 px-4 py-2 text-center text-sm ${importingBoard ? 'opacity-60' : ''}`}>
                    {importingBoard ? 'Importando...' : 'Importar tablero XLSX'}
                    <input type="file" accept=".xls,.xlsx" onChange={handleImportBoard} disabled={importingBoard} className="sr-only" />
                  </label>
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Columnas: N° Tarea, Columna, Tarea, Descripción, Prioridad, Fecha inicio, Fecha fin y Predecesoras. La hoja «Instrucciones» explica cómo dar formato a descripciones largas. El archivo se valida completo antes de crear nada.
                </p>
              </div>
            </section>
          )}

          {activeView === 'requests' && !selectedBoard && (
            <section className="glass-panel mt-8 rounded-2xl p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-white">Solicitudes de colaboración</h2>
                  <p className="mt-2 text-sm text-slate-400">Revisa las invitaciones recibidas para participar en otros tableros.</p>
                </div>
                <span className="rounded-full bg-[var(--accent-mint)]/10 px-3 py-1 text-xs text-[var(--accent-mint)]">
                  {receivedInvitations.length} pendiente{receivedInvitations.length === 1 ? '' : 's'}
                </span>
              </div>
              {receivedInvitations.length === 0 ? (
                <p className="mt-6 rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-400">No tienes solicitudes pendientes.</p>
              ) : (
                <ul className="mt-6 grid gap-3">
                  {receivedInvitations.map((invitation) => (
                    <li key={invitation.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-medium text-white">{invitation.board?.name ?? 'Tablero compartido'}</h3>
                          <p className="mt-1 text-sm text-slate-400">
                            Te invitaron como {roleEmotes[invitation.role]} {roleLabels[invitation.role].toLowerCase()}.
                          </p>
                        </div>
                        <span className="text-xs text-slate-500">{new Date(invitation.created_at).toLocaleDateString('es-CL')}</span>
                      </div>
                      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                        <button type="button" onClick={() => handleInvitationResponse(invitation.id, 'decline')} disabled={respondingInvitationId === invitation.id} className="btn-ghost px-4 py-2 text-sm disabled:opacity-50">
                          Rechazar
                        </button>
                        <button type="button" onClick={() => handleInvitationResponse(invitation.id, 'accept')} disabled={respondingInvitationId === invitation.id} className="btn-mint-primary px-4 py-2 text-sm font-semibold disabled:opacity-50">
                          {respondingInvitationId === invitation.id ? 'Guardando...' : 'Aceptar'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {activeView === 'boards' && !selectedBoard && (
            <section className="mt-8" aria-labelledby="boards-title">
              <h2 id="boards-title" className="text-xl font-semibold text-white">Tus tableros</h2>
              {loadingBoards ? (
                <p className="mt-4 text-slate-400">Cargando tableros...</p>
              ) : boards.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-700 p-8 text-center">
                  <p className="text-slate-400">Todavía no tienes ningún tablero.</p>
                  <button type="button" onClick={() => setActiveView('create')} className="btn-mint-primary mt-4 px-4 py-2 text-sm font-semibold">
                    Crear el primero
                  </button>
                </div>
              ) : (
                <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {boards.map((board) => {
                    const isOwner = board.owner_id === user?.id
                    return (
                      <li key={board.id} className="glass-panel flex flex-col overflow-hidden rounded-2xl">
                        <div className="h-2" style={{ backgroundColor: board.color }} />
                        <div className="flex flex-1 flex-col p-5">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="min-w-0 break-words text-lg font-semibold text-white">{board.name}</h3>
                            {!messages.counts[board.id]?.muted && (messages.counts[board.id]?.unread ?? 0) > 0 && (
                              <span className="nav-badge shrink-0" title="Mensajes sin leer">✉ {messages.counts[board.id]?.unread}</span>
                            )}
                            <span className="role-pill shrink-0" title={isOwner ? 'Eres propietario' : 'Tablero compartido contigo'}>
                              {isOwner ? `${roleEmotes.owner} Tuyo` : '🤝 Compartido'}
                            </span>
                          </div>
                          <p className="mt-2 line-clamp-3 min-h-10 text-sm text-slate-400">{board.description || 'Sin descripción.'}</p>
                          <div className="mt-auto flex flex-wrap gap-2 pt-5">
                            <button type="button" onClick={() => openBoard(board.id)} className="btn-mint-primary px-3 py-1.5 text-sm font-semibold">Abrir</button>
                            <Link to={`/dashboard/gantt/${board.id}`} className="btn-ghost px-3 py-1.5 text-sm">Gantt</Link>
                            <button type="button" onClick={() => void withBoardContent(board, (cols, tasks) => exportBoardWorkbook(board, cols, tasks))} className="btn-ghost px-3 py-1.5 text-sm">XLSX</button>
                            <button type="button" onClick={() => void withBoardContent(board, (cols, tasks, names) => exportBoardGanttWorkbook(board, cols, tasks, names))} className="btn-ghost px-3 py-1.5 text-sm">Gantt XLSX</button>
                            {isOwner && (
                              <>
                                <button type="button" onClick={() => setEditingBoard(board)} className="btn-ghost px-3 py-1.5 text-sm">Editar</button>
                                <button type="button" onClick={() => void handleDeleteBoard(board)} className="btn-danger px-3 py-1.5 text-sm">Eliminar</button>
                              </>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )}

          {selectedBoard && (
            <section className="glass-panel mt-6 rounded-2xl p-4 sm:p-6" aria-label={`Tablero ${selectedBoard.name}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: selectedBoard.color }} />
                  <span className="role-pill" title={roleLabels[role]}>
                    {roleEmotes[role]} {roleLabels[role]}
                  </span>
                </div>
                <div className="board-toolbar">
                  <Link to={`/dashboard/gantt/${selectedBoard.id}`} className="btn-ghost px-3 py-1.5 text-sm">Diagrama Gantt</Link>
                  {messages.supported && (
                    <button type="button" onClick={() => setMessagesOpen(true)} className="btn-ghost px-3 py-1.5 text-sm">
                      ✉ Mensajes
                      {!selectedMessageInfo?.muted && (selectedMessageInfo?.unread ?? 0) > 0 && (
                        <span className="nav-badge ml-1.5">{selectedMessageInfo?.unread}</span>
                      )}
                      {selectedMessageInfo?.muted && <span className="ml-1" aria-label="Silenciado">🔕</span>}
                    </button>
                  )}
                  <button type="button" onClick={() => void withBoardContent(selectedBoard, (cols, tasks) => exportBoardWorkbook(selectedBoard, cols, tasks))} className="btn-ghost px-3 py-1.5 text-sm">XLSX</button>
                  <button type="button" onClick={() => void withBoardContent(selectedBoard, (cols, tasks, names) => exportBoardGanttWorkbook(selectedBoard, cols, tasks, names))} className="btn-ghost px-3 py-1.5 text-sm">Gantt XLSX</button>
                  <button type="button" onClick={() => setCollaboratorsOpen(true)} className="btn-ghost px-3 py-1.5 text-sm">Colaboradores</button>
                  {canManageBoard && (
                    <button type="button" onClick={() => setEditingBoard(selectedBoard)} className="btn-ghost px-3 py-1.5 text-sm">Editar</button>
                  )}
                  <button type="button" onClick={closeBoard} className="btn-ghost px-3 py-1.5 text-sm">Cerrar</button>
                </div>
              </div>

              {selectedBoard.description && <p className="mt-3 text-sm text-slate-400">{selectedBoard.description}</p>}

              <div className="mt-5">
                <BoardStats columns={columns} tasksByColumn={tasksByColumn} schedule={schedule} assignments={assignments} people={people} currentUserId={user?.id} commentStats={boardData.commentStats} />
              </div>

              <div className="mt-5 rounded-xl border border-white/5">
                <button
                  type="button"
                  onClick={toggleSettings}
                  aria-expanded={!settingsCollapsed}
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-[var(--text-main)]"
                >
                  <span>⚙ Configuración del tablero</span>
                  <span aria-hidden="true">{settingsCollapsed ? '⌄' : '⌃'}</span>
                </button>
                {!settingsCollapsed && (
                  <div className="grid gap-5 border-t border-white/5 p-4 lg:grid-cols-2">
                    <div>
                      <h3 className="text-base font-medium text-white">Crear columna</h3>
                      {canEditContent ? (
                        <form onSubmit={handleCreateColumn} className="mt-3 flex flex-col gap-3 sm:flex-row">
                          <input
                            type="text"
                            value={newColumnName}
                            onChange={(event) => setNewColumnName(event.target.value)}
                            placeholder="Nombre de la columna"
                            aria-label="Nombre de la nueva columna"
                            className="theme-input min-w-0 flex-1 rounded-lg px-4 py-3"
                            required
                          />
                          <button type="submit" disabled={creatingColumn} className="btn-mint-primary px-4 py-3 font-semibold disabled:opacity-50">
                            {creatingColumn ? 'Creando...' : 'Crear columna'}
                          </button>
                        </form>
                      ) : (
                        <p className="mt-2 text-sm text-[var(--text-muted)]">Tu rol es de lectura: no puedes crear columnas ni tareas.</p>
                      )}
                    </div>
                    <div>
                      <h3 className="text-base font-medium text-white">Jornada del tablero</h3>
                      <p className="mb-3 mt-1 text-sm text-slate-400">Define los días hábiles que usan el Gantt, la ruta crítica y las exportaciones.</p>
                      <BoardScheduleForm key={selectedBoard.updated_at} board={selectedBoard} canManage={canManageBoard} onSave={handleSaveSchedule} />
                    </div>
                  </div>
                )}
              </div>

              {(boardError || boardData.error) && (
                <div className="alert-error mt-4 rounded-lg p-3 text-sm" role="alert">{boardError || boardData.error}</div>
              )}

              <div className="mt-6">
                <h3 className="sr-only">Columnas</h3>
                {boardData.assigneesSupported && columns.length > 0 && (
                  <div className="filter-chips mb-4" role="group" aria-label="Filtrar tareas por responsable">
                    {([
                      ['all', 'Todas', allTasks.length],
                      ['mine', 'Asignadas a mí', assignmentCounts.mine],
                      ['unassigned', 'Sin responsable', assignmentCounts.unassigned],
                    ] as const).map(([value, label, count]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setAssigneeFilter(value)}
                        aria-pressed={assigneeFilter === value}
                        className={`filter-chip ${assigneeFilter === value ? 'filter-chip-active' : ''}`}
                      >
                        {label} <span className="filter-chip-count">{count}</span>
                      </button>
                    ))}
                  </div>
                )}
                {boardData.loading ? (
                  <p className="text-slate-400">Cargando columnas...</p>
                ) : columns.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-700 p-6 text-center text-slate-400">
                    <p>Aún no hay columnas en este tablero.</p>
                    {canEditContent && (
                      <button type="button" onClick={() => void handleCreateDefaultColumns()} className="btn-mint-primary mt-4 px-4 py-2 text-sm font-semibold">
                        Crear Por hacer · En progreso · Completado
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="kanban-columns">
                    {columns.map((column) => (
                      <Column
                        key={column.id}
                        column={column}
                        tasks={visibleTasksByColumn[column.id] ?? []}
                        columns={columns}
                        numbers={numbers}
                        schedule={schedule.tasks}
                        relations={relations}
                        assignments={assignments}
                        peopleById={peopleById}
                        commentStats={boardData.commentStats}
                        canEdit={canEditContent}
                        creatingTask={creatingTaskColumnId === column.id}
                        movingTaskId={movingTaskId}
                        onRename={(name, status) => handleRenameColumn(column.id, name, status)}
                        onDelete={() => void handleDeleteColumn(column.id)}
                        onCreateTask={(draft) => handleCreateTask(column.id, draft)}
                        onOpenTask={handleOpenTask}
                        onMoveTask={handleMoveTask}
                        onDeleteTask={handleDeleteTask}
                        onToggleRelation={handleToggleRelation}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      {openTask && openTaskData && (
        <TaskDetailDialog
          key={`${openTaskData.id}-${openTask.mode}`}
          task={openTaskData}
          columns={columns}
          allTasks={allTasks}
          numbers={numbers}
          scheduleInfo={schedule.tasks.get(openTaskData.id)}
          canEdit={canEditContent}
          initialMode={openTask.mode}
          saving={savingTask}
          people={people}
          assignees={(assignments[openTaskData.id] ?? [])
            .map((userId) => peopleById.get(userId))
            .filter((person): person is BoardPerson => Boolean(person))}
          canAssign={canManageBoard}
          assigneesSupported={boardData.assigneesSupported}
          currentUserId={user?.id}
          boardId={selectedBoard?.id ?? ''}
          isBoardOwner={canManageBoard}
          commentsSupported={boardData.commentsSupported}
          onSaveAssignees={(userIds) => handleSaveAssignees(openTaskData, userIds)}
          onSave={(input) => handleSaveTask(openTaskData, input)}
          onDelete={() => void handleDeleteTask(openTaskData)}
          onClose={() => setOpenTask(null)}
        />
      )}

      {collaboratorsOpen && selectedBoard && (
        <CollaboratorsModal
          board={selectedBoard}
          currentUserId={user?.id}
          currentUserEmail={user?.email}
          currentRole={role}
          ownerProfile={selectedBoard.owner_id === user?.id ? profile : boardOwnerProfile}
          members={members}
          invitations={invitations}
          error={memberError}
          onInvite={handleInvite}
          onChangeRole={(member, nextRole) => void runMemberAction(() => updateBoardMemberRole(member.id, nextRole), 'No se pudo cambiar el rol.')}
          onRemove={handleRemoveMember}
          onCancelInvitation={(invitation) => void runMemberAction(() => cancelBoardInvitation(invitation.id), 'No se pudo cancelar la invitación.')}
          onClose={() => {
            setCollaboratorsOpen(false)
            setMemberError('')
          }}
        />
      )}

      {editingBoard && <EditBoardModal board={editingBoard} onSave={handleUpdateBoard} onClose={() => setEditingBoard(null)} />}
      {securityOpen && <SecurityInfoDialog onClose={() => setSecurityOpen(false)} />}
      {messagesOpen && selectedBoard && (
        <MessagesPanel
          board={selectedBoard}
          numbers={numbers}
          muted={selectedMessageInfo?.muted ?? false}
          browserPermission={messages.browserPermission}
          onRequestBrowserPermission={() => void messages.requestBrowserPermission()}
          onToggleMuted={handleToggleMuted}
          onMarkedRead={handleMessagesMarkedRead}
          onOpenTask={(taskId) => {
            setMessagesOpen(false)
            setOpenTask({ id: taskId, mode: 'view' })
          }}
          onClose={() => setMessagesOpen(false)}
        />
      )}
      <ToastStack
        toasts={messages.toasts.filter((toast) => !(messagesOpen && toast.board_id === selectedBoardId))}
        onOpen={handleOpenToast}
        onDismiss={messages.dismissToast}
      />
    </main>
  )
}

export default Dashboard

import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'
import {
  createBoard,
  deleteBoard,
  getBoards,
  type Board,
  updateBoard,
} from '../services/boards'
import {
  createBoardColumn,
  deleteBoardColumn,
  ensureBoardColumns,
  type BoardColumn,
  updateBoardColumn,
} from '../services/columns'
import {
  createTask,
  deleteTask,
  getColumnTasks,
  moveTask,
  type Task,
  type TaskPriority,
  updateTask,
} from '../services/tasks'
import TaskCard from '../components/board/TaskCard'
import type { EditingTaskState } from '../components/board/TaskCard'
import Column from '../components/board/Column'
import {
  getBoardInvitations,
  getBoardMembers,
  inviteBoardMember,
  type BoardInvitation,
  type BoardMember,
  type BoardMemberRole,
} from '../services/boardMembers'
import {
  syncProfileFromAuthUser,
  type Profile,
} from '../services/profiles'
import {
  downloadBoardTemplate,
  exportBoardWorkbook,
  readBoardWorkbook,
  type ImportedBoard,
} from '../services/boardWorkbook'

type BoardFormState = {
  name: string
  description: string
  color: string
}

const defaultBoardForm: BoardFormState = {
  name: '',
  description: '',
  color: '#6366f1',
}

function Dashboard() {
  const { user } = useAuth()

  const [boards, setBoards] = useState<Board[]>([])
  const [loadingBoards, setLoadingBoards] = useState(true)
  const [creatingBoard, setCreatingBoard] = useState(false)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#6366f1')

  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null)
  const [boardsColumns, setBoardsColumns] = useState<BoardColumn[]>([])
  const [tasksByColumn, setTasksByColumn] = useState<Record<string, Task[]>>({})
  const [loadingColumns, setLoadingColumns] = useState(false)
  const [creatingColumn, setCreatingColumn] = useState(false)
  const [newColumnName, setNewColumnName] = useState('')
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null)
  const [editingColumnName, setEditingColumnName] = useState('')
  const [savingColumn, setSavingColumn] = useState(false)
  const [columnError, setColumnError] = useState('')
  const [taskDrafts, setTaskDrafts] = useState<
    Record<string, { title: string; priority: TaskPriority; dueDate: string }>
  >({})
  const [creatingTaskIds, setCreatingTaskIds] = useState<Record<string, boolean>>({})
  const [editingTask, setEditingTask] = useState<EditingTaskState | null>(null)
  const [savingTask, setSavingTask] = useState(false)
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<'boards' | 'create'>('boards')
  const [boardMembers, setBoardMembers] = useState<BoardMember[]>([])
  const [boardInvitations, setBoardInvitations] = useState<BoardInvitation[]>([])
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState<BoardMemberRole>('viewer')
  const [invitingMember, setInvitingMember] = useState(false)
  const [memberError, setMemberError] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [importingBoard, setImportingBoard] = useState(false)

  const [editingBoard, setEditingBoard] = useState<Board | null>(null)
  const [editForm, setEditForm] = useState<BoardFormState>(defaultBoardForm)
  const [savingBoard, setSavingBoard] = useState(false)
  const [editError, setEditError] = useState('')

  useEffect(() => {
    async function loadBoards() {
      try {
        setError('')

        const data = await getBoards()
        setBoards(data)
      } catch (err) {
        console.error('Error al cargar tableros:', err)

        setError(
          err instanceof Error
            ? err.message
            : 'No se pudieron cargar los tableros.',
        )
      } finally {
        setLoadingBoards(false)
      }
    }

    loadBoards()
  }, [])

  useEffect(() => {
    async function loadCurrentProfile() {
      if (!user) {
        return
      }

      try {
        setProfile(await syncProfileFromAuthUser(user))
      } catch (err) {
        console.error('Error al cargar el perfil del dashboard:', err)
      }
    }

    loadCurrentProfile()
  }, [user])

  useEffect(() => {
    function selectBoardFromHash() {
      const hash = window.location.hash
      const boardId = hash.startsWith('#board-')
        ? hash.slice('#board-'.length)
        : null

      if (boardId) {
        setSelectedBoardId(boardId)
        setActiveView('boards')
      }
    }

    selectBoardFromHash()
    window.addEventListener('hashchange', selectBoardFromHash)

    return () => window.removeEventListener('hashchange', selectBoardFromHash)
  }, [])

  useEffect(() => {
    async function loadColumns() {
      if (!selectedBoardId) {
        setBoardsColumns([])
        setLoadingColumns(false)
        return
      }

      try {
        setLoadingColumns(true)
        setColumnError('')

        const columns = await ensureBoardColumns(selectedBoardId)
        setBoardsColumns(columns)

        const tasksByColumnId = await Promise.all(
          columns.map(async (column) => ({
            columnId: column.id,
            tasks: await getColumnTasks(column.id),
          })),
        )

        setTasksByColumn(
          Object.fromEntries(
            tasksByColumnId.map(({ columnId, tasks }) => [
              columnId,
              tasks,
            ]),
          ),
        )
      } catch (err) {
        console.error('Error al cargar columnas:', err)
        setColumnError(
          err instanceof Error
            ? err.message
            : 'No se pudieron cargar las columnas.',
        )
      } finally {
        setLoadingColumns(false)
      }
    }

    loadColumns()
  }, [selectedBoardId])

  useEffect(() => {
    async function loadMembers() {
      if (!selectedBoardId) {
        setBoardMembers([])
        return
      }

      try {
        setMemberError('')
        const [members, invitations] = await Promise.all([
          getBoardMembers(selectedBoardId),
          getBoardInvitations(selectedBoardId),
        ])
        setBoardMembers(members)
        setBoardInvitations(invitations)
      } catch (err) {
        console.error('Error al cargar colaboradores:', err)
        setMemberError(
          err instanceof Error
            ? err.message
            : 'No se pudieron cargar los colaboradores.',
        )
      }
    }

    loadMembers()
  }, [selectedBoardId])

  function closeEditBoardModal() {
    setEditingBoard(null)
    setEditForm(defaultBoardForm)
    setEditError('')
  }

  function handleOpenEditBoard(board: Board) {
    setEditingBoard(board)
    setEditForm({
      name: board.name,
      description: board.description ?? '',
      color: board.color,
    })
    setEditError('')
  }

  function handleOpenBoardDetail(boardId: string) {
    setActiveView('boards')
    setSelectedBoardId(boardId)
    window.location.hash = `board-${boardId}`
    setNewColumnName('')
    setEditingColumnId(null)
    setEditingColumnName('')
    setEditingTask(null)
    setColumnError('')
  }

  function handleCloseBoardDetail() {
    setSelectedBoardId(null)
    window.history.replaceState(null, '', window.location.pathname)
  }

  async function handleInviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedBoardId) {
      return
    }

    try {
      setInvitingMember(true)
      setMemberError('')
      const member = await inviteBoardMember(
        selectedBoardId,
        memberEmail,
        memberRole,
      )
      setBoardInvitations((currentInvitations) => [
        ...currentInvitations.filter(
          (currentInvitation) => currentInvitation.id !== member.id,
        ),
        member,
      ])
      setMemberEmail('')
    } catch (err) {
      console.error('Error al invitar colaborador:', err)
      setMemberError(
        err instanceof Error ? err.message : 'No se pudo invitar al colaborador.',
      )
    } finally {
      setInvitingMember(false)
    }
  }

  async function handleCreateColumn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedBoardId) {
      return
    }

    try {
      setColumnError('')
      setCreatingColumn(true)

      const newColumn = await createBoardColumn(
        selectedBoardId,
        newColumnName,
      )

      setBoardsColumns((currentColumns) => [
        ...currentColumns,
        newColumn,
      ])
      setNewColumnName('')
    } catch (err) {
      console.error('Error al crear columna:', err)
      setColumnError(
        err instanceof Error
          ? err.message
          : 'No se pudo crear la columna.',
      )
    } finally {
      setCreatingColumn(false)
    }
  }

  function handleStartEditColumn(column: BoardColumn) {
    setEditingColumnId(column.id)
    setEditingColumnName(column.name)
    setColumnError('')
  }

  async function handleSaveColumnEdit(
    columnId: string,
  ) {
    try {
      setColumnError('')
      setSavingColumn(true)

      const updatedColumn = await updateBoardColumn(
        columnId,
        editingColumnName,
      )

      setBoardsColumns((currentColumns) =>
        currentColumns.map((column) =>
          column.id === updatedColumn.id ? updatedColumn : column,
        ),
      )
      setEditingColumnId(null)
      setEditingColumnName('')
    } catch (err) {
      console.error('Error al actualizar columna:', err)
      setColumnError(
        err instanceof Error
          ? err.message
          : 'No se pudo actualizar la columna.',
      )
    } finally {
      setSavingColumn(false)
    }
  }

  async function handleDeleteColumn(columnId: string) {
    const confirmed = window.confirm(
      '¿Estás seguro de que quieres eliminar esta columna?',
    )

    if (!confirmed) {
      return
    }

    try {
      setColumnError('')
      await deleteBoardColumn(columnId)

      setBoardsColumns((currentColumns) =>
        currentColumns.filter((column) => column.id !== columnId),
      )

      if (editingColumnId === columnId) {
        setEditingColumnId(null)
        setEditingColumnName('')
      }
    } catch (err) {
      console.error('Error al eliminar columna:', err)
      setColumnError(
        err instanceof Error
          ? err.message
          : 'No se pudo eliminar la columna.',
      )
    }
  }

  async function handleCreateTask(columnId: string) {
    const draft = taskDrafts[columnId] ?? {
      title: '',
      priority: 'medium' as TaskPriority,
      dueDate: '',
    }
    const title = draft.title.trim()

    if (!title) {
      setColumnError('La tarea debe tener un título.')
      return
    }

    try {
      setColumnError('')
      setCreatingTaskIds((currentState) => ({
        ...currentState,
        [columnId]: true,
      }))

      const newTask = await createTask(
        columnId,
        title,
        undefined,
        draft.priority,
        draft.dueDate || null,
      )

      setTasksByColumn((currentTasks) => ({
        ...currentTasks,
        [columnId]: [...(currentTasks[columnId] ?? []), newTask],
      }))

      setTaskDrafts((currentDrafts) => ({
        ...currentDrafts,
        [columnId]: {
          title: '',
          priority: 'medium',
          dueDate: '',
        },
      }))
    } catch (err) {
      console.error('Error al crear tarea:', err)
      setColumnError(
        err instanceof Error
          ? err.message
          : 'No se pudo crear la tarea.',
      )
    } finally {
      setCreatingTaskIds((currentState) => ({
        ...currentState,
        [columnId]: false,
      }))
    }
  }

  function handleStartEditTask(task: Task) {
    setEditingTask({
      id: task.id,
      columnId: task.column_id,
      title: task.title,
      description: task.description ?? '',
      priority: task.priority,
      dueDate: task.due_date ?? '',
    })
    setColumnError('')
  }

  function handleEditTaskChange(changes: Partial<EditingTaskState>) {
    setEditingTask((currentTask) =>
      currentTask ? { ...currentTask, ...changes } : currentTask,
    )
  }

  async function handleSaveTaskEdit() {
    if (!editingTask) {
      return
    }

    try {
      setColumnError('')
      setSavingTask(true)

      const updatedTask = await updateTask(
        editingTask.id,
        editingTask.title,
        editingTask.description,
        editingTask.priority,
        editingTask.dueDate || null,
      )

      setTasksByColumn((currentTasks) => ({
        ...currentTasks,
        [editingTask.columnId]: (currentTasks[editingTask.columnId] ?? []).map(
          (task) => (task.id === updatedTask.id ? updatedTask : task),
        ),
      }))

      setEditingTask(null)
    } catch (err) {
      console.error('Error al actualizar la tarea:', err)
      setColumnError(
        err instanceof Error
          ? err.message
          : 'No se pudo actualizar la tarea.',
      )
    } finally {
      setSavingTask(false)
    }
  }

  async function handleMoveTask(task: Task, targetColumnId: string) {
    if (task.column_id === targetColumnId) {
      return
    }

    try {
      setColumnError('')
      setMovingTaskId(task.id)
      const targetTasks = tasksByColumn[targetColumnId] ?? []
      const movedTask = await moveTask(task.id, targetColumnId, targetTasks.length)

      setTasksByColumn((currentTasks) => ({
        ...currentTasks,
        [task.column_id]: (currentTasks[task.column_id] ?? []).filter(
          (currentTask) => currentTask.id !== task.id,
        ),
        [targetColumnId]: [...(currentTasks[targetColumnId] ?? []), movedTask],
      }))
    } catch (err) {
      console.error('Error al mover tarea:', err)
      setColumnError(
        err instanceof Error ? err.message : 'No se pudo mover la tarea.',
      )
    } finally {
      setMovingTaskId(null)
    }
  }

  async function handleDeleteTask(taskId: string, columnId: string) {
    const confirmed = window.confirm(
      '¿Estás seguro de que quieres eliminar esta tarea?',
    )

    if (!confirmed) {
      return
    }

    try {
      setColumnError('')
      await deleteTask(taskId)

      setTasksByColumn((currentTasks) => ({
        ...currentTasks,
        [columnId]: (currentTasks[columnId] ?? []).filter(
          (task) => task.id !== taskId,
        ),
      }))

      if (editingTask?.id === taskId) {
        setEditingTask(null)
      }
    } catch (err) {
      console.error('Error al eliminar tarea:', err)
      setColumnError(
        err instanceof Error
          ? err.message
          : 'No se pudo eliminar la tarea.',
      )
    }
  }

  async function handleUpdateBoard(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    if (!editingBoard) {
      return
    }

    const trimmedName = editForm.name.trim()

    if (!trimmedName) {
      setEditError('El tablero debe tener un nombre.')
      return
    }

    try {
      setEditError('')
      setSavingBoard(true)

      const updatedBoard = await updateBoard(
        editingBoard.id,
        trimmedName,
        editForm.description.trim(),
        editForm.color,
      )

      setBoards((currentBoards) =>
        currentBoards.map((board) =>
          board.id === updatedBoard.id ? updatedBoard : board,
        ),
      )

      closeEditBoardModal()
    } catch (err) {
      console.error('Error al actualizar tablero:', err)

      setEditError(
        err instanceof Error
          ? err.message
          : 'No se pudo actualizar el tablero.',
      )
    } finally {
      setSavingBoard(false)
    }
  }

  async function createImportedBoard(importedBoard: ImportedBoard) {
    if (!user) return
    const board = await createBoard(
      importedBoard.name,
      importedBoard.description,
      importedBoard.color,
      user.id,
    )
    for (const importedColumn of importedBoard.columns) {
      const column = await createBoardColumn(board.id, importedColumn.name)
      for (const importedTask of importedColumn.tasks) {
        await createTask(
          column.id,
          importedTask.title,
          importedTask.description,
          importedTask.priority,
          importedTask.dueDate,
        )
      }
    }
    setBoards((currentBoards) => [board, ...currentBoards])
    setActiveView('boards')
    setSelectedBoardId(null)
  }

  async function handleImportBoard(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      setError('')
      setImportingBoard(true)
      await createImportedBoard(await readBoardWorkbook(file))
    } catch (err) {
      console.error('Error al importar tablero:', err)
      setError(err instanceof Error ? err.message : 'No se pudo importar el tablero.')
    } finally {
      setImportingBoard(false)
    }
  }

  async function handleExportBoard(board: Board) {
    try {
      setError('')
      const columns = await ensureBoardColumns(board.id)
      const taskEntries = await Promise.all(
        columns.map(async (column) => [column.id, await getColumnTasks(column.id)] as const),
      )
      exportBoardWorkbook(board, columns, Object.fromEntries(taskEntries))
    } catch (err) {
      console.error('Error al exportar tablero:', err)
      setError(err instanceof Error ? err.message : 'No se pudo exportar el tablero.')
    }
  }

  async function handleCreateBoard(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    if (!user) {
      return
    }

    if (!name.trim()) {
      setError('El tablero debe tener un nombre.')
      return
    }

    try {
      setError('')
      setCreatingBoard(true)

      const board = await createBoard(
        name.trim(),
        description.trim(),
        color,
        user.id,
      )

      setBoards((currentBoards) => [
        board,
        ...currentBoards,
      ])
      setActiveView('boards')
      setSelectedBoardId(null)

      setName('')
      setDescription('')
      setColor('#6366f1')
    } catch (err) {
      console.error('Error al crear tablero:', err)

      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo crear el tablero.',
      )
    } finally {
      setCreatingBoard(false)
    }
  }

  async function handleDeleteBoard(id: string) {
    const confirmed = window.confirm(
      '¿Estás seguro de que quieres eliminar este tablero?',
    )

    if (!confirmed) {
      return
    }

    try {
      setError('')

      await deleteBoard(id)

      setBoards((currentBoards) =>
        currentBoards.filter((board) => board.id !== id),
      )
    } catch (err) {
      console.error('Error al eliminar tablero:', err)

      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo eliminar el tablero.',
      )
    }
  }

  return (
    <main className="min-h-screen min-w-0 bg-transparent text-[var(--text-main)] md:flex">
      <button
        type="button"
        className={`mobile-menu-button fixed z-50 ${mobileMenuOpen ? 'mobile-menu-button-open' : ''}`}
        onClick={() => setMobileMenuOpen((isOpen) => !isOpen)}
        aria-label={mobileMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
      >
        {mobileMenuOpen ? '×' : '☰'}
      </button>
      {mobileMenuOpen && (
        <button
          type="button"
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Cerrar menú"
        />
      )}
      <aside className={`sidebar glass-panel border-b border-white/5 p-5 md:min-h-screen md:border-b-0 md:border-r ${sidebarCollapsed ? 'sidebar-collapsed md:w-19' : 'md:w-64'} ${mobileMenuOpen ? 'sidebar-mobile-open' : ''}`}>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed((isCollapsed) => !isCollapsed)}
          aria-label={sidebarCollapsed ? 'Expandir panel' : 'Colapsar panel'}
        >
          {sidebarCollapsed ? '›' : '‹'}
        </button>
        <div className="flex items-center gap-3">
          <Link
            to="/profile"
            className="flex shrink-0 rounded-xl transition-opacity hover:opacity-80"
            aria-label="Abrir perfil"
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="Avatar del usuario" className="h-10 w-10 rounded-xl object-cover" />
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
        <nav className="mt-8 space-y-2">
          <button type="button" title="Tableros" onClick={() => { setActiveView('boards'); handleCloseBoardDetail(); setMobileMenuOpen(false) }} className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${activeView === 'boards' ? 'bg-[rgba(166,180,184,0.1)] text-[var(--accent-ui)]' : 'text-[var(--text-muted)] hover:bg-white/5'}`}>
            <span aria-hidden="true">▦ </span>
            <span className="sidebar-label">Tableros</span>
          </button>
          <button type="button" title="Crear tablero" onClick={() => { setActiveView('create'); handleCloseBoardDetail(); setMobileMenuOpen(false) }} className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${activeView === 'create' ? 'bg-[rgba(166,180,184,0.1)] text-[var(--accent-ui)]' : 'text-[var(--text-muted)] hover:bg-white/5'}`}>
            <span aria-hidden="true">＋ </span>
            <span className="sidebar-label">Crear tablero</span>
          </button>
        </nav>
        <div className="mt-8 border-t border-slate-800 pt-6">
          <div
            className="workspace-collapsed-mark"
            title="Kanban Workspace"
            aria-label="Kanban Workspace"
          >
            ▦
          </div>
          <button type="button" onClick={() => setWorkspaceMenuOpen((isOpen) => !isOpen)} className="flex w-full items-center justify-between rounded-lg p-2 text-left hover:bg-white/5">
            <span className="sidebar-label text-sm font-medium">Espacios de trabajo</span>
            <span className="text-xs text-[var(--text-muted)]">{workspaceMenuOpen ? '⌃' : '⌄'}</span>
          </button>
          {workspaceMenuOpen && (
            <div className="sidebar-label mt-2 rounded-lg bg-black/20 p-2">
              <button type="button" className="flex w-full items-center gap-2 rounded-md bg-[rgba(166,180,184,0.1)] px-2 py-2 text-left text-sm text-[var(--accent-ui)]">
                <span aria-hidden="true">▦</span>
                <span>Kanban Workspace</span>
              </button>
              <p className="px-2 pt-3 text-xs text-[var(--text-muted)]">Próximamente: UML y más espacios.</p>
            </div>
          )}
        </div>
      </aside>

      <div className="min-w-0 w-full p-5 pt-20 md:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">
              {selectedBoardId
                ? `#${boards.find((board) => board.id === selectedBoardId)?.name ?? 'Tablero'}`
                : activeView === 'create'
                  ? 'Crear tablero'
                  : 'Mis tableros'}
            </h1>

            <p className="mt-2 text-slate-400">
              Organiza tus proyectos y tareas.
            </p>
          </div>

        </header>

        {error && (
          <div className="alert-error mt-6 rounded-lg p-4 text-sm">
            {error}
          </div>
        )}

        {activeView === 'create' && (
        <section id="create-board" className="glass-panel mt-8 rounded-2xl p-6">
          <h2 className="text-xl font-semibold text-white">
            Crear tablero
          </h2>

          <form
            onSubmit={handleCreateBoard}
            className="mt-5 space-y-4"
          >
            <div>
              <label
                htmlFor="board-name"
                className="mb-2 block text-sm font-medium text-slate-300"
              >
                Nombre
              </label>

              <input
                id="board-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                className="theme-input w-full rounded-lg px-4 py-3"
                placeholder="Mi proyecto"
              />
            </div>

            <div>
              <label
                htmlFor="board-description"
                className="mb-2 block text-sm font-medium text-slate-300"
              >
                Descripción
              </label>

              <textarea
                id="board-description"
                value={description}
                onChange={(event) =>
                  setDescription(event.target.value)
                }
                rows={3}
                className="theme-input w-full resize-none rounded-lg px-4 py-3"
                placeholder="Descripción opcional..."
              />
            </div>

            <div>
              <label
                htmlFor="board-color"
                className="mb-2 block text-sm font-medium text-slate-300"
              >
                Color
              </label>

              <input
                id="board-color"
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="theme-input h-10 w-16 cursor-pointer rounded"
              />
            </div>

            <button
              type="submit"
              disabled={creatingBoard}
              className="btn-mint-primary px-5 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creatingBoard
                ? 'Creando...'
                : 'Crear tablero'}
            </button>
          </form>
          <div className="mt-6 border-t border-white/5 pt-5">
            <p className="text-sm text-[var(--text-muted)]">
              También puedes crear un tablero completo desde una plantilla XLS.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" onClick={downloadBoardTemplate} className="btn-ghost px-4 py-2 text-sm">
                Descargar plantilla XLS
              </button>
              <label className="btn-action-secondary cursor-pointer border border-white/10 px-4 py-2 text-sm">
                {importingBoard ? 'Importando...' : 'Importar tablero XLS'}
                <input type="file" accept=".xls,.xlsx" onChange={handleImportBoard} disabled={importingBoard} className="hidden" />
              </label>
            </div>
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              Columnas requeridas: Columna, Tarea, Descripción, Prioridad y Fecha vencimiento.
            </p>
          </div>
        </section>
        )}

        {activeView === 'boards' && !selectedBoardId && (
        <section id="boards" className="mt-8">
          <h2 className="text-xl font-semibold text-white">
            Tus tableros
          </h2>

          {loadingBoards ? (
            <p className="mt-4 text-slate-400">
              Cargando tableros...
            </p>
          ) : boards.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-700 p-8 text-center">
              <p className="text-slate-400">
                Todavía no tienes ningún tablero.
              </p>
            </div>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {boards.map((board) => (
                <article
                  key={board.id}
                  className="glass-panel overflow-hidden rounded-2xl"
                >
                  <div
                    className="h-2"
                    style={{ backgroundColor: board.color }}
                  />

                  <div className="p-5">
                    <h3 className="text-lg font-semibold text-white">
                      {board.name}
                    </h3>

                    <p className="mt-2 min-h-10 text-sm text-slate-400">
                      {board.description || 'Sin descripción.'}
                    </p>

                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          selectedBoardId === board.id
                            ? handleCloseBoardDetail()
                            : handleOpenBoardDetail(board.id)
                        }
                        className="text-sm font-medium text-indigo-400 transition hover:text-indigo-300"
                      >
                        {selectedBoardId === board.id ? 'Cerrar' : 'Abrir'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenEditBoard(board)}
                        className="text-sm font-medium text-indigo-400 transition hover:text-indigo-300"
                      >
                        Editar
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteBoard(board.id)}
                        className="text-sm font-medium text-red-400 transition hover:text-red-300"
                      >
                        Eliminar tablero
                      </button>

                      <button
                        type="button"
                        onClick={() => handleExportBoard(board)}
                        className="btn-ghost px-3 py-1 text-sm"
                      >
                        Descargar XLS
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        )}

        {selectedBoardId && (
          <section className="glass-panel mt-8 rounded-2xl p-6">
            {(() => {
              const selectedBoard = boards.find(
                (board) => board.id === selectedBoardId,
              )

              if (!selectedBoard) {
                return null
              }

              return (
                <>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="h-4 w-4 rounded-full"
                        style={{ backgroundColor: selectedBoard.color }}
                      />

                      <h2 className="text-xl font-semibold text-white">
                        {selectedBoard.name}
                      </h2>
                    </div>

                    <button
                      type="button"
                      onClick={handleCloseBoardDetail}
                      className="text-sm font-medium text-slate-300 transition hover:text-white"
                    >
                      Cerrar vista
                    </button>
                  </div>

                  <div className="glass-panel mt-5 rounded-xl p-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-medium text-white">
                          Colaboradores
                        </h3>
                        <p className="mt-1 text-sm text-slate-400">
                          Invita personas por correo y define su nivel de acceso.
                        </p>
                      </div>
                      <span className="rounded-full bg-indigo-500/10 px-3 py-1 text-xs text-indigo-300">
                        {boardMembers.length} colaborador{boardMembers.length === 1 ? '' : 'es'}
                      </span>
                    </div>

                    <form
                      onSubmit={handleInviteMember}
                      className="mt-4 flex flex-col gap-3 lg:flex-row"
                    >
                      <input
                        type="email"
                        value={memberEmail}
                        onChange={(event) => setMemberEmail(event.target.value)}
                        placeholder="persona@empresa.com"
                        className="theme-input flex-1 rounded-lg px-3 py-2"
                        required
                      />
                      <select
                        value={memberRole}
                        onChange={(event) =>
                          setMemberRole(event.target.value as BoardMemberRole)
                        }
                        className="theme-input rounded-lg px-3 py-2"
                      >
                        <option value="viewer">Lector</option>
                        <option value="editor">Editor</option>
                      </select>
                      <button
                        type="submit"
                        disabled={invitingMember}
                        className="btn-mint-primary px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {invitingMember ? 'Invitando...' : 'Invitar'}
                      </button>
                    </form>

                    {memberError && (
                      <p className="alert-error mt-3 rounded-lg p-3 text-sm">
                        {memberError}
                      </p>
                    )}

                    {boardMembers.length > 0 && (
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        {boardMembers.map((member) => (
                          <div
                            key={member.id}
                            className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm text-white">
                                {member.profile?.display_name ||
                                  member.profile?.username ||
                                  'Usuario'}
                              </p>
                              <p className="truncate text-xs text-slate-400">
                                @{member.profile?.username || 'sin username'}
                              </p>
                            </div>
                            <span className="ml-3 text-xs text-[var(--accent-mint)]">
                              {member.role === 'editor' ? 'Editor' : 'Lector'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {boardInvitations.length > 0 && (
                      <div className="mt-4">
                        <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                          Invitaciones pendientes
                        </p>
                        <div className="space-y-2">
                          {boardInvitations.map((invitation) => (
                            <div
                              key={invitation.id}
                              className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-3 py-2"
                            >
                              <span className="text-sm text-slate-300">
                                {invitation.email}
                              </span>
                              <span className="text-xs text-[var(--priority-medium)]">
                                {invitation.status === 'pending'
                                  ? 'Pendiente'
                                  : invitation.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="glass-panel mt-5 rounded-xl p-4">
                    <h3 className="text-lg font-medium text-white">
                      Crear columna
                    </h3>

                    <form
                      onSubmit={handleCreateColumn}
                      className="mt-4 flex flex-col gap-3 md:flex-row"
                    >
                      <input
                        type="text"
                        value={newColumnName}
                        onChange={(event) => setNewColumnName(event.target.value)}
                        placeholder="Nombre de la columna"
                        className="theme-input flex-1 rounded-lg px-4 py-3"
                        required
                      />

                      <button
                        type="submit"
                        disabled={creatingColumn}
                        className="btn-mint-primary px-4 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {creatingColumn ? 'Creando...' : 'Crear columna'}
                      </button>
                    </form>
                  </div>

                  {columnError && (
                    <div className="alert-error mt-4 rounded-lg p-3 text-sm">
                      {columnError}
                    </div>
                  )}

                  <div className="mt-6">
                    <h3 className="text-lg font-medium text-white">
                      Columnas
                    </h3>

                    {loadingColumns ? (
                      <p className="mt-4 text-slate-400">
                        Cargando columnas...
                      </p>
                    ) : boardsColumns.length === 0 ? (
                      <div className="mt-4 rounded-2xl border border-dashed border-slate-700 p-6 text-center text-slate-400">
                        Aún no hay columnas en este tablero.
                      </div>
                    ) : (
                      <div className="kanban-columns mt-4">
                        {boardsColumns.map((column) => {
                          const columnTasks = tasksByColumn[column.id] ?? []

                          return (
                            <>
                            <Column
                              key={`component-${column.id}`}
                              column={column}
                              tasks={columnTasks}
                              columns={boardsColumns}
                              editingColumn={editingColumnId === column.id}
                              editingColumnName={editingColumnName}
                              savingColumn={savingColumn}
                              taskDraft={taskDrafts[column.id] ?? {
                                title: '',
                                priority: 'medium',
                                dueDate: '',
                              }}
                              creatingTask={creatingTaskIds[column.id] ?? false}
                              editingTask={editingTask}
                              savingTask={savingTask}
                              movingTaskId={movingTaskId}
                              onColumnNameChange={setEditingColumnName}
                              onSaveColumn={() => handleSaveColumnEdit(column.id)}
                              onCancelColumn={() => {
                                setEditingColumnId(null)
                                setEditingColumnName('')
                              }}
                              onStartEditColumn={() => handleStartEditColumn(column)}
                              onDeleteColumn={() => handleDeleteColumn(column.id)}
                              onTaskDraftChange={(changes) =>
                                setTaskDrafts((currentDrafts) => ({
                                  ...currentDrafts,
                                  [column.id]: {
                                    title: currentDrafts[column.id]?.title ?? '',
                                    priority:
                                      currentDrafts[column.id]?.priority ?? 'medium',
                                    dueDate: currentDrafts[column.id]?.dueDate ?? '',
                                    ...changes,
                                  },
                                }))
                              }
                              onCreateTask={() => handleCreateTask(column.id)}
                              onStartEditTask={handleStartEditTask}
                              onEditTaskChange={handleEditTaskChange}
                              onSaveTask={handleSaveTaskEdit}
                              onCancelTask={() => setEditingTask(null)}
                              onMoveTask={handleMoveTask}
                              onDeleteTask={(task) =>
                                handleDeleteTask(task.id, column.id)
                              }
                            />
                            <div
                              key={column.id}
                              className="hidden"
                            >
                              {editingColumnId === column.id ? (
                                <div className="space-y-3">
                                  <input
                                    type="text"
                                    value={editingColumnName}
                                    onChange={(event) =>
                                      setEditingColumnName(event.target.value)
                                    }
                                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none focus:border-indigo-500"
                                  />

                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleSaveColumnEdit(column.id)}
                                      disabled={savingColumn}
                                      className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      {savingColumn ? 'Guardando...' : 'Guardar'}
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingColumnId(null)
                                        setEditingColumnName('')
                                      }}
                                      className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
                                    >
                                      Cancelar
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-center justify-between gap-3">
                                    <h4 className="text-base font-semibold text-white">
                                      {column.name}
                                    </h4>
                                  </div>

                                  <div className="mt-4 flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleStartEditColumn(column)}
                                      className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
                                    >
                                      Editar
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => handleDeleteColumn(column.id)}
                                      className="rounded-lg border border-red-500/30 px-3 py-2 text-sm font-medium text-red-400 transition hover:border-red-500 hover:text-red-300"
                                    >
                                      Eliminar
                                    </button>
                                  </div>
                                </>
                              )}

                              <div className="mt-5 space-y-3">
                                <div className="flex gap-2">
                                  <input
                                    type="text"
                                    value={taskDrafts[column.id]?.title ?? ''}
                                    onChange={(event) =>
                                      setTaskDrafts((currentDrafts) => ({
                                        ...currentDrafts,
                                        [column.id]: {
                                          title: event.target.value,
                                          priority:
                                            currentDrafts[column.id]?.priority ??
                                            'medium',
                                          dueDate:
                                            currentDrafts[column.id]?.dueDate ?? '',
                                        },
                                      }))
                                    }
                                    placeholder="Nueva tarea"
                                    className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                                  />

                                  <button
                                    type="button"
                                    onClick={() => handleCreateTask(column.id)}
                                    disabled={creatingTaskIds[column.id] ?? false}
                                    className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {creatingTaskIds[column.id] ? '...' : 'Agregar'}
                                  </button>
                                </div>

                                <div className="flex gap-2">
                                  <select
                                    value={
                                      taskDrafts[column.id]?.priority ?? 'medium'
                                    }
                                    onChange={(event) =>
                                      setTaskDrafts((currentDrafts) => ({
                                        ...currentDrafts,
                                        [column.id]: {
                                          title:
                                            currentDrafts[column.id]?.title ?? '',
                                          priority: event.target
                                            .value as TaskPriority,
                                          dueDate:
                                            currentDrafts[column.id]?.dueDate ?? '',
                                        },
                                      }))
                                    }
                                    className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white outline-none focus:border-indigo-500"
                                  >
                                    <option value="low">Baja</option>
                                    <option value="medium">Media</option>
                                    <option value="high">Alta</option>
                                  </select>

                                  <input
                                    type="date"
                                    value={taskDrafts[column.id]?.dueDate ?? ''}
                                    onChange={(event) =>
                                      setTaskDrafts((currentDrafts) => ({
                                        ...currentDrafts,
                                        [column.id]: {
                                          title:
                                            currentDrafts[column.id]?.title ?? '',
                                          priority:
                                            currentDrafts[column.id]?.priority ??
                                            'medium',
                                          dueDate: event.target.value,
                                        },
                                      }))
                                    }
                                    className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white outline-none focus:border-indigo-500"
                                  />
                                </div>

                                {columnTasks.length === 0 ? (
                                  <p className="text-sm text-slate-500">
                                    No hay tareas aún.
                                  </p>
                                ) : (
                                  <div className="space-y-2">
                                    {columnTasks.map((task) => (
                                      <>
                                      <TaskCard
                                        key={`component-${task.id}`}
                                        task={task}
                                        columns={boardsColumns}
                                        editingTask={editingTask}
                                        savingTask={savingTask}
                                        movingTask={movingTaskId === task.id}
                                        onStartEdit={handleStartEditTask}
                                        onEditChange={handleEditTaskChange}
                                        onSaveEdit={handleSaveTaskEdit}
                                        onCancelEdit={() => setEditingTask(null)}
                                        onMove={handleMoveTask}
                                        onDelete={(currentTask) =>
                                          handleDeleteTask(currentTask.id, column.id)
                                        }
                                      />
                                      <div
                                        key={task.id}
                                        className="hidden"
                                      >
                                        {editingTask?.id === task.id ? (
                                          <div className="space-y-2">
                                            <input
                                              type="text"
                                              value={editingTask.title}
                                              onChange={(event) =>
                                                setEditingTask((currentTask) =>
                                                  currentTask
                                                    ? {
                                                        ...currentTask,
                                                        title: event.target.value,
                                                      }
                                                    : currentTask,
                                                )
                                              }
                                              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white outline-none focus:border-indigo-500"
                                            />

                                            <textarea
                                              value={editingTask.description}
                                              onChange={(event) =>
                                                setEditingTask((currentTask) =>
                                                  currentTask
                                                    ? {
                                                        ...currentTask,
                                                        description:
                                                          event.target.value,
                                                      }
                                                    : currentTask,
                                                )
                                              }
                                              rows={3}
                                              className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white outline-none focus:border-indigo-500"
                                            />

                                            <div className="flex gap-2">
                                              <select
                                                value={editingTask.priority}
                                                onChange={(event) =>
                                                  setEditingTask((currentTask) =>
                                                    currentTask
                                                      ? {
                                                          ...currentTask,
                                                          priority: event.target
                                                            .value as TaskPriority,
                                                        }
                                                      : currentTask,
                                                  )
                                                }
                                                className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white outline-none focus:border-indigo-500"
                                              >
                                                <option value="low">Baja</option>
                                                <option value="medium">Media</option>
                                                <option value="high">Alta</option>
                                              </select>

                                              <input
                                                type="date"
                                                value={editingTask.dueDate}
                                                onChange={(event) =>
                                                  setEditingTask((currentTask) =>
                                                    currentTask
                                                      ? {
                                                          ...currentTask,
                                                          dueDate: event.target.value,
                                                        }
                                                      : currentTask,
                                                  )
                                                }
                                                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white outline-none focus:border-indigo-500"
                                              />
                                            </div>

                                            <div className="flex gap-2">
                                              <button
                                                type="button"
                                                onClick={handleSaveTaskEdit}
                                                disabled={savingTask}
                                                className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                                              >
                                                {savingTask ? 'Guardando...' : 'Guardar'}
                                              </button>

                                              <button
                                                type="button"
                                                onClick={() => setEditingTask(null)}
                                                className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
                                              >
                                                Cancelar
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <>
                                            <p className="text-sm font-medium text-white">
                                              {task.title}
                                            </p>

                                            <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                              <span
                                                className={`rounded-full px-2 py-1 ${
                                                  task.priority === 'high'
                                                    ? 'bg-red-500/20 text-red-300'
                                                    : task.priority === 'low'
                                                      ? 'bg-slate-700 text-slate-300'
                                                      : 'bg-amber-500/20 text-amber-300'
                                                }`}
                                              >
                                                Prioridad {task.priority === 'high'
                                                  ? 'alta'
                                                  : task.priority === 'low'
                                                    ? 'baja'
                                                    : 'media'}
                                              </span>

                                              {task.due_date && (
                                                <span className="rounded-full border border-white/5 bg-black/20 px-2 py-1 text-[var(--text-muted)]">
                                                  Vence: {task.due_date}
                                                </span>
                                              )}
                                            </div>

                                            {task.description && (
                                              <p className="mt-2 text-xs text-slate-400">
                                                {task.description}
                                              </p>
                                            )}

                                            <div className="mt-3 flex gap-2">
                                              <select
                                                value={task.column_id}
                                                onChange={(event) =>
                                                  handleMoveTask(task, event.target.value)
                                                }
                                                disabled={movingTaskId === task.id}
                                                className="max-w-28 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300 outline-none focus:border-indigo-500"
                                              >
                                                <option value={task.column_id}>Mover a...</option>
                                                {boardsColumns
                                                  .filter((targetColumn) => targetColumn.id !== task.column_id)
                                                  .map((targetColumn) => (
                                                    <option key={targetColumn.id} value={targetColumn.id}>
                                                      {targetColumn.name}
                                                    </option>
                                                  ))}
                                              </select>
                                              <button
                                                type="button"
                                                onClick={() => handleStartEditTask(task)}
                                                className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
                                              >
                                                Editar
                                              </button>

                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleDeleteTask(task.id, column.id)
                                                }
                                                className="rounded-lg border border-red-500/30 px-2 py-1 text-xs font-medium text-red-400 transition hover:border-red-500 hover:text-red-300"
                                              >
                                                Eliminar
                                              </button>
                                            </div>
                                          </>
                                        )}
                                      </div>
                                      </>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                            </>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </>
              )
            })()}
          </section>
        )}
      </div>

      {editingBoard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">
                Editar tablero
              </h2>

              <button
                type="button"
                onClick={closeEditBoardModal}
                className="text-slate-400 transition hover:text-white"
                aria-label="Cerrar editor de tablero"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={handleUpdateBoard}
              className="mt-5 space-y-4"
            >
              <div>
                <label
                  htmlFor="edit-board-name"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  Nombre
                </label>

                <input
                  id="edit-board-name"
                  type="text"
                  value={editForm.name}
                  onChange={(event) =>
                    setEditForm((currentForm) => ({
                      ...currentForm,
                      name: event.target.value,
                    }))
                  }
                  required
                  className="theme-input w-full rounded-lg px-4 py-3"
                  placeholder="Mi proyecto"
                />
              </div>

              <div>
                <label
                  htmlFor="edit-board-description"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  Descripción
                </label>

                <textarea
                  id="edit-board-description"
                  value={editForm.description}
                  onChange={(event) =>
                    setEditForm((currentForm) => ({
                      ...currentForm,
                      description: event.target.value,
                    }))
                  }
                  rows={3}
                  className="theme-input w-full resize-none rounded-lg px-4 py-3"
                  placeholder="Descripción opcional..."
                />
              </div>

              <div>
                <label
                  htmlFor="edit-board-color"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  Color
                </label>

                <input
                  id="edit-board-color"
                  type="color"
                  value={editForm.color}
                  onChange={(event) =>
                    setEditForm((currentForm) => ({
                      ...currentForm,
                      color: event.target.value,
                    }))
                  }
                  className="theme-input h-10 w-16 cursor-pointer rounded"
                />
              </div>

              {editError && (
                <div className="alert-error rounded-lg p-3 text-sm">
                  {editError}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeEditBoardModal}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={savingBoard}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingBoard ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </main>
  )
}

export default Dashboard
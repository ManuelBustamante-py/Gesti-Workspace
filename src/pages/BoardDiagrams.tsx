import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'
import { useIsNarrow } from '../hooks/useLayout'
import DiagramEditor from '../components/uml/DiagramEditor'
import VisualEditor from '../components/uml/visual/VisualEditor'
import NewDiagramModal, { type NewDiagramValues } from '../components/uml/NewDiagramModal'
import { boardPermissions, resolveBoardRole } from '../domain/roles'
import { UML_CATEGORIES, umlDiagramType } from '../domain/umlCatalog'
import { preloadPlantUml } from '../lib/plantuml'
import { getBoard, type Board } from '../services/boards'
import { getBoardMembers, type BoardMember } from '../services/boardMembers'
import { createDiagram, getDiagram, listDiagrams, type Diagram, type DiagramSummary } from '../services/diagrams'

const editedAt = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const categoryIcons: Record<string, string> = { uml: '◇', architecture: '▤', process: '↻' }

/**
 * Diagramas del tablero: galería y editor. Rutas:
 * /dashboard/uml/:boardId               → galería
 * /dashboard/uml/:boardId/:diagramId    → editor
 */
function BoardDiagrams() {
  const { boardId, diagramId } = useParams<{ boardId: string; diagramId?: string }>()
  const { user } = useAuth()
  const narrow = useIsNarrow()
  const navigate = useNavigate()

  const [board, setBoard] = useState<Board | null>(null)
  const [members, setMembers] = useState<BoardMember[]>([])
  const [boardError, setBoardError] = useState('')
  const [loadingBoard, setLoadingBoard] = useState(true)
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [listError, setListError] = useState('')
  const [current, setCurrent] = useState<Diagram | null>(null)
  const [currentError, setCurrentError] = useState('')
  const [creating, setCreating] = useState(false)

  // El motor pesa varios MB: se empieza a descargar apenas se entra a la sección.
  useEffect(() => {
    preloadPlantUml()
  }, [])

  useEffect(() => {
    if (!boardId || !user) return
    let cancelled = false
    Promise.all([getBoard(boardId), getBoardMembers(boardId).catch(() => [] as BoardMember[])])
      .then(([result, boardMembers]) => {
        if (cancelled) return
        if (!result) setBoardError('No se encontró el tablero o no tienes acceso.')
        setBoard(result)
        setMembers(boardMembers)
      })
      .catch((err) => !cancelled && setBoardError(err instanceof Error ? err.message : 'No se pudo cargar el tablero.'))
      .finally(() => !cancelled && setLoadingBoard(false))
    return () => {
      cancelled = true
    }
  }, [boardId, user])

  const refreshList = useCallback(async () => {
    if (!boardId) return
    try {
      setDiagrams(await listDiagrams(boardId))
      setListError('')
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'No se pudieron cargar los diagramas.')
    } finally {
      setLoadingList(false)
    }
  }, [boardId])

  useEffect(() => {
    if (!user || diagramId) return
    void refreshList()
  }, [diagramId, refreshList, user])

  useEffect(() => {
    if (!diagramId || !user) return
    let cancelled = false
    getDiagram(diagramId)
      .then((result) => {
        if (cancelled) return
        setCurrent(result)
        setCurrentError(result ? '' : 'El diagrama no existe o fue eliminado.')
      })
      .catch((err) => !cancelled && setCurrentError(err instanceof Error ? err.message : 'No se pudo abrir el diagrama.'))
    return () => {
      cancelled = true
    }
  }, [diagramId, user])

  const role = resolveBoardRole(board, user?.id, members)
  const { canEditContent } = boardPermissions(role)
  const listPath = `/dashboard/uml/${boardId}`

  async function handleCreate(values: NewDiagramValues) {
    if (!boardId) return null
    try {
      const created = await createDiagram(boardId, values)
      setCreating(false)
      setCurrent(created)
      navigate(`${listPath}/${created.id}`)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : 'No se pudo crear el diagrama.'
    }
  }

  if (loadingBoard) {
    return <main className="min-h-screen bg-[var(--bg-main)] p-6 text-slate-400">Cargando diagramas…</main>
  }
  if (!board || boardError) {
    return (
      <main className="min-h-screen bg-[var(--bg-main)] p-6 text-slate-300">
        <p className="alert-error rounded-lg p-4" role="alert">{boardError || 'Tablero no disponible.'}</p>
        <Link to="/dashboard" className="btn-ghost mt-4 inline-block px-4 py-2">Volver a tableros</Link>
      </main>
    )
  }

  const editing = diagramId && current?.id === diagramId ? current : null

  return (
    <main className="min-h-screen bg-[var(--bg-main)] px-3 py-4 text-slate-100 sm:px-6 sm:py-7">
      <div className="mx-auto max-w-[1800px]">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Link to={`/dashboard#board-${board.id}`} className="text-sm text-slate-400 transition hover:text-white">
              ← Volver al tablero
            </Link>
            <div className="mt-3 flex items-center gap-3">
              <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: board.color }} />
              <h1 className="min-w-0 break-words text-2xl font-semibold text-white sm:text-3xl">{board.name}</h1>
            </div>
            <p className="mt-2 text-sm text-slate-400">Diagramas UML, de arquitectura y de procesos del proyecto</p>
          </div>
          {!diagramId && canEditContent && (
            <button type="button" onClick={() => setCreating(true)} className="btn-mint-primary px-4 py-2 text-sm font-semibold">
              ＋ Añadir diagrama
            </button>
          )}
        </header>

        {diagramId ? (
          editing ? (
            <section className="glass-panel rounded-2xl p-3 sm:p-5">
              {editing.mode === 'visual' ? (
                <VisualEditor
                  key={`${editing.id}-visual`}
                  diagram={editing}
                  canEdit={canEditContent}
                  narrow={narrow}
                  onSaved={setCurrent}
                  onDeleted={() => {
                    setCurrent(null)
                    navigate(listPath)
                  }}
                  onBack={() => navigate(listPath)}
                />
              ) : (
                <DiagramEditor
                  key={`${editing.id}-code`}
                  diagram={editing}
                  canEdit={canEditContent}
                  narrow={narrow}
                  onSaved={setCurrent}
                  onDeleted={() => {
                    setCurrent(null)
                    navigate(listPath)
                  }}
                  onBack={() => navigate(listPath)}
                />
              )}
            </section>
          ) : currentError ? (
            <div>
              <p className="alert-error rounded-lg p-4" role="alert">{currentError}</p>
              <Link to={listPath} className="btn-ghost mt-4 inline-block px-4 py-2">Ver diagramas</Link>
            </div>
          ) : (
            <p className="text-slate-400">Abriendo diagrama…</p>
          )
        ) : (
          <section aria-label="Diagramas del tablero">
            {listError && <p className="alert-error mb-4 rounded-lg p-3 text-sm" role="alert">{listError}</p>}
            {loadingList ? (
              <p className="text-slate-400">Cargando diagramas…</p>
            ) : diagrams.length === 0 ? (
              <div className="glass-panel rounded-2xl p-8 text-center">
                <p className="text-3xl" aria-hidden="true">◇</p>
                <h2 className="mt-2 text-lg font-semibold text-white">Este tablero aún no tiene diagramas</h2>
                <p className="mx-auto mt-2 max-w-xl text-sm text-slate-400">
                  Diseña clases, casos de uso, secuencias, arquitectura, procesos y más, todo asociado a este proyecto.
                  Se dibujan con PlantUML directamente en tu navegador.
                </p>
                {canEditContent ? (
                  <button type="button" onClick={() => setCreating(true)} className="btn-mint-primary mt-5 px-4 py-2 text-sm font-semibold">
                    ＋ Añadir el primer diagrama
                  </button>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">Tu rol es de lector: el propietario o un editor puede crearlos.</p>
                )}
              </div>
            ) : (
              <ul className="uml-gallery">
                {diagrams.map((diagram) => {
                  const type = umlDiagramType(diagram.kind)
                  const category = UML_CATEGORIES.find((item) => item.id === type?.category)
                  return (
                    <li key={diagram.id}>
                      <Link to={`${listPath}/${diagram.id}`} className="uml-card glass-panel">
                        <span className="uml-card-icon" aria-hidden="true">{categoryIcons[type?.category ?? 'uml']}</span>
                        <span className="min-w-0">
                          <span className="uml-card-name">{diagram.name}</span>
                          <span className="uml-card-type">{type?.name ?? diagram.kind}</span>
                          <span className="uml-card-meta">
                            {diagram.mode === 'code' ? '⌨ Código' : '✥ Visual'} · {editedAt.format(new Date(diagram.updated_at))}
                          </span>
                        </span>
                        <span className="sr-only">{category?.name}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}
      </div>

      {creating && <NewDiagramModal onCreate={handleCreate} onClose={() => setCreating(false)} />}
    </main>
  )
}

export default BoardDiagrams

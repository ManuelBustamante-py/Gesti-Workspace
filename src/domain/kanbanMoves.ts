// Movimientos de tarjetas al arrastrar y soltar (lógica pura, sin React).
// El estado es «tareas por columna» en el orden en que se muestran.

type MovableTask = { id: string; column_id: string; position: number }
type TasksByColumn<T extends MovableTask> = Record<string, T[]>

/** Columna a la que pertenece un id: el propio id si es una columna, o la columna de esa tarea. */
export function findColumnId<T extends MovableTask>(state: TasksByColumn<T>, id: string, columnIds: string[]) {
  if (columnIds.includes(id)) return id
  return columnIds.find((columnId) => (state[columnId] ?? []).some((task) => task.id === id)) ?? null
}

/**
 * Durante el arrastre: si la tarjeta pasa sobre otra columna, se mueve allí:
 * delante de la tarjeta bajo el cursor, o detrás si el cursor está en su mitad
 * inferior (`placeAfter`); al final si está sobre el espacio libre de la columna.
 * Devuelve null si no hay que cambiar nada.
 */
export function moveAcrossColumns<T extends MovableTask>(
  state: TasksByColumn<T>,
  activeId: string,
  overId: string,
  columnIds: string[],
  placeAfter = false,
): TasksByColumn<T> | null {
  const from = findColumnId(state, activeId, columnIds)
  const to = findColumnId(state, overId, columnIds)
  if (!from || !to || from === to) return null

  const source = [...(state[from] ?? [])]
  const index = source.findIndex((task) => task.id === activeId)
  if (index < 0) return null
  const [moved] = source.splice(index, 1)

  const target = [...(state[to] ?? [])]
  const overIndex = target.findIndex((task) => task.id === overId)
  const insertAt = overIndex >= 0 ? overIndex + (placeAfter ? 1 : 0) : target.length
  target.splice(insertAt, 0, { ...moved, column_id: to })

  return { ...state, [from]: source, [to]: target }
}

/**
 * Al soltar: ordena la columna de destino y numera sus posiciones 0..n.
 *
 * - Sobre una tarjeta de la misma columna: ocupa su lugar (orden de lista).
 * - Sobre el espacio libre de la columna: va al final.
 * - Si acaba de llegar de otra columna y el destino no cambió desde entonces
 *   (`overAtColumnChange`), ya quedó en su sitio durante el arrastre y no se mueve.
 *
 * Devuelve el nuevo estado y el orden a guardar.
 */
export function dropIntoPlace<T extends MovableTask>(
  state: TasksByColumn<T>,
  activeId: string,
  overId: string,
  columnIds: string[],
  originalColumnId: string | null,
  overAtColumnChange: string | null = null,
) {
  const columnId = findColumnId(state, activeId, columnIds)
  if (!columnId) return null

  const list = [...(state[columnId] ?? [])]
  const oldIndex = list.findIndex((task) => task.id === activeId)
  const overIndex = list.findIndex((task) => task.id === overId)
  const placedOnColumnChange = columnId !== originalColumnId && overId === overAtColumnChange
  let newIndex = oldIndex
  if (overId === columnId) newIndex = list.length - 1
  else if (overIndex >= 0 && !placedOnColumnChange) newIndex = overIndex
  const [moved] = list.splice(oldIndex, 1)
  list.splice(newIndex, 0, moved)

  const ordered = list.map((task, position) => ({ ...task, column_id: columnId, position }))
  return {
    state: { ...state, [columnId]: ordered },
    columnId,
    orderedIds: ordered.map((task) => task.id),
  }
}

/** Indica si el orden final difiere del inicial (para no guardar sin cambios). */
export function orderChanged<T extends MovableTask>(
  before: TasksByColumn<T>,
  columnId: string,
  orderedIds: string[],
) {
  const previous = (before[columnId] ?? []).map((task) => task.id)
  return previous.length !== orderedIds.length || previous.some((id, index) => id !== orderedIds[index])
}

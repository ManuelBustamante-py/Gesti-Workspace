import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  closestCenter,
  getFirstCollision,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'

import { dropIntoPlace, findColumnId, moveAcrossColumns, orderChanged } from '../domain/kanbanMoves'
import { reorderColumnTasks, type Task } from '../services/tasks'

type TasksByColumn = Record<string, Task[]>

interface Options {
  columnIds: string[]
  tasksByColumn: TasksByColumn
  setTasksByColumn: (update: TasksByColumn | ((current: TasksByColumn) => TasksByColumn)) => void
  onError: (message: string) => void
  /** Se llama al empezar y terminar un arrastre (para pausar Realtime). */
  onDraggingChange?: (dragging: boolean) => void
}

/**
 * Arrastrar y soltar tarjetas entre columnas y posiciones. Mueve la tarjeta en
 * pantalla mientras se arrastra, guarda el orden final en una sola llamada y,
 * si el servidor lo rechaza, devuelve el tablero a como estaba.
 */
export function useTaskDragAndDrop({ columnIds, tasksByColumn, setTasksByColumn, onError, onDraggingChange }: Options) {
  const sensors = useSensors(
    // El arrastre empieza al mover 4 px desde el asa: un toque simple no arrastra.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const snapshotRef = useRef<TasksByColumn | null>(null)
  const originColumnRef = useRef<string | null>(null)
  const lastOverIdRef = useRef<UniqueIdentifier | null>(null)
  const movedToNewColumnRef = useRef(false)
  // Estado más reciente del tablero. dnd-kit puede emitir varios onDragOver antes
  // de que React vuelva a renderizar: si se calculara sobre el estado del render
  // anterior, el segundo movimiento desharía el primero y ambos se alternarían.
  const latestRef = useRef(tasksByColumn)
  useLayoutEffect(() => {
    latestRef.current = tasksByColumn
  }, [tasksByColumn])

  // Movimiento que llegó mientras el anterior aún se estaba dibujando.
  const pendingMoveRef = useRef<{ activeId: string; overId: string } | null>(null)

  function applyMove(activeId: string, overId: string) {
    const next = moveAcrossColumns(latestRef.current, activeId, overId, columnIds)
    if (!next) return
    movedToNewColumnRef.current = true
    latestRef.current = next
    setTasksByColumn(next)
  }

  // Tras pasar a otra columna, el diseño cambia; durante ese fotograma se
  // conserva el destino para no oscilar entre columnas. En el siguiente se
  // aplica el movimiento que haya quedado pendiente.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      movedToNewColumnRef.current = false
      const pending = pendingMoveRef.current
      pendingMoveRef.current = null
      if (pending && snapshotRef.current) applyMove(pending.activeId, pending.overId)
    })
    return () => cancelAnimationFrame(frame)
    // applyMove solo usa refs y props estables durante el arrastre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksByColumn])

  /**
   * Detector de colisiones para varias columnas (patrón recomendado por dnd-kit):
   * prioriza lo que está bajo el puntero, dentro de una columna elige la tarjeta
   * más cercana y, si no hay colisión, mantiene el último destino. Sin esto, la
   * tarjeta puede alternar entre dos columnas en cada fotograma y React aborta
   * con «Maximum update depth exceeded».
   */
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerCollisions = pointerWithin(args)
      const collisions = pointerCollisions.length > 0 ? pointerCollisions : rectIntersection(args)
      let overId = getFirstCollision(collisions, 'id')

      if (overId != null) {
        if (columnIds.includes(String(overId))) {
          const columnTaskIds = new Set((tasksByColumn[String(overId)] ?? []).map((task) => task.id))
          if (columnTaskIds.size > 0) {
            overId =
              closestCenter({
                ...args,
                droppableContainers: args.droppableContainers.filter((container) => columnTaskIds.has(String(container.id))),
              })[0]?.id ?? overId
          }
        }
        lastOverIdRef.current = overId
        return [{ id: overId }]
      }

      if (movedToNewColumnRef.current) lastOverIdRef.current = activeId
      return lastOverIdRef.current ? [{ id: lastOverIdRef.current }] : []
    },
    [activeId, columnIds, tasksByColumn],
  )

  function restore() {
    pendingMoveRef.current = null
    if (snapshotRef.current) setTasksByColumn(snapshotRef.current)
    snapshotRef.current = null
    setActiveId(null)
    onDraggingChange?.(false)
  }

  function onDragStart({ active }: DragStartEvent) {
    snapshotRef.current = latestRef.current
    originColumnRef.current = findColumnId(latestRef.current, String(active.id), columnIds)
    lastOverIdRef.current = null
    setActiveId(String(active.id))
    onDraggingChange?.(true)
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over || over.id === active.id) return
    // Como máximo un cambio de columna por fotograma: el siguiente espera a que
    // el diseño se reacomode y se vuelva a medir (no se pierde: queda pendiente).
    if (movedToNewColumnRef.current) {
      pendingMoveRef.current = { activeId: String(active.id), overId: String(over.id) }
      return
    }
    applyMove(String(active.id), String(over.id))
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    const snapshot = snapshotRef.current
    pendingMoveRef.current = null
    setActiveId(null)
    if (!over || !snapshot) {
      restore()
      return
    }

    const result = dropIntoPlace(latestRef.current, String(active.id), String(over.id), columnIds, originColumnRef.current)
    snapshotRef.current = null
    if (!result) {
      onDraggingChange?.(false)
      return
    }
    const changedColumn = result.columnId !== originColumnRef.current
    if (!changedColumn && !orderChanged(snapshot, result.columnId, result.orderedIds)) {
      setTasksByColumn(snapshot)
      onDraggingChange?.(false)
      return
    }

    setTasksByColumn(result.state)
    try {
      await reorderColumnTasks(result.columnId, result.orderedIds)
    } catch (err) {
      setTasksByColumn(snapshot)
      onError(err instanceof Error ? err.message : 'No se pudo mover la tarea.')
    } finally {
      onDraggingChange?.(false)
    }
  }

  const activeTask = activeId
    ? Object.values(tasksByColumn).flat().find((task) => task.id === activeId) ?? null
    : null

  return {
    sensors,
    collisionDetection,
    // Las columnas cambian de alto al recibir o perder tarjetas: se miden siempre.
    measuring: { droppable: { strategy: MeasuringStrategy.Always } },
    activeTask,
    dragging: activeId !== null,
    handlers: { onDragStart, onDragOver, onDragEnd, onDragCancel: restore },
  }
}

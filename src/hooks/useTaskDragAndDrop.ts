import { useRef, useState } from 'react'
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
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
}

/**
 * Arrastrar y soltar tarjetas entre columnas y posiciones. Mueve la tarjeta en
 * pantalla mientras se arrastra, guarda el orden final en una sola llamada y,
 * si el servidor lo rechaza, devuelve el tablero a como estaba.
 */
export function useTaskDragAndDrop({ columnIds, tasksByColumn, setTasksByColumn, onError }: Options) {
  const sensors = useSensors(
    // El arrastre empieza al mover 4 px desde el asa: un toque simple no arrastra.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const snapshotRef = useRef<TasksByColumn | null>(null)
  const originColumnRef = useRef<string | null>(null)

  function restore() {
    if (snapshotRef.current) setTasksByColumn(snapshotRef.current)
    snapshotRef.current = null
    setActiveId(null)
  }

  function onDragStart({ active }: DragStartEvent) {
    snapshotRef.current = tasksByColumn
    originColumnRef.current = findColumnId(tasksByColumn, String(active.id), columnIds)
    setActiveId(String(active.id))
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return
    setTasksByColumn((current) => moveAcrossColumns(current, String(active.id), String(over.id), columnIds) ?? current)
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    const snapshot = snapshotRef.current
    setActiveId(null)
    if (!over || !snapshot) {
      restore()
      return
    }

    const result = dropIntoPlace(tasksByColumn, String(active.id), String(over.id), columnIds, originColumnRef.current)
    snapshotRef.current = null
    if (!result) return
    const changedColumn = result.columnId !== originColumnRef.current
    if (!changedColumn && !orderChanged(snapshot, result.columnId, result.orderedIds)) {
      setTasksByColumn(snapshot)
      return
    }

    setTasksByColumn(result.state)
    try {
      await reorderColumnTasks(result.columnId, result.orderedIds)
    } catch (err) {
      setTasksByColumn(snapshot)
      onError(err instanceof Error ? err.message : 'No se pudo mover la tarea.')
    }
  }

  const activeTask = activeId
    ? Object.values(tasksByColumn).flat().find((task) => task.id === activeId) ?? null
    : null

  return {
    sensors,
    activeTask,
    handlers: { onDragStart, onDragOver, onDragEnd, onDragCancel: restore },
  }
}

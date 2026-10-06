import { inferColumnStatus } from '../domain/columnStatus'
import { createBoard, deleteBoard, type Board } from './boards'
import { createBoardColumn } from './columns'
import { createTasks, updateTaskPredecessors, type Task } from './tasks'
import type { ImportedBoard } from './boardWorkbook'

/**
 * Crea un tablero completo a partir de una importación ya validada.
 * Si algo falla a mitad de camino se elimina el tablero creado para no dejar
 * datos a medias.
 */
export async function createBoardFromImport(importedBoard: ImportedBoard, ownerId: string): Promise<Board> {
  const board = await createBoard(
    importedBoard.name,
    importedBoard.description,
    importedBoard.color,
    ownerId,
    { withDefaultColumns: false },
  )

  try {
    const tasksByNumber = new Map<number, Task>()
    for (const importedColumn of importedBoard.columns) {
      const column = await createBoardColumn(board.id, importedColumn.name, inferColumnStatus(importedColumn.name))
      const created = await createTasks(
        column.id,
        importedColumn.tasks.map((task) => ({
          title: task.title,
          description: task.description,
          priority: task.priority,
          startDate: task.startDate,
          endDate: task.endDate,
        })),
      )
      importedColumn.tasks.forEach((task, index) => tasksByNumber.set(task.activityNumber, created[index]))
    }

    for (const importedColumn of importedBoard.columns) {
      for (const importedTask of importedColumn.tasks) {
        if (importedTask.predecessorNumbers.length === 0) continue
        const task = tasksByNumber.get(importedTask.activityNumber)
        const predecessorIds = importedTask.predecessorNumbers
          .map((number) => tasksByNumber.get(number)?.id)
          .filter((id): id is string => Boolean(id))
        if (task && predecessorIds.length > 0) {
          await updateTaskPredecessors(task.id, predecessorIds)
        }
      }
    }
  } catch (error) {
    await deleteBoard(board.id).catch(() => undefined)
    throw error
  }

  return board
}

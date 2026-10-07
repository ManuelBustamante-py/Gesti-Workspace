import type { ColumnStatus } from './columnStatus'
import { diffDays } from './dates'

/** Días hacia adelante que cuentan como «vence pronto». */
export const DUE_SOON_DAYS = 7

/**
 * Situación de plazo de una tarea respecto de hoy. Las completadas nunca están
 * atrasadas ni por vencer.
 * - overdueDays: días desde que pasó su fecha de fin (null si no está atrasada).
 * - dueInDays: días que faltan si vence en los próximos 7 (0 = hoy; null si no).
 */
export function deadlineStatus(task: { end_date: string | null }, status: ColumnStatus, today: string) {
  if (status === 'done' || !task.end_date) return { overdueDays: null, dueInDays: null }
  const remaining = diffDays(today, task.end_date)
  return {
    overdueDays: remaining < 0 ? -remaining : null,
    dueInDays: remaining >= 0 && remaining <= DUE_SOON_DAYS ? remaining : null,
  }
}

/** Resaltado activo en el tablero desde las estadísticas. */
export type BoardHighlight = 'overdue' | 'dueSoon' | 'critical'

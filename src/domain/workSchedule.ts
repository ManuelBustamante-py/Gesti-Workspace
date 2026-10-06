/** 1 = domingo ... 7 = sábado (convención de Excel / MS Project). */
export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5, 6, 7]
export const DEFAULT_WORK_START_TIME = '08:00'
export const DEFAULT_WORK_END_TIME = '17:00'

export interface BoardSchedule {
  working_days: number[]
  work_start_time: string
  work_end_time: string
}

type ScheduleSource = {
  working_days: number[] | null
  work_start_time: string | null
  work_end_time: string | null
}

export function boardWorkingDays(board: Pick<ScheduleSource, 'working_days'> | null | undefined) {
  return board?.working_days?.length ? board.working_days : DEFAULT_WORKING_DAYS
}

export function boardSchedule(board: ScheduleSource): BoardSchedule {
  return {
    working_days: boardWorkingDays(board),
    work_start_time: board.work_start_time?.slice(0, 5) ?? DEFAULT_WORK_START_TIME,
    work_end_time: board.work_end_time?.slice(0, 5) ?? DEFAULT_WORK_END_TIME,
  }
}

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

export function describeWorkingDays(workingDays: number[]) {
  const sorted = [2, 3, 4, 5, 6, 7, 1].filter((day) => workingDays.includes(day))
  if (sorted.length === 7) return 'Todos los días'
  if (sorted.join() === '2,3,4,5,6') return 'Lun–Vie'
  return sorted.map((day) => DAY_NAMES[day - 1]).join(', ')
}

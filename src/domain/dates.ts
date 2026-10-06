// Fechas de calendario como claves 'YYYY-MM-DD'. Toda la aritmética se hace en
// UTC para que el resultado no dependa de la zona horaria ni del horario de
// verano del navegador.

export const DAY_MS = 86400000

/** Días laborables con la convención de Excel / MS Project: 1 = domingo ... 7 = sábado. */
export type WorkingDays = readonly number[]

export const ALL_DAYS: WorkingDays = [1, 2, 3, 4, 5, 6, 7]

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function isValidDateKey(value: string) {
  const match = DATE_KEY_PATTERN.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

export function dateKeyToUtc(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

export function utcToDateKey(time: number) {
  return new Date(time).toISOString().slice(0, 10)
}

/** Fecha local (la del usuario) como clave; no usa toISOString sobre horas locales. */
export function localDateToKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayKey() {
  return localDateToKey(new Date())
}

export function addDays(value: string, days: number) {
  return utcToDateKey(dateKeyToUtc(value) + days * DAY_MS)
}

export function diffDays(from: string, to: string) {
  return Math.round((dateKeyToUtc(to) - dateKeyToUtc(from)) / DAY_MS)
}

/** Día de la semana con la convención 1 = domingo ... 7 = sábado. */
export function weekdayNumber(value: string) {
  return new Date(dateKeyToUtc(value)).getUTCDay() + 1
}

export function isWorkingDay(value: string, workingDays: WorkingDays) {
  return workingDays.includes(weekdayNumber(value))
}

/** Lunes de la semana que contiene la fecha. */
export function startOfWeek(value: string) {
  const weekday = new Date(dateKeyToUtc(value)).getUTCDay()
  return addDays(value, -((weekday + 6) % 7))
}

// Domingo de referencia para numerar días laborables.
const ORDINAL_EPOCH = '2000-01-02'

/** Cantidad de días laborables en [ORDINAL_EPOCH, value). */
export function workingDayOrdinal(value: string, workingDays: WorkingDays) {
  const days = diffDays(ORDINAL_EPOCH, value)
  const weeks = Math.floor(days / 7)
  let count = weeks * workingDays.length
  const remainderStart = addDays(ORDINAL_EPOCH, weeks * 7)
  for (let offset = 0; offset < days - weeks * 7; offset += 1) {
    if (isWorkingDay(addDays(remainderStart, offset), workingDays)) count += 1
  }
  return count
}

/** Días laborables entre dos fechas, ambas incluidas. */
export function countWorkingDays(start: string, end: string, workingDays: WorkingDays) {
  if (end < start) return 0
  return (
    workingDayOrdinal(addDays(end, 1), workingDays) -
    workingDayOrdinal(start, workingDays)
  )
}

/** Duración mostrable: días laborables incluidos, mínimo 1. */
export function taskDuration(start: string, end: string, workingDays: WorkingDays) {
  return Math.max(1, countWorkingDays(start, end, workingDays))
}

/** Número de serie de Excel (sistema 1900) para una fecha, sin depender de la zona horaria. */
export function dateKeyToExcelSerial(value: string) {
  return (dateKeyToUtc(value) - Date.UTC(1899, 11, 30)) / DAY_MS
}

export function excelSerialToDateKey(serial: number) {
  return utcToDateKey(Date.UTC(1899, 11, 30) + Math.round(serial) * DAY_MS)
}

export function formatDateKey(
  value: string,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' },
) {
  return new Date(dateKeyToUtc(value)).toLocaleDateString('es-CL', { ...options, timeZone: 'UTC' })
}

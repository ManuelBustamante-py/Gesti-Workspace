import {
  DEFAULT_WORK_END_TIME,
  DEFAULT_WORK_START_TIME,
  DEFAULT_WORKING_DAYS,
  type Board,
} from './boards'
import type { BoardColumn } from './columns'
import type { Task } from './tasks'

function xml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function dateParts(value: string) {
  if (!isDateOnly(value)) {
    throw new Error(`Fecha inválida para exportar a Project: ${value}`)
  }

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Fecha inválida para exportar a Project: ${value}`)
  }

  return { year, month, day }
}

function isoDate(value: string | null, fallback: string, time: string) {
  const date = value ?? fallback
  dateParts(date)
  return `${date}T${time}:00`
}

function projectDate(value: string, time: string) {
  dateParts(value)
  return `${value}T${time}:00`
}

function projectTime(value: string) {
  const [hours, minutes] = value.slice(0, 5).split(':')
  return `PT${Number(hours)}H${Number(minutes)}M0S`
}

function minutesBetween(start: string, end: string) {
  const [startHours, startMinutes] = start.split(':').map(Number)
  const [endHours, endMinutes] = end.split(':').map(Number)
  return (endHours * 60 + endMinutes) - (startHours * 60 + startMinutes)
}

function calendarWeekDays(
  workingDays: number[],
  startTime: string,
  endTime: string,
) {
  return Array.from({ length: 7 }, (_, index) => {
    const dayType = index + 1
    if (!workingDays.includes(dayType)) {
      return `<WeekDay><DayType>${dayType}</DayType><DayWorking>0</DayWorking></WeekDay>`
    }

    return `<WeekDay><DayType>${dayType}</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>${projectTime(startTime)}</FromTime><ToTime>${projectTime(endTime)}</ToTime></WorkingTime></WorkingTimes></WeekDay>`
  }).join('')
}

function durationInProjectDays(
  start: string,
  finish: string,
  scheduleDays: number[],
) {
  const startParts = dateParts(start)
  const finishParts = dateParts(finish)
  const current = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day))
  const end = new Date(Date.UTC(finishParts.year, finishParts.month - 1, finishParts.day))
  let totalWorkingDays = 0

  while (current < end) {
    const day = current.getUTCDay()
    const projectDayType = day === 0 ? 1 : day + 1
    if (scheduleDays.includes(projectDayType)) {
      totalWorkingDays += 1
    }

    current.setUTCDate(current.getUTCDate() + 1)
  }

  return Math.max(1, totalWorkingDays)
}

export function exportBoardProjectXml(
  board: Board,
  columns: BoardColumn[],
  tasksByColumn: Record<string, Task[]>,
) {
  const tasks = columns.flatMap((column) =>
    (tasksByColumn[column.id] ?? []).map((task) => ({ task, column })),
  )
  const workingDays = board.working_days?.length
    ? board.working_days
    : DEFAULT_WORKING_DAYS
  const workStartTime = board.work_start_time?.slice(0, 5) ?? DEFAULT_WORK_START_TIME
  const workEndTime = board.work_end_time?.slice(0, 5) ?? DEFAULT_WORK_END_TIME
  const minutesPerDay = minutesBetween(workStartTime, workEndTime)
  const fallbackDate = new Date().toISOString().slice(0, 10)
  const scheduledTasks = tasks.map(({ task, column }) => {
    const start = task.start_date ?? task.end_date ?? fallbackDate
    const finish = task.end_date ?? task.start_date ?? fallbackDate
    const durationDays = durationInProjectDays(start, finish, workingDays)
    const status = column.name.toLowerCase().includes('complet') ? 100 : 0
    return {
      task,
      column,
      start,
      finish,
      durationDays,
      status,
    }
  })
  const projectStart = scheduledTasks.reduce(
    (earliest, item) => (item.start < earliest ? item.start : earliest),
    fallbackDate,
  )
  const projectFinish = scheduledTasks.reduce(
    (latest, item) => (item.finish > latest ? item.finish : latest),
    projectStart,
  )
  const taskUids = new Map(scheduledTasks.map(({ task }, index) => [task.id, index + 1]))
  const projectTasks = scheduledTasks.map(
    ({ task, column, start, finish, durationDays, status }, index) => {
      const predecessorLinks = (task.predecessor_ids ?? [])
        .map((predecessorId) => taskUids.get(predecessorId))
        .filter((uid): uid is number => uid !== undefined)
        .map(
          (uid) =>
            `<PredecessorLink><PredecessorUID>${uid}</PredecessorUID><Type>0</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`,
        )
        .join('')

      return `<Task><UID>${index + 1}</UID><ID>${index + 1}</ID><Name>${xml(task.title)}</Name><Notes>${xml(task.description ?? '')}</Notes><Active>1</Active><Manual>1</Manual><Type>1</Type><CalendarUID>1</CalendarUID><Start>${isoDate(start, fallbackDate, workStartTime)}</Start><Finish>${isoDate(finish, start, workEndTime)}</Finish><Duration>PT${Math.floor((durationDays * minutesPerDay) / 60)}H${(durationDays * minutesPerDay) % 60}M0S</Duration><DurationFormat>7</DurationFormat><Estimated>0</Estimated><PercentComplete>${status}</PercentComplete><Priority>${task.priority === 'high' ? 900 : task.priority === 'low' ? 100 : 500}</Priority><Text1>${xml(column.name)}</Text1>${predecessorLinks}</Task>`
    },
  ).join('')

  const content = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>14</SaveVersion>
  <Name>${xml(board.name)}</Name>
  <Title>${xml(board.name)}</Title>
  <Subject>${xml(board.description ?? '')}</Subject>
  <ScheduleFromStart>0</ScheduleFromStart>
  <CalendarUID>1</CalendarUID>
  <DateFormat>17</DateFormat>
  <StartDate>${projectDate(projectStart, workStartTime)}</StartDate>
  <FinishDate>${isoDate(projectFinish, projectStart, workEndTime)}</FinishDate>
  <DefaultStartTime>${projectTime(workStartTime)}</DefaultStartTime>
  <DefaultFinishTime>${projectTime(workEndTime)}</DefaultFinishTime>
  <MinutesPerDay>${minutesPerDay}</MinutesPerDay>
  <MinutesPerWeek>${workingDays.length * minutesPerDay}</MinutesPerWeek>
  <Calendars>
    <Calendar>
      <UID>1</UID>
      <Name>Gesti - Todos los días</Name>
      <IsBaseCalendar>1</IsBaseCalendar>
      <BaseCalendarUID>0</BaseCalendarUID>
      <WeekDays>
        ${calendarWeekDays(workingDays, workStartTime, workEndTime)}
      </WeekDays>
    </Calendar>
  </Calendars>
  <Tasks>${projectTasks}</Tasks>
</Project>`
  const blob = new Blob([content], { type: 'application/xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${board.name.replace(/[^\w\s-]/g, '').trim() || 'tablero'}-gantt.xml`
  anchor.click()
  URL.revokeObjectURL(url)
}

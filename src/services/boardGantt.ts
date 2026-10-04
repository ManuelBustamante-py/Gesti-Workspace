import type { Board } from './boards'
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

function isoDate(value: string | null, fallback: string) {
  return `${value ?? fallback}T08:00:00`
}

function projectDate(value: string) {
  return `${value}T08:00:00`
}

function durationInProjectMinutes(start: string, finish: string) {
  const startTime = new Date(`${start}T00:00:00`).getTime()
  const finishTime = new Date(`${finish}T00:00:00`).getTime()
  const elapsedDays = Math.round((finishTime - startTime) / 86400000)
  return Math.max(480, elapsedDays * 480)
}

export function exportBoardProjectXml(
  board: Board,
  columns: BoardColumn[],
  tasksByColumn: Record<string, Task[]>,
) {
  const tasks = columns.flatMap((column) =>
    (tasksByColumn[column.id] ?? []).map((task) => ({ task, column })),
  )
  const fallbackDate = new Date().toISOString().slice(0, 10)
  const scheduledTasks = tasks.map(({ task, column }) => {
    const start = task.start_date ?? task.end_date ?? fallbackDate
    const finish = task.end_date ?? task.start_date ?? fallbackDate
    const durationMinutes = durationInProjectMinutes(start, finish)
    const status = column.name.toLowerCase().includes('complet') ? 100 : 0
    return {
      task,
      column,
      start,
      finish,
      durationMinutes,
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
    ({ task, column, start, finish, durationMinutes, status }, index) => {
      const predecessorLinks = (task.predecessor_ids ?? [])
        .map((predecessorId) => taskUids.get(predecessorId))
        .filter((uid): uid is number => uid !== undefined)
        .map(
          (uid) =>
            `<PredecessorLink><PredecessorUID>${uid}</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`,
        )
        .join('')

      return `<Task><UID>${index + 1}</UID><ID>${index + 1}</ID><Name>${xml(task.title)}</Name><Notes>${xml(task.description ?? '')}</Notes><Active>1</Active><Manual>1</Manual><Type>1</Type><IsNull>0</IsNull><CalendarUID>1</CalendarUID><Start>${isoDate(start, fallbackDate)}</Start><Finish>${isoDate(finish, start)}</Finish><Duration>PT${durationMinutes}M</Duration><DurationFormat>7</DurationFormat><Estimated>0</Estimated><PercentComplete>${status}</PercentComplete><Priority>${task.priority === 'high' ? 900 : task.priority === 'low' ? 100 : 500}</Priority><Text1>${xml(column.name)}</Text1>${predecessorLinks}</Task>`
    },
  ).join('')

  const content = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>14</SaveVersion>
  <Name>${xml(board.name)}</Name>
  <Title>${xml(board.name)}</Title>
  <Subject>${xml(board.description ?? '')}</Subject>
  <ScheduleFromStart>1</ScheduleFromStart>
  <CalendarUID>1</CalendarUID>
  <StartDate>${projectDate(projectStart)}</StartDate>
  <FinishDate>${projectDate(projectFinish)}</FinishDate>
  <DefaultStartTime>PT08H0M0S</DefaultStartTime>
  <DefaultFinishTime>PT17H0M0S</DefaultFinishTime>
  <MinutesPerDay>480</MinutesPerDay>
  <MinutesPerWeek>3360</MinutesPerWeek>
  <Calendars>
    <Calendar>
      <UID>1</UID>
      <Name>Gesti - Todos los días</Name>
      <IsBaseCalendar>1</IsBaseCalendar>
      <BaseCalendarUID>0</BaseCalendarUID>
      <WeekDays>
        <WeekDay><DayType>1</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>PT08H0M0S</FromTime><ToTime>PT12H0M0S</ToTime></WorkingTime><WorkingTime><FromTime>PT13H0M0S</FromTime><ToTime>PT17H0M0S</ToTime></WorkingTime></WorkingTimes></WeekDay>
        <WeekDay><DayType>2</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>PT08H0M0S</FromTime><ToTime>PT12H0M0S</ToTime></WorkingTime><WorkingTime><FromTime>PT13H0M0S</FromTime><ToTime>PT17H0M0S</ToTime></WorkingTime></WorkingTimes></WeekDay>
        <WeekDay><DayType>3</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>PT08H0M0S</FromTime><ToTime>PT12H0M0S</ToTime></WorkingTime><WorkingTime><FromTime>PT13H0M0S</FromTime><ToTime>PT17H0M0S</ToTime></WorkingTime></WorkingTimes></WeekDay>
        <WeekDay><DayType>4</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>PT08H0M0S</FromTime><ToTime>PT12H0M0S</ToTime></WorkingTime><WorkingTime><FromTime>PT13H0M0S</FromTime><ToTime>PT17H0M0S</ToTime></WorkingTime></WorkingTimes></WeekDay>
        <WeekDay><DayType>5</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>PT08H0M0S</FromTime><ToTime>PT12H0M0S</ToTime></WorkingTime><WorkingTime><FromTime>PT13H0M0S</FromTime><ToTime>PT17H0M0S</ToTime></WorkingTime></WorkingTimes></WeekDay>
        <WeekDay><DayType>6</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>PT08H0M0S</FromTime><ToTime>PT12H0M0S</ToTime></WorkingTime><WorkingTime><FromTime>PT13H0M0S</FromTime><ToTime>PT17H0M0S</ToTime></WorkingTime></WorkingTimes></WeekDay>
        <WeekDay><DayType>7</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>PT08H0M0S</FromTime><ToTime>PT12H0M0S</ToTime></WorkingTime><WorkingTime><FromTime>PT13H0M0S</FromTime><ToTime>PT17H0M0S</ToTime></WorkingTime></WorkingTimes></WeekDay>
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

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
    const durationDays = Math.max(
      1,
      Math.round(
        (new Date(`${finish}T00:00:00`).getTime() -
          new Date(`${start}T00:00:00`).getTime()) /
          86400000,
      ) + 1,
    )
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
  const projectTasks = scheduledTasks.map(
    ({ task, column, start, finish, durationDays, status }, index) =>
      `<Task><UID>${index + 1}</UID><ID>${index + 1}</ID><Name>${xml(task.title)}</Name><Notes>${xml(task.description ?? '')}</Notes><Manual>1</Manual><Type>1</Type><Start>${isoDate(start, fallbackDate)}</Start><Finish>${isoDate(finish, start)}</Finish><Duration>PT${durationDays * 480}M0S</Duration><ConstraintType>4</ConstraintType><ConstraintDate>${isoDate(start, fallbackDate)}</ConstraintDate><PercentComplete>${status}</PercentComplete><Priority>${task.priority === 'high' ? 900 : task.priority === 'low' ? 100 : 500}</Priority><Text1>${xml(column.name)}</Text1></Task>`,
  ).join('')

  const content = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>14</SaveVersion>
  <Name>${xml(board.name)}</Name>
  <Title>${xml(board.name)}</Title>
  <Subject>${xml(board.description ?? '')}</Subject>
  <ScheduleFromStart>1</ScheduleFromStart>
  <StartDate>${projectDate(projectStart)}</StartDate>
  <FinishDate>${projectDate(projectFinish)}</FinishDate>
  <DefaultStartTime>PT08H0M0S</DefaultStartTime>
  <DefaultFinishTime>PT17H0M0S</DefaultFinishTime>
  <MinutesPerDay>480</MinutesPerDay>
  <MinutesPerWeek>2400</MinutesPerWeek>
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

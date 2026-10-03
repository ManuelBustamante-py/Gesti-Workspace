import type { FormEvent } from 'react'

import type { BoardColumn } from '../../services/columns'
import type { Task, TaskPriority } from '../../services/tasks'
import TaskCard, { type EditingTaskState } from './TaskCard'

interface ColumnProps {
  column: BoardColumn
  tasks: Task[]
  columns: BoardColumn[]
  editingColumn: boolean
  editingColumnName: string
  savingColumn: boolean
  taskDraft: { title: string; priority: TaskPriority; startDate: string; endDate: string }
  creatingTask: boolean
  editingTask: EditingTaskState | null
  savingTask: boolean
  movingTaskId: string | null
  onColumnNameChange: (value: string) => void
  onSaveColumn: () => void
  onCancelColumn: () => void
  onStartEditColumn: () => void
  onDeleteColumn: () => void
  onTaskDraftChange: (changes: Partial<ColumnProps['taskDraft']>) => void
  onCreateTask: () => void
  onStartEditTask: (task: Task) => void
  onEditTaskChange: (changes: Partial<EditingTaskState>) => void
  onSaveTask: () => void
  onCancelTask: () => void
  onMoveTask: (task: Task, columnId: string) => void
  onDeleteTask: (task: Task) => void
  availableTasks: Task[]
  selectedTaskId: string | null
  onSelectTaskRelation: (taskId: string) => void
}

function Column({
  column,
  tasks,
  columns,
  editingColumn,
  editingColumnName,
  savingColumn,
  taskDraft,
  creatingTask,
  editingTask,
  savingTask,
  movingTaskId,
  onColumnNameChange,
  onSaveColumn,
  onCancelColumn,
  onStartEditColumn,
  onDeleteColumn,
  onTaskDraftChange,
  onCreateTask,
  onStartEditTask,
  onEditTaskChange,
  onSaveTask,
  onCancelTask,
  onMoveTask,
  onDeleteTask,
  availableTasks,
  selectedTaskId,
  onSelectTaskRelation,
}: ColumnProps) {
  const normalizedName = column.name.toLowerCase()
  const statusClass = normalizedName.includes('complet') || normalizedName.includes('final')
    ? 'column-status-complete'
    : normalizedName.includes('progreso') || normalizedName.includes('proceso')
      ? 'column-status-progress'
      : normalizedName.includes('hacer') || normalizedName.includes('pendiente')
        ? 'column-status-todo'
        : 'column-status-neutral'

  function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onCreateTask()
  }

  return (
    <div className={`column-panel ${statusClass}`}>
      {editingColumn ? (
        <div className="space-y-3">
          <input
            type="text"
            value={editingColumnName}
            onChange={(event) => onColumnNameChange(event.target.value)}
            className="control-input w-full rounded-lg px-3 py-2 outline-none"
          />
          <div className="flex gap-2">
            <button type="button" onClick={onSaveColumn} disabled={savingColumn} className="btn-mint-primary px-3 py-2 text-sm">
              {savingColumn ? 'Guardando...' : 'Guardar'}
            </button>
            <button type="button" onClick={onCancelColumn} className="btn-ghost px-3 py-2 text-sm">
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-base font-semibold text-[var(--text-main)]">{column.name}</h4>
            <span className="text-xs text-[var(--text-muted)]">{tasks.length}</span>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={onStartEditColumn} className="btn-ghost px-3 py-2 text-sm">Editar</button>
            <button type="button" onClick={onDeleteColumn} className="btn-danger px-3 py-2 text-sm">Eliminar</button>
          </div>
        </>
      )}

      <form onSubmit={submitTask} className="mt-5 space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={taskDraft.title}
            onChange={(event) => onTaskDraftChange({ title: event.target.value })}
            placeholder="Nueva tarea"
            className="control-input min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none"
          />
          <button type="submit" disabled={creatingTask} className="btn-mint-primary px-3 py-2 text-sm">
            {creatingTask ? '...' : 'Agregar'}
          </button>
        </div>
        <div className="flex gap-2">
          <select value={taskDraft.priority} onChange={(event) => onTaskDraftChange({ priority: event.target.value as TaskPriority })} className="control-input rounded-lg px-2 py-2 text-sm">
            <option value="low">Baja</option>
            <option value="medium">Media</option>
            <option value="high">Alta</option>
          </select>
          <input type="date" value={taskDraft.startDate} onChange={(event) => onTaskDraftChange({ startDate: event.target.value })} className="control-input min-w-0 flex-1 rounded-lg px-2 py-2 text-sm" aria-label="Fecha de inicio" />
          <input type="date" value={taskDraft.endDate} onChange={(event) => onTaskDraftChange({ endDate: event.target.value })} className="control-input min-w-0 flex-1 rounded-lg px-2 py-2 text-sm" aria-label="Fecha de fin" />
        </div>
      </form>

      <div className="mt-4 space-y-2">
        {tasks.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No hay tareas aún.</p>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              columns={columns}
              editingTask={editingTask}
              savingTask={savingTask}
              movingTask={movingTaskId === task.id}
              onStartEdit={onStartEditTask}
              onEditChange={onEditTaskChange}
              onSaveEdit={onSaveTask}
              onCancelEdit={onCancelTask}
              onMove={onMoveTask}
              onDelete={onDeleteTask}
              availableTasks={availableTasks}
              selectedTaskId={selectedTaskId}
              onSelectTaskRelation={onSelectTaskRelation}
            />
          ))
        )}
      </div>
    </div>
  )
}

export default Column

import { useId, useMemo, useState, type KeyboardEvent } from 'react'

import { searchTasks } from '../../domain/taskSearch'
import type { BoardColumn } from '../../services/columns'
import type { Task } from '../../services/tasks'

interface TaskSearchProps {
  columns: BoardColumn[]
  tasksByColumn: Record<string, Task[]>
  numbers: Map<string, number>
  onSelect: (taskId: string) => void
}

/** Buscador del tablero: por número («12», «#12») o parte del título; lleva a la tarjeta. */
function TaskSearch({ columns, tasksByColumn, numbers, onSelect }: TaskSearchProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listId = useId()

  const tasks = useMemo(
    () => columns.flatMap((column) => (tasksByColumn[column.id] ?? []).map((task) => ({ ...task, columnName: column.name }))),
    [columns, tasksByColumn],
  )
  const results = useMemo(() => searchTasks(tasks, numbers, query), [tasks, numbers, query])
  const showResults = query.trim().length > 0

  function choose(taskId: string) {
    onSelect(taskId)
    setQuery('')
    setActiveIndex(0)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (results.length === 0) return
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((current) => (current + step + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const result = results[activeIndex] ?? results[0]
      if (result) choose(result.task.id)
    } else if (event.key === 'Escape') {
      setQuery('')
      setActiveIndex(0)
    }
  }

  return (
    <div className="task-search">
      <input
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
        }}
        onKeyDown={handleKeyDown}
        placeholder="N.º de tarea (ej. 12) o parte del título"
        aria-label="Buscar tarea por número o título"
        role="combobox"
        aria-expanded={showResults}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showResults && results[activeIndex] ? `${listId}-${results[activeIndex].task.id}` : undefined}
        className="theme-input w-full rounded-lg px-4 py-3"
      />
      {showResults && (
        <ul id={listId} role="listbox" className="task-search-results">
          {results.length === 0 ? (
            <li className="task-search-empty">No hay tareas que coincidan.</li>
          ) : (
            results.map(({ task, number }, index) => (
              <li
                key={task.id}
                id={`${listId}-${task.id}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`task-search-option ${index === activeIndex ? 'task-search-option-active' : ''}`}
                // mousedown evita que el campo pierda el foco antes de elegir.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(task.id)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="task-number">{number ?? '–'}</span>
                <span className="min-w-0 flex-1 truncate">{task.title}</span>
                <span className="task-search-column">{task.columnName}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

export default TaskSearch

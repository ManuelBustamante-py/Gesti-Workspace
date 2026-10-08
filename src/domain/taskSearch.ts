export interface SearchableTask {
  id: string
  title: string
}

export interface TaskSearchResult<T extends SearchableTask> {
  task: T
  number: number | undefined
}

/** Minúsculas y sin tildes: «Revisión» y «revision» coinciden. */
function normalize(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/**
 * Busca tareas por número («12» o «#12») o por parte del título.
 * Con un número, primero va la coincidencia exacta y luego los números que
 * empiezan igual (1 → 1, 10, 11…); el título también se busca, al final.
 */
export function searchTasks<T extends SearchableTask>(
  tasks: T[],
  numbers: Map<string, number>,
  query: string,
  limit = 6,
): TaskSearchResult<T>[] {
  const text = normalize(query)
  if (!text) return []

  const withNumber = tasks.map((task) => ({ task, number: numbers.get(task.id) }))
  const digits = /^#?\s*(\d+)$/.exec(text)?.[1]
  const byNumber = (a: TaskSearchResult<T>, b: TaskSearchResult<T>) => (a.number ?? Infinity) - (b.number ?? Infinity)

  const ranked: TaskSearchResult<T>[] = []
  if (digits) {
    const target = Number(digits)
    ranked.push(...withNumber.filter((item) => item.number === target))
    ranked.push(
      ...withNumber
        .filter((item) => item.number !== undefined && item.number !== target && String(item.number).startsWith(digits))
        .sort(byNumber),
    )
  }
  const seen = new Set(ranked.map((item) => item.task.id))
  ranked.push(
    ...withNumber
      .filter((item) => !seen.has(item.task.id) && normalize(item.task.title).includes(text))
      .sort(byNumber),
  )
  return ranked.slice(0, limit)
}

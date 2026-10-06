type DependencyNode = { id: string; predecessor_ids?: string[] | null }

/** Indica si asignar `predecessorIds` a `taskId` crearía un ciclo. */
export function createsDependencyCycle(
  tasks: DependencyNode[],
  taskId: string,
  predecessorIds: string[],
) {
  const dependencies = new Map(
    tasks.map((task) => [
      task.id,
      task.id === taskId ? predecessorIds : task.predecessor_ids ?? [],
    ]),
  )
  if (!dependencies.has(taskId)) dependencies.set(taskId, predecessorIds)
  return findCycle(dependencies) !== null
}

/** Devuelve los ids de un ciclo si existe; null si el grafo es acíclico. */
export function findCycle(dependencies: Map<string, string[]>) {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const path: string[] = []

  function visit(id: string): string[] | null {
    if (visiting.has(id)) return path.slice(path.indexOf(id))
    if (visited.has(id)) return null
    visiting.add(id)
    path.push(id)
    for (const predecessorId of dependencies.get(id) ?? []) {
      if (!dependencies.has(predecessorId)) continue
      const cycle = visit(predecessorId)
      if (cycle) return cycle
    }
    path.pop()
    visiting.delete(id)
    visited.add(id)
    return null
  }

  for (const id of dependencies.keys()) {
    const cycle = visit(id)
    if (cycle) return cycle
  }
  return null
}

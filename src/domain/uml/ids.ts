/** Nuevo id corto y único dentro del modelo (sirve también como alias en PlantUML). */
export function nextId(prefix: 'n' | 'e' | 'p' | 'm', usedIds: Iterable<string>) {
  let max = 0
  for (const id of usedIds) {
    const match = new RegExp(`^${prefix}(\\d+)$`).exec(id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `${prefix}${max + 1}`
}

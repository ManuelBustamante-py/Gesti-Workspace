/**
 * Coloca `item` al principio de la lista sin duplicarlo. Necesario porque
 * Realtime puede traer el mismo elemento antes de que termine la operación
 * que lo creó (por ejemplo, una importación larga).
 */
export function prependUniqueById<T extends { id: string }>(list: T[], item: T) {
  return [item, ...list.filter((current) => current.id !== item.id)]
}

import type { GraphEdge, GraphModel, GraphNode, VisualModel } from './visualModel'
import { isGraphModel } from './visualModel'

/**
 * Cambios de un diagrama para la colaboración en vivo. En los diagramas de
 * grafo se envía solo lo que cambió (elementos y relaciones agregados,
 * modificados o eliminados): dos personas editando elementos distintos al
 * mismo tiempo no se pisan. En el resto se envía el modelo completo.
 */
export type LivePatch =
  | { replace: VisualModel }
  | {
    kind: string
    settings?: Partial<Pick<GraphModel, 'title' | 'direction' | 'layout' | 'extra'>>
    nodes: { upsert: GraphNode[]; remove: string[] }
    edges: { upsert: GraphEdge[]; remove: string[] }
  }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function diffModels(previous: VisualModel, next: VisualModel): LivePatch | null {
  if (!isGraphModel(previous) || !isGraphModel(next) || previous.kind !== next.kind) return same(previous, next) ? null : { replace: next }
  const settingsKeys = ['title', 'direction', 'layout', 'extra'] as const
  const settings: Partial<Pick<GraphModel, (typeof settingsKeys)[number]>> = {}
  for (const key of settingsKeys) if (!same(previous[key], next[key])) Object.assign(settings, { [key]: next[key] })
  const changed = <T extends { id: string }>(before: T[], after: T[]) => {
    const old = new Map(before.map((item) => [item.id, item]))
    const current = new Set(after.map((item) => item.id))
    return {
      upsert: after.filter((item) => !same(old.get(item.id), item)),
      remove: before.filter((item) => !current.has(item.id)).map((item) => item.id),
    }
  }
  const nodes = changed(previous.nodes, next.nodes)
  const edges = changed(previous.edges, next.edges)
  if (!Object.keys(settings).length && !nodes.upsert.length && !nodes.remove.length && !edges.upsert.length && !edges.remove.length) return null
  return { kind: next.kind, ...(Object.keys(settings).length ? { settings } : {}), nodes, edges }
}

export function applyPatch(model: VisualModel, patch: LivePatch): VisualModel {
  if ('replace' in patch) return patch.replace
  if (!isGraphModel(model) || model.kind !== patch.kind) return model
  const merge = <T extends { id: string }>(items: T[], change: { upsert: T[]; remove: string[] }, containersFirst?: (item: T) => boolean) => {
    const removed = new Set(change.remove)
    const incoming = new Map(change.upsert.map((item) => [item.id, item]))
    const result = items.filter((item) => !removed.has(item.id)).map((item) => incoming.get(item.id) ?? item)
    const existing = new Set(result.map((item) => item.id))
    for (const item of change.upsert) {
      if (existing.has(item.id)) continue
      // Los contenedores nuevos van al principio (se dibujan detrás).
      if (containersFirst?.(item)) result.unshift(item)
      else result.push(item)
    }
    return result
  }
  const nodes = merge(model.nodes, patch.nodes, (node) => node.width !== undefined)
  const ids = new Set(nodes.map((node) => node.id))
  return {
    ...model,
    ...patch.settings,
    nodes,
    // Una relación cuyo elemento ya no existe se descarta.
    edges: merge(model.edges, patch.edges).filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
  }
}

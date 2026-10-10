import { describe, expect, it } from 'vitest'

import { initialModel } from './examples'
import { applyPatch, diffModels } from './liveSync'
import { moveNodes, updateNode, addNode, deleteNode } from './modelOps'
import type { GraphModel } from './visualModel'

const base = () => initialModel('class', true) as GraphModel

describe('colaboración en vivo · cambios por elemento', () => {
  it('sin cambios no hay nada que enviar', () => {
    expect(diffModels(base(), base())).toBeNull()
  })

  it('dos personas editando elementos distintos no se pisan', () => {
    const start = base()
    // A mueve «Usuario»; B, al mismo tiempo, renombra «Tarea».
    const a = moveNodes(start, new Map([['n1', { x: 80, y: 60 }]]), 100, 0)
    const b = updateNode(start, 'n3', { name: 'Actividad' })
    const patchA = diffModels(start, a)!
    const patchB = diffModels(start, b)!
    // Cada uno aplica el cambio del otro sobre su propio estado.
    const onA = applyPatch(a, patchB) as GraphModel
    const onB = applyPatch(b, patchA) as GraphModel
    expect(onA).toEqual(onB)
    expect(onA.nodes.find((node) => node.id === 'n1')!.x).toBe(180)
    expect(onA.nodes.find((node) => node.id === 'n3')!.name).toBe('Actividad')
  })

  it('altas y bajas: las relaciones de un elemento eliminado se descartan', () => {
    const start = base()
    const added = addNode(start, 'class', { x: 900, y: 100 })
    const withNode = applyPatch(start, diffModels(start, added.model)!) as GraphModel
    expect(withNode.nodes.some((node) => node.id === added.id)).toBe(true)
    const removed = deleteNode(start, 'n2')
    const other = applyPatch(start, diffModels(start, removed)!) as GraphModel
    expect(other.nodes.some((node) => node.id === 'n2')).toBe(false)
    expect(other.edges.some((edge) => edge.source === 'n2' || edge.target === 'n2')).toBe(false)
  })

  it('ajustes del diagrama viajan solos; otros tipos se reemplazan completos', () => {
    const start = base()
    const patch = diffModels(start, { ...start, title: 'Nuevo' })!
    expect(patch).toMatchObject({ settings: { title: 'Nuevo' }, nodes: { upsert: [], remove: [] } })
    const sequence = initialModel('sequence', true)
    const changed = { ...sequence, autonumber: true }
    expect(diffModels(sequence, changed)).toEqual({ replace: changed })
  })
})

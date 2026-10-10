import { describe, expect, it } from 'vitest'

import {
  addEdge,
  addMessage,
  addNode,
  addParticipant,
  deleteNode,
  deleteParticipant,
  descendantsOf,
  moveMessage,
  moveNodes,
  moveParticipant,
  reverseEdge,
} from './modelOps'
import { initialModel, type GraphModel, type SequenceModel } from './visualModel'
import { nodeRect } from './geometry'
import { parallelOffsets } from '../../components/uml/visual/shapes'

const usecase = () => initialModel('usecase', true) as GraphModel
const sequence = () => initialModel('sequence', true) as SequenceModel

describe('operaciones de grafo', () => {
  it('agrega elementos con nombre único, centrados y con contenedores al fondo', () => {
    const first = addNode(initialModel('class', false) as GraphModel, 'class', { x: 200, y: 200 })
    const second = addNode(first.model, 'class', { x: 400, y: 200 })
    expect(second.model.nodes.map((node) => [node.id, node.name])).toEqual([['n1', 'Clase'], ['n2', 'Clase 2']])
    const withPackage = addNode(second.model, 'package', { x: 0, y: 0 })
    expect(withPackage.model.nodes[0].type).toBe('package')
  })

  it('al mover un contenedor arrastra lo que tiene dentro', () => {
    const model = usecase()
    expect(descendantsOf(model, 'n3').sort()).toEqual(['n4', 'n5', 'n6', 'n7'])
    const origins = new Map(['n3', 'n4'].map((id) => {
      const node = model.nodes.find((item) => item.id === id)!
      return [id, { x: node.x, y: node.y }] as const
    }))
    const moved = moveNodes(model, origins, 33, 0)
    expect(moved.nodes.find((node) => node.id === 'n3')!.x).toBe(250)
    expect(moved.nodes.find((node) => node.id === 'n1')!.x).toBe(60)
  })

  it('las notas se conectan con enlace de nota; contenedores y duplicados no se conectan', () => {
    const withNote = addNode(usecase(), 'note', { x: 800, y: 100 })
    expect(addEdge(withNote.model, 'include', withNote.id, 'n5').model.edges.at(-1)!.type).toBe('note-link')
    expect(addEdge(usecase(), 'association', 'n1', 'n3').id).toBeNull()
    expect(addEdge(usecase(), 'association', 'n1', 'n4').id).toBeNull()
    expect(addEdge(usecase(), 'association', 'n1', 'n1').id).toBeNull()
  })

  it('las clases admiten asociaciones recursivas', () => {
    expect(addEdge(initialModel('class', true) as GraphModel, 'association', 'n1', 'n1').id).toBe('e4')
  })

  it('eliminar un elemento quita sus relaciones pero conserva lo que contenía', () => {
    const model = deleteNode(deleteNode(usecase(), 'n5'), 'n3')
    expect(model.edges.map((edge) => edge.id)).toEqual(['e1', 'e4'])
    expect(model.nodes.some((node) => node.id === 'n4')).toBe(true)
  })

  it('invertir intercambia extremos y multiplicidades', () => {
    const model = reverseEdge(initialModel('class', true) as GraphModel, 'e1')
    expect(model.edges[0]).toMatchObject({ source: 'n2', target: 'n1', sourceLabel: '*', targetLabel: '1' })
  })
})

describe('operaciones de secuencia', () => {
  it('inserta y reordena participantes', () => {
    const { model, id } = addParticipant(sequence(), 'entity', 1)
    expect(model.participants.map((participant) => participant.id)).toEqual(['p1', id, 'p2', 'p3', 'p4'])
    expect(moveParticipant(model, 'p1', 4).participants.map((participant) => participant.id)).toEqual([id, 'p2', 'p3', 'p4', 'p1'])
  })

  it('inserta mensajes en su posición, los reordena y los borra con su participante', () => {
    const { model, id } = addMessage(sequence(), 'p1', 'p1', 'async', 0)
    expect(model.messages[0]).toMatchObject({ id, from: 'p1', to: 'p1', type: 'async' })
    expect(moveMessage(model, id, 6).messages.at(-1)!.id).toBe(id)
    expect(deleteParticipant(model, 'p4').messages.map((message) => message.id)).toEqual([id, 'm1', 'm2', 'm5', 'm6'])
  })
})

describe('ubicación y relaciones paralelas', () => {
  it('al agregar con clic busca un hueco libre cerca del punto pedido', () => {
    const base = initialModel('class', true) as GraphModel
    const target = nodeRect(base.nodes.find((node) => node.id === 'n3')!)
    const { model, id } = addNode(base, 'class', { x: target.x + 40, y: target.y + 30 }, true)
    const added = nodeRect(model.nodes.find((node) => node.id === id)!)
    const collides = base.nodes.map(nodeRect).some((rect) =>
      added.x < rect.x + rect.width && rect.x < added.x + added.width && added.y < rect.y + rect.height && rect.y < added.y + added.height)
    expect(collides).toBe(false)
  })

  it('separa las relaciones entre el mismo par y deja las únicas centradas', () => {
    const offsets = parallelOffsets([
      { id: 'a', type: 'association', source: 'n1', target: 'n2' },
      { id: 'b', type: 'generalization', source: 'n2', target: 'n1' },
      { id: 'c', type: 'association', source: 'n1', target: 'n3' },
    ])
    expect([offsets.get('a'), offsets.get('b'), offsets.get('c')]).toEqual([-7, 7, 0])
  })
})

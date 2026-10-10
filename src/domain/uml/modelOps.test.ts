import { describe, expect, it } from 'vitest'

import { initialModel } from './examples'
import { nodeRect } from './geometry'
import {
  addBend,
  addEdge,
  addMessage,
  addNode,
  addParticipant,
  addRawRow,
  bendsWithin,
  deleteNode,
  deleteParticipant,
  descendantsOf,
  moveBend,
  moveMessage,
  moveNodes,
  moveParticipant,
  removeBend,
  reverseEdge,
} from './modelOps'
import { emptyModel, type GraphModel, type SequenceModel } from './visualModel'
import { parallelOffsets } from '../../components/uml/visual/shapes'

const usecase = () => initialModel('usecase', true) as GraphModel
const sequence = () => initialModel('sequence', true) as SequenceModel
const classes = () => initialModel('class', true) as GraphModel

describe('operaciones de grafo', () => {
  it('agrega elementos con nombre único y con los miembros por defecto de su tipo', () => {
    const first = addNode(emptyModel('class') as GraphModel, 'class', { x: 200, y: 200 })
    const second = addNode(first.model, 'class', { x: 400, y: 200 })
    expect(second.model.nodes.map((node) => [node.id, node.name])).toEqual([['n1', 'Clase'], ['n2', 'Clase 2']])
    expect(second.model.nodes[0].methods).toEqual(['+ operacion(): void'])
    expect(addNode(second.model, 'package', { x: 0, y: 0 }).model.nodes[0].type).toBe('package')
  })

  it('al mover un contenedor arrastra lo que tiene dentro y sus codos internos', () => {
    let model = usecase()
    model = addBend(model, 'e3', { x: 400, y: 300 }).model
    expect(descendantsOf(model, 'n3').sort()).toEqual(['n4', 'n5', 'n6', 'n7'])
    const ids = new Set(['n3', ...descendantsOf(model, 'n3')])
    const origins = new Map([...ids].map((id) => {
      const node = model.nodes.find((item) => item.id === id)!
      return [id, { x: node.x, y: node.y }] as const
    }))
    const moved = moveNodes(model, origins, 30, 0, bendsWithin(model, ids))
    expect(moved.nodes.find((node) => node.id === 'n3')!.x).toBe(250)
    expect(moved.nodes.find((node) => node.id === 'n1')!.x).toBe(60)
    expect(moved.edges.find((edge) => edge.id === 'e3')!.points).toEqual([{ x: 430, y: 300 }])
  })

  it('las notas se conectan con enlace de nota; contenedores, duplicados y [*] mal usados no se conectan', () => {
    const withNote = addNode(usecase(), 'note', { x: 800, y: 100 })
    expect(addEdge(withNote.model, 'include', withNote.id, 'n5').model.edges.at(-1)!.type).toBe('note-link')
    expect(addEdge(usecase(), 'association', 'n1', 'n3').id).toBeNull()
    expect(addEdge(usecase(), 'association', 'n1', 'n4').id).toBeNull()
    expect(addEdge(usecase(), 'association', 'n1', 'n1').id).toBeNull()
    const state = initialModel('state', true) as GraphModel
    const initial = state.nodes.find((node) => node.type === 'initial')!
    const someState = state.nodes.find((node) => node.type === 'state')!
    expect(addEdge(state, 'flow', someState.id, initial.id).id).toBeNull()
  })

  it('clases y estados admiten relaciones consigo mismos', () => {
    expect(addEdge(classes(), 'association', 'n1', 'n1').id).toBe('e4')
    const state = initialModel('state', true) as GraphModel
    const someState = state.nodes.find((node) => node.type === 'state')!
    expect(addEdge(state, 'flow', someState.id, someState.id).id).not.toBeNull()
  })

  it('eliminar un elemento quita sus relaciones pero conserva lo que contenía', () => {
    const model = deleteNode(deleteNode(usecase(), 'n5'), 'n3')
    expect(model.edges.map((edge) => edge.id)).toEqual(['e1', 'e4'])
    expect(model.nodes.some((node) => node.id === 'n4')).toBe(true)
  })

  it('invertir intercambia extremos, multiplicidades y el orden de los codos', () => {
    let model = addBend(classes(), 'e1', { x: 300, y: 20 }).model
    model = addBend(model, 'e1', { x: 350, y: 20 }).model
    const reversed = reverseEdge(model, 'e1').edges[0]
    expect(reversed).toMatchObject({ source: 'n2', target: 'n1', sourceLabel: '*', targetLabel: '1' })
    expect(reversed.points).toEqual([...model.edges[0].points!].reverse())
  })

  it('codos: se insertan en el tramo más cercano, se mueven a la grilla y se quitan', () => {
    let model = classes()
    const first = addBend(model, 'e2', { x: 600, y: 180 })
    model = first.model
    const second = addBend(model, 'e2', { x: 600, y: 230 })
    expect(second.index).toBe(1)
    model = moveBend(second.model, 'e2', 0, { x: 613, y: 177 })
    expect(model.edges[1].points![0]).toEqual({ x: 610, y: 180 })
    model = removeBend(removeBend(model, 'e2', 0), 'e2', 0)
    expect(model.edges[1].points).toBeUndefined()
  })
})

describe('operaciones de secuencia', () => {
  it('inserta y reordena participantes', () => {
    const { model, id } = addParticipant(sequence(), 'entity', 1)
    expect(model.participants.map((participant) => participant.id)).toEqual(['p1', id, 'p2', 'p3', 'p4'])
    expect(moveParticipant(model, 'p1', 4).participants.map((participant) => participant.id)).toEqual([id, 'p2', 'p3', 'p4', 'p1'])
  })

  it('inserta mensajes y filas libres en su posición, los reordena y los borra con su participante', () => {
    const { model, id } = addMessage(sequence(), 'p1', 'p1', 'async', 0)
    expect(model.messages[0]).toMatchObject({ id, from: 'p1', to: 'p1', type: 'async' })
    expect(moveMessage(model, id, 6).messages.at(-1)!.id).toBe(id)
    expect(deleteParticipant(model, 'p4').messages.map((message) => message.id)).toEqual([id, 'm1', 'm2', 'm5', 'm6'])
    const withRow = addRawRow(model, 'loop reintentos', 1)
    expect(withRow.model.messages[1]).toMatchObject({ raw: 'loop reintentos' })
  })
})

describe('ubicación y relaciones paralelas', () => {
  it('al agregar con clic busca un hueco libre cerca del punto pedido', () => {
    const base = classes()
    const target = nodeRect('class', base.nodes.find((node) => node.id === 'n3')!)
    const { model, id } = addNode(base, 'class', { x: target.x + 40, y: target.y + 30 }, true)
    const added = nodeRect('class', model.nodes.find((node) => node.id === id)!)
    const collides = base.nodes.map((node) => nodeRect('class', node)).some((rect) =>
      added.x < rect.x + rect.width && rect.x < added.x + added.width && added.y < rect.y + rect.height && rect.y < added.y + added.height)
    expect(collides).toBe(false)
  })

  it('separa las relaciones rectas entre el mismo par y deja las únicas o con codos centradas', () => {
    const offsets = parallelOffsets([
      { id: 'a', type: 'association', source: 'n1', target: 'n2' },
      { id: 'b', type: 'generalization', source: 'n2', target: 'n1' },
      { id: 'c', type: 'association', source: 'n1', target: 'n3' },
      { id: 'd', type: 'association', source: 'n1', target: 'n3', points: [{ x: 1, y: 1 }] },
    ])
    expect([offsets.get('a'), offsets.get('b'), offsets.get('c'), offsets.get('d')]).toEqual([-7, 7, 0, undefined])
  })
})

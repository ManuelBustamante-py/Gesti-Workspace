import { describe, expect, it } from 'vitest'

import { addChild, addSiblingAfter, flatten, indent, moveAmongSiblings, outdent, removeNode, setSide, updateText } from './mindmapOps'
import type { MindNode } from './structured'

const tree = (): MindNode => ({
  id: 'n1', text: 'Centro', children: [
    { id: 'n2', text: 'A', side: 'right', children: [{ id: 'n4', text: 'A1', children: [] }] },
    { id: 'n3', text: 'B', side: 'left', children: [] },
  ],
})
const outline = (root: MindNode) => flatten(root).map(({ node, depth }) => `${'-'.repeat(depth)}${node.text}`)

describe('operaciones del mapa mental', () => {
  it('agrega hijas y hermanas con ids nuevos; las ramas principales se reparten por lado', () => {
    const child = addChild(tree(), 'n1')
    expect(child.id).toBe('n5')
    // Empate (1 y 1): a la derecha. Con más ramas a la derecha, la siguiente va a la izquierda.
    expect(child.root.children[2].side).toBe('right')
    expect(addChild(child.root, 'n1').root.children[3].side).toBe('left')
    const sibling = addSiblingAfter(tree(), 'n2', 'A bis')
    expect(outline(sibling.root)).toEqual(['Centro', '-A', '--A1', '-A bis', '-B'])
    expect(sibling.root.children[1].side).toBe('right')
  })

  it('indenta y desindenta conservando el orden', () => {
    const indented = indent(tree(), 'n3')
    expect(outline(indented)).toEqual(['Centro', '-A', '--A1', '--B'])
    expect(indented.children[0].children[1].side).toBeUndefined()
    const back = outdent(indented, 'n3')
    expect(outline(back)).toEqual(['Centro', '-A', '--A1', '-B'])
    expect(back.children[1].side).toBe('right')
    expect(indent(tree(), 'n2')).toEqual(tree())
  })

  it('mueve entre hermanas, cambia de lado, edita y borra sin tocar la raíz', () => {
    expect(outline(moveAmongSiblings(tree(), 'n3', -1))).toEqual(['Centro', '-B', '-A', '--A1'])
    expect(setSide(tree(), 'n2', 'left').children[0].side).toBe('left')
    expect(updateText(tree(), 'n4', 'A uno').children[0].children[0].text).toBe('A uno')
    expect(outline(removeNode(tree(), 'n2'))).toEqual(['Centro', '-B'])
    expect(removeNode(tree(), 'n1')).toEqual(tree())
  })

  it('no muta el árbol original (deshacer funciona)', () => {
    const original = tree()
    addChild(original, 'n2')
    indent(original, 'n3')
    expect(original).toEqual(tree())
  })
})

import { nextId } from './ids'
import type { MindNode } from './structured'

/** Copia profunda del árbol (los cambios nunca mutan el estado anterior: deshacer funciona). */
const clone = (root: MindNode): MindNode => JSON.parse(JSON.stringify(root)) as MindNode

export function allIds(root: MindNode): string[] {
  return [root.id, ...root.children.flatMap(allIds)]
}

/** Nodo y su padre (null si es la raíz). */
function locate(root: MindNode, id: string): { node: MindNode; parent: MindNode | null } | null {
  if (root.id === id) return { node: root, parent: null }
  for (const child of root.children) {
    if (child.id === id) return { node: child, parent: root }
    const found = locate(child, id)
    if (found) return found
  }
  return null
}

/** Lista plana en orden de lectura, con su profundidad (0 = tema central). */
export function flatten(root: MindNode, depth = 0): Array<{ node: MindNode; depth: number }> {
  return [{ node: root, depth }, ...root.children.flatMap((child) => flatten(child, depth + 1))]
}

export function updateText(root: MindNode, id: string, text: string): MindNode {
  const next = clone(root)
  const found = locate(next, id)
  if (found) found.node.text = text
  return next
}

export function setSide(root: MindNode, id: string, side: 'left' | 'right'): MindNode {
  const next = clone(root)
  const found = locate(next, id)
  if (found && found.parent?.id === next.id) found.node.side = side
  return next
}

export function addChild(root: MindNode, parentId: string, text = 'Nueva idea'): { root: MindNode; id: string } {
  const next = clone(root)
  const id = nextId('n', allIds(next))
  const found = locate(next, parentId)
  if (!found) return { root, id: '' }
  const node: MindNode = { id, text, children: [] }
  // Las ramas principales nuevas van al lado con menos ramas.
  if (found.node.id === next.id) node.side = next.children.filter((child) => child.side === 'left').length < next.children.filter((child) => child.side !== 'left').length ? 'left' : 'right'
  found.node.children.push(node)
  return { root: next, id }
}

export function addSiblingAfter(root: MindNode, id: string, text = 'Nueva idea'): { root: MindNode; id: string } {
  const found = locate(root, id)
  if (!found?.parent) return addChild(root, root.id, text)
  const next = clone(root)
  const newId = nextId('n', allIds(next))
  const parent = locate(next, found.parent.id)!.node
  const index = parent.children.findIndex((child) => child.id === id)
  parent.children.splice(index + 1, 0, { id: newId, text, children: [], ...(parent.id === next.id ? { side: found.node.side } : {}) })
  return { root: next, id: newId }
}

export function removeNode(root: MindNode, id: string): MindNode {
  if (root.id === id) return root
  const next = clone(root)
  const found = locate(next, id)
  if (found?.parent) found.parent.children = found.parent.children.filter((child) => child.id !== id)
  return next
}

/** Convierte la idea en hija de su hermana anterior. */
export function indent(root: MindNode, id: string): MindNode {
  const next = clone(root)
  const found = locate(next, id)
  if (!found?.parent) return root
  const index = found.parent.children.findIndex((child) => child.id === id)
  if (index <= 0) return root
  const [node] = found.parent.children.splice(index, 1)
  delete node.side
  found.parent.children[index - 1].children.push(node)
  return next
}

/** Sube la idea un nivel: queda después de la que era su madre. */
export function outdent(root: MindNode, id: string): MindNode {
  const next = clone(root)
  const found = locate(next, id)
  if (!found?.parent) return root
  const grand = locate(next, found.parent.id)?.parent
  if (!grand) return root
  found.parent.children = found.parent.children.filter((child) => child.id !== id)
  const parentIndex = grand.children.findIndex((child) => child.id === found.parent!.id)
  if (grand.id === next.id) found.node.side = found.parent.side
  grand.children.splice(parentIndex + 1, 0, found.node)
  return next
}

export function moveAmongSiblings(root: MindNode, id: string, direction: -1 | 1): MindNode {
  const next = clone(root)
  const found = locate(next, id)
  if (!found?.parent) return root
  const siblings = found.parent.children
  const index = siblings.findIndex((child) => child.id === id)
  const target = index + direction
  if (target < 0 || target >= siblings.length) return root
  ;[siblings[index], siblings[target]] = [siblings[target], siblings[index]]
  return next
}

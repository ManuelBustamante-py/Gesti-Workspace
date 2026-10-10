import { useEffect, useRef, type KeyboardEvent } from 'react'

import { inputClass, type FormProps } from './forms'
import { addChild, addSiblingAfter, flatten, indent, moveAmongSiblings, outdent, removeNode, setSide, updateText } from '../../../domain/uml/mindmapOps'
import type { MindmapModel } from '../../../domain/uml/structured'

/**
 * Mapa mental como esquema: Enter crea una idea al mismo nivel, Tab y
 * Mayús+Tab cambian el nivel y Retroceso en una idea vacía la borra.
 */
function MindmapForm(props: FormProps<MindmapModel>) {
  const { model, readOnly, onChange, onCheckpoint } = props
  // Idea que debe recibir el foco tras el próximo dibujo (se usa una sola vez).
  const pendingFocus = useRef<string | null>(null)
  const setFocusId = (id: string | null) => {
    pendingFocus.current = id
  }
  const listRef = useRef<HTMLDivElement>(null)
  const rows = flatten(model.root)
  const set = (root: MindmapModel['root'], record = true) => onChange({ ...model, root }, record)

  // Lleva el foco a la idea recién creada (o a la anterior al borrar).
  useEffect(() => {
    const id = pendingFocus.current
    if (!id) return
    pendingFocus.current = null
    listRef.current?.querySelector<HTMLInputElement>(`[data-node="${id}"]`)?.focus()
  })

  function handleKey(event: KeyboardEvent<HTMLInputElement>, id: string, index: number) {
    if (readOnly) return
    if (event.key === 'Enter') {
      event.preventDefault()
      const result = id === model.root.id ? addChild(model.root, id) : addSiblingAfter(model.root, id)
      set(result.root)
      setFocusId(result.id)
    } else if (event.key === 'Tab') {
      event.preventDefault()
      set(event.shiftKey ? outdent(model.root, id) : indent(model.root, id))
      setFocusId(id)
    } else if (event.key === 'Backspace' && !event.currentTarget.value && id !== model.root.id) {
      event.preventDefault()
      set(removeNode(model.root, id))
      setFocusId(rows[index - 1]?.node.id ?? null)
    }
  }

  return (
    <div className="struct-form">
      <label className="uml-field">
        <span>Título (opcional)</span>
        <input type="text" value={model.title ?? ''} readOnly={readOnly} onFocus={onCheckpoint} onChange={(event) => onChange({ ...model, title: event.target.value }, false)} className={inputClass} />
      </label>
      <p className="uml-props-hint">Enter: nueva idea · Tab / Mayús+Tab: cambiar nivel · Retroceso en una idea vacía: borrarla.</p>
      <div ref={listRef} className="mind-outline">
        {rows.map(({ node, depth }, index) => (
          <div key={node.id} className="mind-row" style={{ paddingLeft: depth * 20 }}>
            <span className="mind-bullet" aria-hidden="true">{depth === 0 ? '◉' : depth === 1 ? '●' : '○'}</span>
            <input
              data-node={node.id}
              type="text"
              value={node.text}
              readOnly={readOnly}
              onFocus={onCheckpoint}
              onChange={(event) => set(updateText(model.root, node.id, event.target.value), false)}
              onKeyDown={(event) => handleKey(event, node.id, index)}
              aria-label={depth === 0 ? 'Tema central' : `Idea de nivel ${depth}`}
              className={`${inputClass} ${depth === 0 ? 'font-semibold' : ''}`}
            />
            {!readOnly && (
              <span className="mind-actions">
                {depth === 1 && (
                  <button type="button" className="flow-zoom-button" title={node.side === 'left' ? 'Pasar a la derecha' : 'Pasar a la izquierda'} onClick={() => set(setSide(model.root, node.id, node.side === 'left' ? 'right' : 'left'))}>
                    {node.side === 'left' ? '◀' : '▶'}
                  </button>
                )}
                <button type="button" className="flow-zoom-button" title="Agregar idea hija" onClick={() => {
                  const result = addChild(model.root, node.id)
                  set(result.root)
                  setFocusId(result.id)
                }}>＋</button>
                {depth > 0 && (
                  <>
                    <button type="button" className="flow-zoom-button" title="Subir" onClick={() => set(moveAmongSiblings(model.root, node.id, -1))}>↑</button>
                    <button type="button" className="flow-zoom-button" title="Bajar" onClick={() => set(moveAmongSiblings(model.root, node.id, 1))}>↓</button>
                    <button type="button" className="flow-zoom-button" title="Eliminar (con sus sub-ideas)" onClick={() => set(removeNode(model.root, node.id))}>✕</button>
                  </>
                )}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default MindmapForm

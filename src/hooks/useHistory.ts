import { useCallback, useState } from 'react'

const LIMIT = 100

type History<T> = { past: T[]; present: T; future: T[] }

/**
 * Estado con deshacer/rehacer. `set(next, false)` cambia sin crear un paso
 * (arrastrar, escribir); `checkpoint()` guarda el estado actual como paso antes
 * de empezar uno de esos cambios continuos.
 */
export function useHistory<T>(initial: T) {
  const [history, setHistory] = useState<History<T>>({ past: [], present: initial, future: [] })

  const set = useCallback((next: T | ((current: T) => T), record = true) => {
    setHistory((current) => {
      const value = typeof next === 'function' ? (next as (current: T) => T)(current.present) : next
      if (Object.is(value, current.present)) return current
      return record
        ? { past: [...current.past, current.present].slice(-LIMIT), present: value, future: [] }
        : { ...current, present: value }
    })
  }, [])

  const checkpoint = useCallback(() => {
    setHistory((current) => ({ past: [...current.past, current.present].slice(-LIMIT), present: current.present, future: [] }))
  }, [])

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current.past[current.past.length - 1]
      if (previous === undefined) return current
      return { past: current.past.slice(0, -1), present: previous, future: [current.present, ...current.future] }
    })
  }, [])

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = current.future[0]
      if (next === undefined) return current
      return { past: [...current.past, current.present], present: next, future: current.future.slice(1) }
    })
  }, [])

  const reset = useCallback((value: T) => setHistory({ past: [], present: value, future: [] }), [])

  return {
    state: history.present,
    set,
    checkpoint,
    undo,
    redo,
    reset,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  }
}

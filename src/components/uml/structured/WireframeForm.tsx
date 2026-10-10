import { inputClass, textField, type FormProps } from './forms'
import { nextId } from '../../../domain/uml/ids'
import { WIDGET_LABELS, type Widget, type WidgetType, type WireRow, type WireframeModel } from '../../../domain/uml/structured'

const ADDABLE: WidgetType[] = ['title', 'text', 'input', 'password', 'button', 'checkbox', 'radio', 'select', 'link', 'image']
const DEFAULT_LABELS: Partial<Record<WidgetType, string>> = {
  title: 'Título', text: 'Etiqueta', input: 'texto de ejemplo', button: 'Aceptar', checkbox: 'Opción', radio: 'Opción', select: 'Elegir', link: 'Enlace', image: 'Imagen',
}

/** Wireframe: filas de controles. La vista previa a la derecha es el diseño final. */
function WireframeForm(props: FormProps<WireframeModel>) {
  const { model, readOnly, onChange, selectedId, onSelect } = props
  const ids = () => model.rows.flatMap((row) => [row.id, ...row.cells.map((cell) => cell.id)])
  const newWidget = (type: WidgetType, extra: string[] = []): Widget => ({ id: nextId('n', [...ids(), ...extra]), type, label: DEFAULT_LABELS[type] ?? '' })
  const setRows = (rows: WireRow[], record = true) => onChange({ ...model, rows }, record)
  const updateCell = (rowId: string, cellId: string, patch: Partial<Widget>, record = true) =>
    setRows(model.rows.map((row) => (row.id === rowId ? { ...row, cells: row.cells.map((cell) => (cell.id === cellId ? { ...cell, ...patch } : cell)) } : row)), record)
  const moveRow = (index: number, direction: -1 | 1) => {
    const rows = [...model.rows]
    const target = index + direction
    if (target < 0 || target >= rows.length) return
    ;[rows[index], rows[target]] = [rows[target], rows[index]]
    setRows(rows)
  }
  const addRow = (type: WidgetType | 'separator') => {
    const rowId = nextId('m', ids())
    const cell = type === 'separator' ? { id: nextId('n', [...ids(), rowId]), type: 'separator' as const, label: '' } : newWidget(type, [rowId])
    setRows([...model.rows, { id: rowId, cells: [cell] }])
    onSelect?.(cell.id)
  }

  return (
    <div className="struct-form">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="uml-field">
          <span>Título de la pantalla</span>
          <input type="text" {...textField(props, model.title ?? '', (value) => ({ ...model, title: value }))} className={inputClass} />
        </label>
        <label className="uml-field">
          <span>Marco</span>
          <select value={model.frame} disabled={readOnly} onChange={(event) => onChange({ ...model, frame: event.target.value as WireframeModel['frame'] }, true)} className={inputClass}>
            <option value="window">Ventana</option>
            <option value="plain">Simple</option>
          </select>
        </label>
      </div>

      {model.rows.map((row, rowIndex) => (
        <div key={row.id} className="wire-row">
          <div className="wire-row-head">
            <span className="text-xs text-[var(--text-muted)]">Fila {rowIndex + 1}</span>
            {!readOnly && (
              <span className="flex gap-1">
                <button type="button" className="flow-zoom-button" onClick={() => moveRow(rowIndex, -1)} disabled={rowIndex === 0} title="Subir fila">↑</button>
                <button type="button" className="flow-zoom-button" onClick={() => moveRow(rowIndex, 1)} disabled={rowIndex === model.rows.length - 1} title="Bajar fila">↓</button>
                <button type="button" className="flow-zoom-button" onClick={() => setRows(model.rows.filter((item) => item.id !== row.id))} title="Eliminar fila">✕</button>
              </span>
            )}
          </div>
          {row.cells.map((cell, cellIndex) => (
            <div key={cell.id} className={`wire-cell ${selectedId === cell.id ? 'wire-cell-active' : ''}`} onFocus={() => onSelect?.(cell.id)}>
              <select value={cell.type} disabled={readOnly} onChange={(event) => updateCell(row.id, cell.id, { type: event.target.value as WidgetType })} className={`${inputClass} w-36`} aria-label="Tipo de control">
                {[...ADDABLE, 'separator' as const].map((type) => <option key={type} value={type}>{WIDGET_LABELS[type]}</option>)}
              </select>
              {cell.type !== 'separator' && cell.type !== 'password' && (
                <input type="text" {...textField(props, cell.label, (value) => ({ ...model, rows: model.rows.map((item) => (item.id === row.id ? { ...item, cells: item.cells.map((other) => (other.id === cell.id ? { ...other, label: value } : other)) } : item)) }))} className={inputClass} aria-label="Texto" />
              )}
              {(cell.type === 'checkbox' || cell.type === 'radio') && (
                <label className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                  <input type="checkbox" checked={Boolean(cell.checked)} disabled={readOnly} onChange={(event) => updateCell(row.id, cell.id, { checked: event.target.checked })} /> marcada
                </label>
              )}
              {!readOnly && (
                <span className="flex gap-1">
                  <button type="button" className="flow-zoom-button" disabled={cellIndex === 0} title="Mover a la izquierda" onClick={() => setRows(model.rows.map((item) => {
                    if (item.id !== row.id) return item
                    const cells = [...item.cells]
                    ;[cells[cellIndex - 1], cells[cellIndex]] = [cells[cellIndex], cells[cellIndex - 1]]
                    return { ...item, cells }
                  }))}>←</button>
                  <button type="button" className="flow-zoom-button" title="Quitar control" onClick={() => setRows(
                    row.cells.length === 1 ? model.rows.filter((item) => item.id !== row.id) : model.rows.map((item) => (item.id === row.id ? { ...item, cells: item.cells.filter((other) => other.id !== cell.id) } : item)),
                  )}>✕</button>
                </span>
              )}
            </div>
          ))}
          {!readOnly && !(row.cells.length === 1 && row.cells[0].type === 'separator') && (
            <select
              value=""
              onChange={(event) => {
                const type = event.target.value as WidgetType
                if (!type) return
                const cell = newWidget(type)
                setRows(model.rows.map((item) => (item.id === row.id ? { ...item, cells: [...item.cells, cell] } : item)))
                onSelect?.(cell.id)
              }}
              className={`${inputClass} mt-1 w-auto`}
              aria-label="Agregar control a la fila"
            >
              <option value="">＋ Agregar a esta fila…</option>
              {ADDABLE.map((type) => <option key={type} value={type}>{WIDGET_LABELS[type]}</option>)}
            </select>
          )}
        </div>
      ))}
      {!readOnly && (
        <div className="mt-2 flex flex-wrap gap-2">
          <select value="" onChange={(event) => event.target.value && addRow(event.target.value as WidgetType)} className={`${inputClass} w-auto`} aria-label="Agregar fila">
            <option value="">＋ Nueva fila con…</option>
            {ADDABLE.map((type) => <option key={type} value={type}>{WIDGET_LABELS[type]}</option>)}
          </select>
          <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => addRow('separator')}>— Separador</button>
        </div>
      )}
    </div>
  )
}

export default WireframeForm

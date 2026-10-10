import type { Ref } from 'react'

import { textWidth } from '../../../domain/uml/geometry'
import type { Widget, WireframeModel } from '../../../domain/uml/structured'

/**
 * Renderizador propio de wireframes (PlantUML para navegador no incluye Salt).
 * Dibuja en SVG con atributos en línea: lo mismo se ve en la app y al exportar.
 */
const INK = '#2f3b40'
const SOFT = '#8a979b'
const PAPER = '#ffffff'
const FILL = '#f5f7f8'
const ACCENT = '#2563eb'
const FONT = 'Inter, ui-sans-serif, system-ui, sans-serif'
const ROW = 40
const PAD = 18
const GAP = 14

/** Ancho natural de un control (para repartir las columnas). */
function widgetWidth(widget: Widget) {
  const label = widget.label || ' '
  switch (widget.type) {
    case 'title': return textWidth(label, 17, true) + 4
    case 'input':
    case 'password': return Math.max(170, textWidth(label, 13) + 28)
    case 'button': return textWidth(label || 'Botón', 13, true) + 36
    case 'checkbox':
    case 'radio': return textWidth(label, 13) + 30
    case 'select': return Math.max(150, textWidth(label, 13) + 44)
    case 'image': return 120
    case 'separator': return 40
    default: return textWidth(label, 13) + 4
  }
}

function WidgetShape({ widget, x, y, width, selected }: { widget: Widget; x: number; y: number; width: number; selected: boolean }) {
  const mid = y + ROW / 2
  const text = (value: string, tx: number, options: { size?: number; weight?: number; fill?: string; anchor?: 'start' | 'middle'; decoration?: string } = {}) => (
    <text x={tx} y={mid + (options.size ?? 13) / 2.8} fontSize={options.size ?? 13} fontFamily={FONT} fontWeight={options.weight} fill={options.fill ?? INK} textAnchor={options.anchor ?? 'start'} textDecoration={options.decoration}>
      {value}
    </text>
  )
  const outline = selected ? <rect data-ui="1" x={x - 4} y={y + 2} width={width + 8} height={ROW - 4} rx={6} fill="none" stroke="#1f9d8b" strokeWidth={2} strokeDasharray="4 3" /> : null
  let body = null
  switch (widget.type) {
    case 'title':
      body = text(widget.label, x, { size: 17, weight: 700 })
      break
    case 'text':
      body = text(widget.label, x)
      break
    case 'input':
    case 'password':
      body = (
        <g>
          <rect x={x} y={mid - 14} width={width} height={28} rx={5} fill={PAPER} stroke={INK} strokeWidth={1.4} />
          {widget.type === 'password'
            ? Array.from({ length: 8 }, (_, index) => <circle key={index} cx={x + 14 + index * 11} cy={mid} r={3} fill={SOFT} />)
            : text(widget.label || ' ', x + 10, { fill: SOFT })}
        </g>
      )
      break
    case 'button':
      body = (
        <g>
          <rect x={x} y={mid - 15} width={width} height={30} rx={7} fill={INK} />
          {text(widget.label || 'Botón', x + width / 2, { fill: PAPER, weight: 600, anchor: 'middle' })}
        </g>
      )
      break
    case 'checkbox':
      body = (
        <g>
          <rect x={x} y={mid - 8} width={16} height={16} rx={3} fill={PAPER} stroke={INK} strokeWidth={1.4} />
          {widget.checked && <path d={`M ${x + 3.5} ${mid} L ${x + 7} ${mid + 4} L ${x + 13} ${mid - 4}`} fill="none" stroke={INK} strokeWidth={2} />}
          {text(widget.label, x + 24)}
        </g>
      )
      break
    case 'radio':
      body = (
        <g>
          <circle cx={x + 8} cy={mid} r={8} fill={PAPER} stroke={INK} strokeWidth={1.4} />
          {widget.checked && <circle cx={x + 8} cy={mid} r={4} fill={INK} />}
          {text(widget.label, x + 24)}
        </g>
      )
      break
    case 'select':
      body = (
        <g>
          <rect x={x} y={mid - 14} width={width} height={28} rx={5} fill={FILL} stroke={INK} strokeWidth={1.4} />
          {text(widget.label || 'Elegir', x + 10)}
          <path d={`M ${x + width - 20} ${mid - 3} L ${x + width - 14} ${mid + 3} L ${x + width - 8} ${mid - 3}`} fill="none" stroke={INK} strokeWidth={1.6} />
        </g>
      )
      break
    case 'link':
      body = text(widget.label || 'Enlace', x, { fill: ACCENT, decoration: 'underline' })
      break
    case 'image':
      body = (
        <g>
          <rect x={x} y={y + 3} width={width} height={ROW - 6} rx={3} fill={FILL} stroke={SOFT} strokeWidth={1.2} />
          <path d={`M ${x} ${y + 3} L ${x + width} ${y + ROW - 3} M ${x + width} ${y + 3} L ${x} ${y + ROW - 3}`} stroke={SOFT} strokeWidth={1} />
          {widget.label && text(widget.label, x + width / 2, { size: 11, anchor: 'middle', fill: INK })}
        </g>
      )
      break
    case 'separator':
      body = <line x1={x} y1={mid} x2={x + width} y2={mid} stroke={SOFT} strokeWidth={1.2} />
      break
  }
  return (
    <g data-widget-id={widget.id} className="wire-widget">
      {/* Zona de clic de toda la celda. */}
      <rect data-ui="1" x={x - 4} y={y} width={width + 8} height={ROW} fill="transparent" />
      {body}
      {outline}
    </g>
  )
}

interface WireframeViewProps {
  model: WireframeModel
  selectedId?: string | null
  onSelect?: (widgetId: string) => void
  svgRef?: Ref<SVGSVGElement>
}

/** Vista del wireframe: filas de controles alineados en columnas. */
function WireframeView({ model, selectedId, onSelect, svgRef }: WireframeViewProps) {
  // Columnas: el ancho de cada una es el del control más ancho que cae en ella.
  const columns = Math.max(1, ...model.rows.map((row) => row.cells.length))
  const widths = Array.from({ length: columns }, (_, column) =>
    Math.max(40, ...model.rows.filter((row) => row.cells.length > 1 || row.cells[0]?.type !== 'separator').map((row) => (row.cells[column] ? widgetWidth(row.cells[column]) : 0))))
  const contentWidth = widths.reduce((sum, value) => sum + value, 0) + GAP * (columns - 1)
  const window = model.frame === 'window'
  const top = window ? 34 : 0
  const width = Math.max(320, contentWidth + PAD * 2)
  const height = top + PAD * 2 + Math.max(1, model.rows.length) * ROW
  const x0 = PAD
  const columnX = (column: number) => x0 + widths.slice(0, column).reduce((sum, value) => sum + value + GAP, 0)

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      fontFamily={FONT}
      className="wire-view"
      onClick={(event) => {
        const id = (event.target as Element).closest('[data-widget-id]')?.getAttribute('data-widget-id')
        if (id) onSelect?.(id)
      }}
    >
      <rect x={0.75} y={0.75} width={width - 1.5} height={height - 1.5} rx={10} fill={PAPER} stroke={INK} strokeWidth={1.5} />
      {window && (
        <g>
          <path d={`M 0.75 34 H ${width - 0.75}`} stroke={INK} strokeWidth={1.2} />
          {[0, 1, 2].map((index) => <circle key={index} cx={18 + index * 16} cy={17} r={5} fill={index === 0 ? '#f87171' : index === 1 ? '#fbbf24' : '#34d399'} />)}
          {model.title?.trim() && <text x={width / 2} y={22} fontSize={12} fontFamily={FONT} fill={SOFT} textAnchor="middle">{model.title}</text>}
        </g>
      )}
      {model.rows.length === 0 && (
        <text x={width / 2} y={top + PAD + ROW / 2 + 4} fontSize={12} fontFamily={FONT} fill={SOFT} textAnchor="middle">Agrega filas y controles para diseñar la pantalla</text>
      )}
      {model.rows.map((row, rowIndex) => {
        const y = top + PAD + rowIndex * ROW
        if (row.cells.length === 1 && row.cells[0].type === 'separator') {
          return <WidgetShape key={row.id} widget={row.cells[0]} x={x0} y={y} width={contentWidth} selected={selectedId === row.cells[0].id} />
        }
        return row.cells.map((cell, column) => {
          // El último control de la fila ocupa las columnas que sobran.
          const last = column === row.cells.length - 1
          const cellWidth = last ? contentWidth - (columnX(column) - x0) : widths[column]
          const natural = ['input', 'password', 'select', 'image', 'separator'].includes(cell.type) ? cellWidth : Math.min(cellWidth, widgetWidth(cell))
          return <WidgetShape key={cell.id} widget={cell} x={columnX(column)} y={y} width={natural} selected={selectedId === cell.id} />
        })
      })}
    </svg>
  )
}

export default WireframeView

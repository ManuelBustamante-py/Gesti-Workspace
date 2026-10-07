import type { ComponentProps } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import TaskCard from './TaskCard'

type SortableTaskCardProps = Omit<ComponentProps<typeof TaskCard>, 'dragHandle'> & {
  dragEnabled: boolean
}

/**
 * Tarjeta que se puede arrastrar entre columnas y posiciones. Solo el asa (⠿)
 * inicia el arrastre: los botones de la tarjeta siguen funcionando y en móvil
 * se puede desplazar la pantalla sin mover tarjetas por accidente.
 */
function SortableTaskCard({ dragEnabled, ...props }: SortableTaskCardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
    disabled: !dragEnabled,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? 'task-drag-placeholder' : undefined}
    >
      <TaskCard
        {...props}
        dragHandle={
          dragEnabled ? (
            <button
              ref={setActivatorNodeRef}
              type="button"
              className="drag-handle"
              title="Arrastrar para mover"
              {...attributes}
              {...listeners}
              aria-label={`Arrastrar la tarea ${props.number ?? ''}. Usa espacio para tomarla y las flechas para moverla.`}
            >
              ⠿
            </button>
          ) : null
        }
      />
    </div>
  )
}

export default SortableTaskCard

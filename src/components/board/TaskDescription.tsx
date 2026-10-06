import { useMemo } from 'react'

import { parseDescription } from '../../domain/description'

interface TaskDescriptionProps {
  text: string
}

/** Muestra una descripción con secciones, pasos y viñetas (ver domain/description.ts). */
function TaskDescription({ text }: TaskDescriptionProps) {
  const sections = useMemo(() => parseDescription(text), [text])

  if (sections.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">Sin descripción.</p>
  }

  return (
    <div className="task-description">
      {sections.map((section, sectionIndex) => (
        <section key={`${section.title ?? 'intro'}-${sectionIndex}`} className="task-description-section">
          {section.title && <h4 className="task-description-title">{section.title}</h4>}
          {section.blocks.length > 0 && (
            <div className="space-y-1.5">
              {section.blocks.map((block, blockIndex) => {
                const key = `${sectionIndex}-${blockIndex}`
                if (block.type === 'bullet') {
                  return (
                    <p key={key} className="task-description-item">
                      <span aria-hidden="true" className="task-description-marker">•</span>
                      <span>{block.text}</span>
                    </p>
                  )
                }
                if (block.type === 'numbered') {
                  // «Etiqueta: detalle» → etiqueta en negrita, como en las plantillas de historias.
                  const labelled = /^([^:]{3,60}):\s+(.+)$/.exec(block.text)
                  return (
                    <p key={key} className="task-description-item">
                      <span className="task-description-marker task-description-number">{block.number}</span>
                      <span>
                        {labelled ? (
                          <>
                            <strong className="font-semibold text-white">{labelled[1]}</strong>: {labelled[2]}
                          </>
                        ) : (
                          block.text
                        )}
                      </span>
                    </p>
                  )
                }
                return <p key={key}>{block.text}</p>
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

export default TaskDescription

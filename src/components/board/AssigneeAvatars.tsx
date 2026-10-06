import { initials, type BoardPerson } from '../../domain/people'

interface AssigneeAvatarsProps {
  people: BoardPerson[]
  max?: number
  size?: 'sm' | 'md'
}

/** Avatares superpuestos de los responsables; el nombre completo va en title y aria-label. */
function AssigneeAvatars({ people, max = 3, size = 'sm' }: AssigneeAvatarsProps) {
  if (people.length === 0) return null
  const visible = people.slice(0, max)
  const hidden = people.length - visible.length
  const names = people.map((person) => person.name).join(', ')

  return (
    <span className={`assignee-stack assignee-stack-${size}`} role="img" aria-label={`Responsables: ${names}`} title={names}>
      {visible.map((person) =>
        person.avatarUrl ? (
          <img key={person.userId} src={person.avatarUrl} alt="" className="assignee-avatar" />
        ) : (
          <span key={person.userId} className="assignee-avatar" aria-hidden="true">
            {initials(person.name)}
          </span>
        ),
      )}
      {hidden > 0 && (
        <span className="assignee-avatar assignee-avatar-more" aria-hidden="true">
          +{hidden}
        </span>
      )}
    </span>
  )
}

export default AssigneeAvatars

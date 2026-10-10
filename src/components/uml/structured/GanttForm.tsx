import { inputClass, textField, type FormProps } from './forms'
import { nextId } from '../../../domain/uml/ids'
import { ganttSchedule } from '../../../domain/uml/interpretStructured'
import { WEEKDAYS, type GanttModel, type GanttStart, type GanttTask } from '../../../domain/uml/structured'

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const shortDate = (key: string) => new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${key}T00:00:00Z`))

/** Gantt como tabla: duración, dependencia o fecha de inicio, avance, responsable e hitos. */
function GanttForm(props: FormProps<GanttModel>) {
  const { model, readOnly, onChange } = props
  const { dates } = ganttSchedule(model)
  const update = (id: string, patch: Partial<GanttTask>, record = true) =>
    onChange({ ...model, tasks: model.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)) }, record)
  const add = (milestone: boolean) => {
    const id = nextId('n', model.tasks.map((task) => task.id))
    const last = model.tasks[model.tasks.length - 1]
    const task: GanttTask = {
      id,
      name: milestone ? `Hito ${model.tasks.filter((item) => item.milestone).length + 1}` : `Tarea ${model.tasks.filter((item) => !item.milestone).length + 1}`,
      duration: milestone ? 0 : 3,
      start: last ? { type: 'after', task: last.id } : { type: 'project' },
      ...(milestone ? { milestone: true } : {}),
    }
    onChange({ ...model, tasks: [...model.tasks, task] }, true)
  }
  const move = (index: number, direction: -1 | 1) => {
    const tasks = [...model.tasks]
    const target = index + direction
    if (target < 0 || target >= tasks.length) return
    ;[tasks[index], tasks[target]] = [tasks[target], tasks[index]]
    onChange({ ...model, tasks }, true)
  }
  const remove = (id: string) =>
    onChange({
      ...model,
      // Lo que dependía de la tarea eliminada pasa a empezar donde empezaba ella.
      tasks: model.tasks.filter((task) => task.id !== id).map((task) => (task.start.type === 'after' && task.start.task === id ? { ...task, start: model.tasks.find((item) => item.id === id)!.start } : task)),
    }, true)

  const startValue = (start: GanttStart) => (start.type === 'after' ? `after:${start.task}` : start.type)
  const startFrom = (value: string, current: GanttStart): GanttStart =>
    value.startsWith('after:') ? { type: 'after', task: value.slice(6) } : value === 'date' ? { type: 'date', date: current.type === 'date' ? current.date : model.projectStart } : { type: 'project' }

  return (
    <div className="struct-form">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="uml-field">
          <span>Título (opcional)</span>
          <input type="text" {...textField(props, model.title ?? '', (value) => ({ ...model, title: value }))} className={inputClass} />
        </label>
        <label className="uml-field">
          <span>Inicio del proyecto</span>
          <input type="date" value={model.projectStart} readOnly={readOnly} onChange={(event) => event.target.value && onChange({ ...model, projectStart: event.target.value }, true)} className={inputClass} />
        </label>
      </div>
      <div className="uml-field">
        <span>Días no hábiles</span>
        <div className="flex flex-wrap gap-1">
          {DAY_ORDER.map((day) => {
            const closed = model.closed.includes(day)
            return (
              <button
                key={day}
                type="button"
                disabled={readOnly}
                aria-pressed={closed}
                onClick={() => onChange({ ...model, closed: closed ? model.closed.filter((item) => item !== day) : [...model.closed, day] }, true)}
                className={`uml-palette-item ${closed ? 'uml-palette-item-active' : ''}`}
              >
                {WEEKDAYS[day].slice(0, 3)}
              </button>
            )
          })}
        </div>
      </div>

      <div className="struct-table-wrap">
        <table className="struct-table">
          <thead>
            <tr><th>Tarea</th><th>Días</th><th>Comienza</th><th>Fechas</th><th>Avance</th><th>Responsable</th><th aria-label="Acciones" /></tr>
          </thead>
          <tbody>
            {model.tasks.map((task, index) => {
              const range = dates.get(task.id)
              return (
                <tr key={task.id} className={task.milestone ? 'struct-milestone' : undefined}>
                  <td>
                    <input type="text" {...textField(props, task.name, (value) => ({ ...model, tasks: model.tasks.map((item) => (item.id === task.id ? { ...item, name: value } : item)) }))} className={inputClass} aria-label="Nombre" />
                    {task.milestone && <span className="uml-badge uml-badge-adapted mt-1">◆ Hito</span>}
                  </td>
                  <td>
                    <input type="number" min={1} value={task.milestone ? 0 : task.duration} disabled={task.milestone || readOnly} onChange={(event) => update(task.id, { duration: Math.max(1, Number(event.target.value) || 1) })} className={`${inputClass} w-16`} aria-label="Duración en días hábiles" />
                  </td>
                  <td>
                    <select value={startValue(task.start)} disabled={readOnly} onChange={(event) => update(task.id, { start: startFrom(event.target.value, task.start) })} className={inputClass} aria-label="Cuándo comienza">
                      <option value="project">Al inicio del proyecto</option>
                      {model.tasks.filter((other) => other.id !== task.id).map((other) => (
                        <option key={other.id} value={`after:${other.id}`}>Después de «{other.name}»</option>
                      ))}
                      <option value="date">En una fecha</option>
                    </select>
                    {task.start.type === 'date' && (
                      <input type="date" value={task.start.date} readOnly={readOnly} onChange={(event) => event.target.value && update(task.id, { start: { type: 'date', date: event.target.value } })} className={`${inputClass} mt-1`} aria-label="Fecha de inicio" />
                    )}
                  </td>
                  <td className="whitespace-nowrap text-xs text-[var(--text-muted)]">
                    {range ? (task.milestone ? shortDate(range.start) : `${shortDate(range.start)} – ${shortDate(range.end)}`) : '—'}
                  </td>
                  <td>
                    {!task.milestone && (
                      <input type="number" min={0} max={100} step={5} value={task.progress ?? 0} readOnly={readOnly} onChange={(event) => update(task.id, { progress: Math.min(100, Math.max(0, Number(event.target.value) || 0)) })} className={`${inputClass} w-16`} aria-label="Avance (%)" />
                    )}
                  </td>
                  <td>
                    {!task.milestone && <input type="text" {...textField(props, task.resource ?? '', (value) => ({ ...model, tasks: model.tasks.map((item) => (item.id === task.id ? { ...item, resource: value } : item)) }))} className={inputClass} aria-label="Responsable" />}
                  </td>
                  <td className="whitespace-nowrap">
                    {!readOnly && (
                      <>
                        <button type="button" className="flow-zoom-button" onClick={() => move(index, -1)} disabled={index === 0} title="Subir">↑</button>
                        <button type="button" className="flow-zoom-button" onClick={() => move(index, 1)} disabled={index === model.tasks.length - 1} title="Bajar">↓</button>
                        <button type="button" className="flow-zoom-button" onClick={() => remove(task.id)} title="Eliminar">✕</button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => add(false)} className="btn-ghost px-3 py-1.5 text-sm">＋ Tarea</button>
          <button type="button" onClick={() => add(true)} className="btn-ghost px-3 py-1.5 text-sm">◆ Hito</button>
        </div>
      )}
    </div>
  )
}

export default GanttForm

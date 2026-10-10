import { useState } from 'react'

import { inputClass, textField, type FormProps } from './forms'
import { nextId } from '../../../domain/uml/ids'
import { TIMING_LABELS, type TimingModel, type TimingType } from '../../../domain/uml/structured'

/** Diagrama de tiempos: participantes y una grilla de instantes × estados. */
function TimingForm(props: FormProps<TimingModel>) {
  const { model, readOnly, onChange } = props
  const [newTime, setNewTime] = useState('')
  const lanes = model.participants.filter((participant) => participant.type !== 'clock')
  const times = [...new Set(model.events.map((event) => event.time))].sort((a, b) => a - b)
  const stateAt = (time: number, participant: string) => model.events.find((event) => event.time === time && event.participant === participant)

  const setState = (time: number, participant: string, state: string) => {
    const existing = stateAt(time, participant)
    if (existing) {
      onChange({ ...model, events: state ? model.events.map((event) => (event === existing ? { ...event, state } : event)) : model.events.filter((event) => event !== existing) }, false)
    } else if (state) {
      onChange({ ...model, events: [...model.events, { id: nextId('m', model.events.map((event) => event.id)), time, participant, state }] }, false)
    }
  }
  const addTime = () => {
    const time = Number(newTime)
    if (!Number.isFinite(time) || times.includes(time) || !lanes[0]) return
    // Un instante existe mientras algún participante cambie en él: se crea con el estado anterior del primero.
    const previous = [...model.events].filter((event) => event.participant === lanes[0].id && event.time < time).sort((a, b) => b.time - a.time)[0]
    onChange({ ...model, events: [...model.events, { id: nextId('m', model.events.map((event) => event.id)), time, participant: lanes[0].id, state: previous?.state ?? 'Estado' }] }, true)
    setNewTime('')
  }
  const retime = (from: number, to: number) => {
    if (!Number.isFinite(to) || times.includes(to)) return
    onChange({ ...model, events: model.events.map((event) => (event.time === from ? { ...event, time: to } : event)) }, true)
  }

  return (
    <div className="struct-form">
      <label className="uml-field">
        <span>Título (opcional)</span>
        <input type="text" {...textField(props, model.title ?? '', (value) => ({ ...model, title: value }))} className={inputClass} />
      </label>

      <p className="uml-palette-title">Participantes</p>
      {model.participants.map((participant) => (
        <div key={participant.id} className="struct-row">
          <input type="text" {...textField(props, participant.name, (value) => ({ ...model, participants: model.participants.map((item) => (item.id === participant.id ? { ...item, name: value } : item)) }))} className={inputClass} aria-label="Nombre" />
          <select value={participant.type} disabled={readOnly} onChange={(event) => onChange({ ...model, participants: model.participants.map((item) => (item.id === participant.id ? { ...item, type: event.target.value as TimingType } : item)) }, true)} className={inputClass} aria-label="Tipo">
            {(Object.keys(TIMING_LABELS) as TimingType[]).map((type) => <option key={type} value={type}>{TIMING_LABELS[type]}</option>)}
          </select>
          {participant.type === 'clock' && (
            <input type="number" min={1} value={participant.period ?? 50} readOnly={readOnly} onChange={(event) => onChange({ ...model, participants: model.participants.map((item) => (item.id === participant.id ? { ...item, period: Math.max(1, Number(event.target.value) || 1) } : item)) }, true)} className={`${inputClass} w-20`} aria-label="Período" />
          )}
          {!readOnly && (
            <button type="button" className="flow-zoom-button" title="Eliminar participante" onClick={() => onChange({
              ...model,
              participants: model.participants.filter((item) => item.id !== participant.id),
              events: model.events.filter((event) => event.participant !== participant.id),
            }, true)}>✕</button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button type="button" className="btn-ghost mb-3 px-3 py-1.5 text-sm" onClick={() => {
          const id = nextId('p', model.participants.map((participant) => participant.id))
          onChange({ ...model, participants: [...model.participants, { id, name: `Participante ${model.participants.length + 1}`, type: 'robust' }] }, true)
        }}>＋ Participante</button>
      )}

      <p className="uml-palette-title">Cambios de estado en el tiempo</p>
      <p className="uml-props-hint">Escribe el estado al que pasa cada participante en cada instante; deja vacío si no cambia. En los binarios usa «high» o «low».</p>
      <div className="struct-table-wrap">
        <table className="struct-table">
          <thead>
            <tr><th>Instante</th>{lanes.map((lane) => <th key={lane.id}>{lane.name}</th>)}<th aria-label="Acciones" /></tr>
          </thead>
          <tbody>
            {times.map((time) => (
              <tr key={time}>
                <td><input type="number" defaultValue={time} readOnly={readOnly} onBlur={(event) => Number(event.target.value) !== time && retime(time, Number(event.target.value))} className={`${inputClass} w-20`} aria-label="Instante" /></td>
                {lanes.map((lane) => (
                  <td key={lane.id}>
                    <input type="text" value={stateAt(time, lane.id)?.state ?? ''} readOnly={readOnly} onFocus={props.onCheckpoint} onChange={(event) => setState(time, lane.id, event.target.value)} className={inputClass} aria-label={`Estado de ${lane.name} en ${time}`} />
                  </td>
                ))}
                <td>{!readOnly && <button type="button" className="flow-zoom-button" title="Eliminar instante" onClick={() => onChange({ ...model, events: model.events.filter((event) => event.time !== time) }, true)}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && lanes.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <input type="number" value={newTime} onChange={(event) => setNewTime(event.target.value)} placeholder={`${(times[times.length - 1] ?? 0) + 100}`} className={`${inputClass} w-24`} aria-label="Nuevo instante" />
          <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={addTime}>＋ Instante</button>
        </div>
      )}
    </div>
  )
}

export default TimingForm

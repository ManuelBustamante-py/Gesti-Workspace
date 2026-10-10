import type { ReactNode } from 'react'

import type { Selection } from './GraphCanvas'
import { edgeSpec, kindSpec, nodeSpec } from '../../../domain/uml/kinds'
import { addRawRow, deleteEdge, deleteNode, deleteParticipant, moveMessage, moveParticipant, reverseEdge, updateEdge, updateNode } from '../../../domain/uml/modelOps'
import {
  MESSAGE_LABELS,
  PARTICIPANT_LABELS,
  type GraphModel,
  type MessageType,
  type ParticipantType,
  type SequenceModel,
  type CanvasModel as VisualModel,
} from '../../../domain/uml/visualModel'

interface PropertiesPanelProps {
  model: VisualModel
  selection: Selection
  readOnly: boolean
  onChange: (model: VisualModel, record: boolean) => void
  /** Guarda un paso de deshacer antes de una edición continua (escribir). */
  onCheckpoint: () => void
  onSelect: (selection: Selection) => void
}

const CARDINALITIES = [
  ['1', 'Exactamente uno (1)'],
  ['0..1', 'Cero o uno (0..1)'],
  ['1..*', 'Uno o muchos (1..*)'],
  ['0..*', 'Cero o muchos (0..*)'],
] as const

const RAW_SNIPPETS = ['alt condición', 'else otra condición', 'end', 'loop cada elemento', 'opt opcional', 'note over p1 : nota', '== Fase ==', '...', 'activate p1', 'deactivate p1']

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="uml-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

const selectClass = 'theme-input w-full rounded-md px-2 py-1.5 text-sm'

function PropertiesPanel({ model, selection, readOnly, onChange, onCheckpoint, onSelect }: PropertiesPanelProps) {
  // Escribir no crea un paso por tecla: el paso se guarda al entrar al campo.
  // rows > 1: área de texto; `code` usa letra monoespaciada (atributos y métodos).
  const text = (value: string, apply: (value: string) => VisualModel, rows = 1, code = false) => {
    const props = {
      value,
      readOnly,
      onFocus: onCheckpoint,
      onChange: (event: { target: { value: string } }) => onChange(apply(event.target.value), false),
      className: 'theme-input w-full rounded-md px-2 py-1.5 text-sm',
    }
    if (rows === 1) return <input type="text" {...props} />
    return <textarea rows={rows} spellCheck={false} {...props} className={`${props.className} ${code ? 'uml-field-code' : ''}`} />
  }
  const remove = (next: VisualModel) => {
    onChange(next, true)
    onSelect(null)
  }

  if (model.kind !== 'sequence') {
    const graph = model as GraphModel
    const spec = kindSpec(graph.kind)
    const node = selection?.kind === 'node' ? graph.nodes.find((item) => item.id === selection.id) : undefined
    const edge = selection?.kind === 'edge' ? graph.edges.find((item) => item.id === selection.id) : undefined

    if (node) {
      const current = nodeSpec(graph.kind, node.type)
      const swappable = current.group ? spec?.nodes.filter((item) => item.group === current.group) ?? [] : []
      return (
        <div className="uml-props">
          <p className="uml-props-title">{current.label}</p>
          {current.pseudo !== 'initial' && current.pseudo !== 'final' && current.pseudo !== 'fork' && current.pseudo !== 'join' && (
            <Field label={current.pseudo === 'choice' ? 'Pregunta de la decisión' : 'Nombre (Enter para otra línea)'}>
              {text(node.name, (value) => updateNode(graph, node.id, { name: value }), 2)}
            </Field>
          )}
          {swappable.length > 1 && (
            <Field label="Tipo">
              <select value={node.type} disabled={readOnly} onChange={(event) => onChange(updateNode(graph, node.id, { type: event.target.value }), true)} className={selectClass}>
                {swappable.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}
              </select>
            </Field>
          )}
          {node.type !== 'note' && !current.pseudo && (
            <Field label={current.stereotype ? `Estereotipo extra (ya es «${current.stereotype}»)` : 'Estereotipo (opcional)'}>
              {text(node.stereotype ?? '', (value) => updateNode(graph, node.id, { stereotype: value }))}
            </Field>
          )}
          {current.members && (
            <Field label={current.members === 'class' ? 'Atributos (uno por línea, p. ej. - id: UUID)' : node.type === 'enum' ? 'Valores (uno por línea)' : 'Campos (uno por línea)'}>
              {text((node.attributes ?? []).join('\n'), (value) => updateNode(graph, node.id, { attributes: value.split('\n') }), 4, true)}
            </Field>
          )}
          {current.members === 'class' && (
            <Field label="Métodos (uno por línea, p. ej. + guardar(): void)">
              {text((node.methods ?? []).join('\n'), (value) => updateNode(graph, node.id, { methods: value.split('\n') }), 4, true)}
            </Field>
          )}
          {current.members === 'class' && <p className="uml-props-hint">Visibilidad: + público, - privado, # protegido, ~ paquete. {'{static}'} y {'{abstract}'} también funcionan.</p>}
          {graph.kind === 'er' && <p className="uml-props-hint">«* campo» obligatorio, «&lt;&lt;PK&gt;&gt;» y «&lt;&lt;FK&gt;&gt;» marcan claves; «--» separa la clave del resto.</p>}
          {!readOnly && (
            <button type="button" onClick={() => remove(deleteNode(graph, node.id))} className="btn-danger mt-2 w-full px-3 py-1.5 text-sm">
              Eliminar elemento
            </button>
          )}
        </div>
      )
    }

    if (edge) {
      const current = edgeSpec(graph.kind, edge.type)
      const involvesNote = graph.nodes.some((item) => (item.id === edge.source || item.id === edge.target) && item.type === 'note')
      const types = involvesNote ? [edgeSpec(graph.kind, 'note-link')] : spec?.edges ?? []
      const name = (id: string) => graph.nodes.find((item) => item.id === id)?.name.split('\n')[0] ?? '?'
      return (
        <div className="uml-props">
          <p className="uml-props-title">Relación</p>
          <p className="uml-props-hint">{name(edge.source)} → {name(edge.target)}</p>
          <Field label="Tipo">
            <select value={edge.type} disabled={readOnly || involvesNote} onChange={(event) => onChange(updateEdge(graph, edge.id, { type: event.target.value }), true)} className={selectClass}>
              {types.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}
            </select>
          </Field>
          {edge.type !== 'include' && edge.type !== 'extend' && (
            <Field label={current.fixedText ? `Texto adicional (después de «${current.fixedText}»)` : graph.kind === 'communication' ? 'Mensajes (p. ej. 1: pagar())' : 'Etiqueta'}>
              {text(edge.label ?? '', (value) => updateEdge(graph, edge.id, { label: value }))}
            </Field>
          )}
          {current.ends === 'multiplicity' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label={`Extremo ${name(edge.source)}`}>{text(edge.sourceLabel ?? '', (value) => updateEdge(graph, edge.id, { sourceLabel: value }))}</Field>
                <Field label={`Extremo ${name(edge.target)}`}>{text(edge.targetLabel ?? '', (value) => updateEdge(graph, edge.id, { targetLabel: value }))}</Field>
              </div>
              <p className="uml-props-hint">Multiplicidad o rol en cada extremo: 1, 0..1, *, 1..*.</p>
            </>
          )}
          {current.ends === 'cardinality' && (
            <div className="grid grid-cols-2 gap-2">
              {(['sourceLabel', 'targetLabel'] as const).map((key) => (
                <Field key={key} label={`Lado ${name(key === 'sourceLabel' ? edge.source : edge.target)}`}>
                  <select
                    value={edge[key]?.trim() || (key === 'sourceLabel' ? '1' : '0..*')}
                    disabled={readOnly}
                    onChange={(event) => onChange(updateEdge(graph, edge.id, { [key]: event.target.value }), true)}
                    className={selectClass}
                  >
                    {CARDINALITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
              ))}
            </div>
          )}
          {(edge.points?.length ?? 0) > 0 && (
            <p className="uml-props-hint">{edge.points!.length} codo(s). Doble clic sobre un codo para quitarlo.</p>
          )}
          {!readOnly && (
            <div className="mt-2 grid gap-2">
              <button type="button" onClick={() => onChange(reverseEdge(graph, edge.id), true)} className="btn-ghost px-3 py-1.5 text-sm">⇄ Invertir dirección</button>
              {(edge.points?.length ?? 0) > 0 && (
                <button type="button" onClick={() => onChange(updateEdge(graph, edge.id, { points: undefined }), true)} className="btn-ghost px-3 py-1.5 text-sm">Quitar codos (línea recta)</button>
              )}
              <button type="button" onClick={() => remove(deleteEdge(graph, edge.id))} className="btn-danger px-3 py-1.5 text-sm">Eliminar relación</button>
            </div>
          )}
        </div>
      )
    }

    return (
      <div className="uml-props">
        <p className="uml-props-title">Diagrama</p>
        <Field label="Título (opcional)">{text(graph.title ?? '', (value) => ({ ...graph, title: value }))}</Field>
        <Field label="Distribución en PlantUML">
          <select value={graph.layout ?? 'auto'} disabled={readOnly} onChange={(event) => onChange({ ...graph, layout: event.target.value as GraphModel['layout'] }, true)} className={selectClass}>
            <option value="canvas">Aproximar la del lienzo</option>
            <option value="auto">Automática de PlantUML</option>
          </select>
        </Field>
        <p className="uml-props-hint">
          {graph.layout === 'canvas'
            ? 'Cada relación le indica a PlantUML hacia dónde está el otro elemento en el lienzo (arriba, abajo, izquierda o derecha). Es una aproximación: PlantUML no admite posiciones exactas ni codos.'
            : 'PlantUML ordena los elementos por su cuenta.'}
        </p>
        {graph.layout !== 'canvas' && (
          <Field label="Orientación">
            <select value={graph.direction} disabled={readOnly} onChange={(event) => onChange({ ...graph, direction: event.target.value as GraphModel['direction'] }, true)} className={selectClass}>
              <option value="top-to-bottom">De arriba hacia abajo</option>
              <option value="left-to-right">De izquierda a derecha</option>
            </select>
          </Field>
        )}
        {(graph.extra?.length ?? 0) > 0 && (
          <Field label="PlantUML adicional (se conserva tal cual)">
            {text((graph.extra ?? []).join('\n'), (value) => ({ ...graph, extra: value.split('\n') }), 4, true)}
          </Field>
        )}
        <ul className="uml-props-help">
          <li>Arrastra elementos desde la paleta o haz clic en ellos.</li>
          <li>Selecciona un elemento y arrastra su <strong>⊕</strong> hasta otro para conectarlos con la relación activa.</li>
          <li>Doble clic sobre una relación agrega un codo; arrástralo para darle forma.</li>
          {spec?.containerHint && <li>Lo que sueltes dentro de un {spec.containerHint} queda agrupado en él.</li>}
          <li>Rueda: desplazar · Ctrl + rueda: zoom · Supr: eliminar · flechas: mover.</li>
          <li>Ctrl + Z / Ctrl + Y: deshacer y rehacer · Ctrl + S: guardar.</li>
        </ul>
      </div>
    )
  }

  const sequence = model as SequenceModel
  const participant = selection?.kind === 'participant' ? sequence.participants.find((item) => item.id === selection.id) : undefined
  const message = selection?.kind === 'message' ? sequence.messages.find((item) => item.id === selection.id) : undefined

  if (participant) {
    const position = sequence.participants.indexOf(participant)
    const update = (patch: Partial<typeof participant>) => ({
      ...sequence,
      participants: sequence.participants.map((item) => (item.id === participant.id ? { ...item, ...patch } : item)),
    })
    return (
      <div className="uml-props">
        <p className="uml-props-title">Participante</p>
        <Field label="Nombre">{text(participant.name, (value) => update({ name: value }))}</Field>
        <Field label="Tipo">
          <select value={participant.type} disabled={readOnly} onChange={(event) => onChange(update({ type: event.target.value as ParticipantType }), true)} className={selectClass}>
            {(Object.keys(PARTICIPANT_LABELS) as ParticipantType[]).map((type) => <option key={type} value={type}>{PARTICIPANT_LABELS[type]}</option>)}
          </select>
        </Field>
        <p className="uml-props-hint">Alias en PlantUML: {participant.id}</p>
        {!readOnly && (
          <div className="mt-2 grid gap-2">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={position === 0} onClick={() => onChange(moveParticipant(sequence, participant.id, position - 1), true)} className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-40">← Mover</button>
              <button type="button" disabled={position === sequence.participants.length - 1} onClick={() => onChange(moveParticipant(sequence, participant.id, position + 1), true)} className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-40">Mover →</button>
            </div>
            <button type="button" onClick={() => remove(deleteParticipant(sequence, participant.id))} className="btn-danger px-3 py-1.5 text-sm">Eliminar participante y sus mensajes</button>
          </div>
        )}
      </div>
    )
  }

  if (message) {
    const position = sequence.messages.indexOf(message)
    const update = (patch: Partial<typeof message>) => ({
      ...sequence,
      messages: sequence.messages.map((item) => (item.id === message.id ? { ...item, ...patch } : item)),
    })
    const moveButtons = !readOnly && (
      <div className="mt-2 grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={position === 0} onClick={() => onChange(moveMessage(sequence, message.id, position - 1), true)} className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-40">↑ Antes</button>
          <button type="button" disabled={position === sequence.messages.length - 1} onClick={() => onChange(moveMessage(sequence, message.id, position + 1), true)} className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-40">↓ Después</button>
        </div>
        <button type="button" onClick={() => remove({ ...sequence, messages: sequence.messages.filter((item) => item.id !== message.id) })} className="btn-danger px-3 py-1.5 text-sm">
          Eliminar {message.raw !== undefined ? 'fila' : 'mensaje'}
        </button>
      </div>
    )
    if (message.raw !== undefined) {
      return (
        <div className="uml-props">
          <p className="uml-props-title">Fila de PlantUML</p>
          <Field label="Texto (alt, else, end, loop, note, ==, activate…)">{text(message.raw, (value) => update({ raw: value }), 1, true)}</Field>
          <p className="uml-props-hint">Los participantes se nombran por su alias (p1, p2…), visible al seleccionarlos.</p>
          {moveButtons}
        </div>
      )
    }
    const participantSelect = (value: string, key: 'from' | 'to') => (
      <select value={value} disabled={readOnly} onChange={(event) => onChange(update({ [key]: event.target.value }), true)} className={selectClass}>
        {sequence.participants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    )
    return (
      <div className="uml-props">
        <p className="uml-props-title">Mensaje {position + 1}</p>
        <Field label="Texto">{text(message.label, (value) => update({ label: value }))}</Field>
        <Field label="Tipo">
          <select value={message.type} disabled={readOnly} onChange={(event) => onChange(update({ type: event.target.value as MessageType }), true)} className={selectClass}>
            {(Object.keys(MESSAGE_LABELS) as MessageType[]).map((type) => <option key={type} value={type}>{MESSAGE_LABELS[type]}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Desde">{participantSelect(message.from, 'from')}</Field>
          <Field label="Hacia">{participantSelect(message.to, 'to')}</Field>
        </div>
        {moveButtons}
      </div>
    )
  }

  return (
    <div className="uml-props">
      <p className="uml-props-title">Diagrama</p>
      <Field label="Título (opcional)">{text(sequence.title ?? '', (value) => ({ ...sequence, title: value }))}</Field>
      <label className="flex items-center gap-2 text-sm text-[var(--text-main)]">
        <input type="checkbox" checked={sequence.autonumber} disabled={readOnly} onChange={(event) => onChange({ ...sequence, autonumber: event.target.checked }, true)} />
        Numerar los mensajes
      </label>
      {!readOnly && (
        <Field label="Agregar fragmento o fila al final">
          <select
            value=""
            onChange={(event) => {
              if (!event.target.value) return
              const result = addRawRow(sequence, event.target.value)
              onChange(result.model, true)
              onSelect({ kind: 'message', id: result.id })
            }}
            className={`${selectClass} mt-1`}
          >
            <option value="">Elegir…</option>
            {RAW_SNIPPETS.map((snippet) => <option key={snippet} value={snippet}>{snippet}</option>)}
          </select>
        </Field>
      )}
      <ul className="uml-props-help">
        <li>Agrega participantes desde la paleta (clic o arrastre).</li>
        <li>Arrastra de una línea de vida a otra para crear un mensaje del tipo activo; a la misma línea, un mensaje a sí mismo.</li>
        <li>Los fragmentos (alt, loop…) son filas que se arrastran como los mensajes: ubícalos antes y después de lo que agrupan.</li>
        <li>Supr: eliminar · flechas: reordenar · Ctrl + Z / Ctrl + Y · Ctrl + S.</li>
      </ul>
    </div>
  )
}

export default PropertiesPanel

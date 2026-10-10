import type { ReactNode } from 'react'

import type { Selection } from './GraphCanvas'
import { isClassLike } from '../../../domain/uml/geometry'
import { deleteEdge, deleteNode, deleteParticipant, moveMessage, moveParticipant, reverseEdge, updateEdge, updateNode } from '../../../domain/uml/modelOps'
import {
  EDGE_LABELS,
  MESSAGE_LABELS,
  NODE_LABELS,
  PALETTE,
  PARTICIPANT_LABELS,
  type EdgeType,
  type GraphModel,
  type MessageType,
  type NodeType,
  type ParticipantType,
  type SequenceModel,
  type VisualModel,
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

/** Tipos intercambiables entre sí sin perder información. */
const SWAPPABLE: NodeType[][] = [['class', 'abstract', 'interface', 'enum'], ['actor', 'usecase'], ['boundary'], ['package'], ['note']]

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="uml-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

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
    const graph: GraphModel = model
    const node = selection?.kind === 'node' ? graph.nodes.find((item) => item.id === selection.id) : undefined
    const edge = selection?.kind === 'edge' ? graph.edges.find((item) => item.id === selection.id) : undefined

    if (node) {
      const swappable = SWAPPABLE.find((group) => group.includes(node.type)) ?? [node.type]
      const classLike = isClassLike(node)
      return (
        <div className="uml-props">
          <p className="uml-props-title">{NODE_LABELS[node.type]}</p>
          <Field label="Nombre (Enter para otra línea)">{text(node.name, (value) => updateNode(graph, node.id, { name: value }), 2)}</Field>
          {swappable.length > 1 && (
            <Field label="Tipo">
              <select
                value={node.type}
                disabled={readOnly}
                onChange={(event) => onChange(updateNode(graph, node.id, { type: event.target.value as NodeType }), true)}
                className="theme-input w-full rounded-md px-2 py-1.5 text-sm"
              >
                {swappable.map((type) => <option key={type} value={type}>{NODE_LABELS[type]}</option>)}
              </select>
            </Field>
          )}
          {node.type !== 'note' && (
            <Field label="Estereotipo (opcional)">{text(node.stereotype ?? '', (value) => updateNode(graph, node.id, { stereotype: value }))}</Field>
          )}
          {classLike && (
            <Field label={node.type === 'enum' ? 'Valores (uno por línea)' : 'Atributos (uno por línea, p. ej. - id: UUID)'}>
              {text((node.attributes ?? []).join('\n'), (value) => updateNode(graph, node.id, { attributes: value.split('\n') }), 4, true)}
            </Field>
          )}
          {classLike && node.type !== 'enum' && (
            <Field label="Métodos (uno por línea, p. ej. + guardar(): void)">
              {text((node.methods ?? []).join('\n'), (value) => updateNode(graph, node.id, { methods: value.split('\n') }), 4, true)}
            </Field>
          )}
          {classLike && <p className="uml-props-hint">Visibilidad: + público, - privado, # protegido, ~ paquete. {'{static}'} y {'{abstract}'} también funcionan.</p>}
          {!readOnly && (
            <button type="button" onClick={() => remove(deleteNode(graph, node.id))} className="btn-danger mt-2 w-full px-3 py-1.5 text-sm">
              Eliminar elemento
            </button>
          )}
        </div>
      )
    }

    if (edge) {
      const involvesNote = graph.nodes.some((item) => (item.id === edge.source || item.id === edge.target) && item.type === 'note')
      const types: EdgeType[] = involvesNote ? ['note-link'] : PALETTE[graph.kind].edges
      const name = (id: string) => graph.nodes.find((item) => item.id === id)?.name.split('\n')[0] ?? '?'
      return (
        <div className="uml-props">
          <p className="uml-props-title">Relación</p>
          <p className="uml-props-hint">{name(edge.source)} → {name(edge.target)}</p>
          <Field label="Tipo">
            <select
              value={edge.type}
              disabled={readOnly || involvesNote}
              onChange={(event) => onChange(updateEdge(graph, edge.id, { type: event.target.value as EdgeType }), true)}
              className="theme-input w-full rounded-md px-2 py-1.5 text-sm"
            >
              {types.map((type) => <option key={type} value={type}>{EDGE_LABELS[type]}</option>)}
            </select>
          </Field>
          {edge.type !== 'include' && edge.type !== 'extend' && (
            <Field label="Etiqueta">{text(edge.label ?? '', (value) => updateEdge(graph, edge.id, { label: value }))}</Field>
          )}
          {graph.kind === 'class' && edge.type !== 'note-link' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label={`Extremo ${name(edge.source)}`}>{text(edge.sourceLabel ?? '', (value) => updateEdge(graph, edge.id, { sourceLabel: value }))}</Field>
              <Field label={`Extremo ${name(edge.target)}`}>{text(edge.targetLabel ?? '', (value) => updateEdge(graph, edge.id, { targetLabel: value }))}</Field>
            </div>
          )}
          {graph.kind === 'class' && <p className="uml-props-hint">Multiplicidad o rol en cada extremo: 1, 0..1, *, 1..*.</p>}
          {!readOnly && (
            <div className="mt-2 grid gap-2">
              <button type="button" onClick={() => onChange(reverseEdge(graph, edge.id), true)} className="btn-ghost px-3 py-1.5 text-sm">⇄ Invertir dirección</button>
              <button type="button" onClick={() => remove(deleteEdge(graph, edge.id))} className="btn-danger px-3 py-1.5 text-sm">Eliminar relación</button>
            </div>
          )}
        </div>
      )
    }

    return (
      <div className="uml-props">
        <p className="uml-props-title">Diagrama</p>
        <Field label="Orientación al generar PlantUML">
          <select
            value={graph.direction}
            disabled={readOnly}
            onChange={(event) => onChange({ ...graph, direction: event.target.value as GraphModel['direction'] }, true)}
            className="theme-input w-full rounded-md px-2 py-1.5 text-sm"
          >
            <option value="top-to-bottom">De arriba hacia abajo</option>
            <option value="left-to-right">De izquierda a derecha</option>
          </select>
        </Field>
        <ul className="uml-props-help">
          <li>Arrastra elementos desde la paleta o haz clic en ellos.</li>
          <li>Selecciona un elemento y arrastra su <strong>⊕</strong> hasta otro para conectarlos con la relación activa.</li>
          <li>Lo que sueltes dentro de un {graph.kind === 'usecase' ? 'límite del sistema' : 'paquete'} queda agrupado en él.</li>
          <li>Rueda: desplazar · Ctrl + rueda: zoom · Supr: eliminar · flechas: mover.</li>
          <li>Ctrl + Z / Ctrl + Y: deshacer y rehacer · Ctrl + S: guardar.</li>
        </ul>
      </div>
    )
  }

  const sequence: SequenceModel = model
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
          <select
            value={participant.type}
            disabled={readOnly}
            onChange={(event) => onChange(update({ type: event.target.value as ParticipantType }), true)}
            className="theme-input w-full rounded-md px-2 py-1.5 text-sm"
          >
            {(Object.keys(PARTICIPANT_LABELS) as ParticipantType[]).map((type) => <option key={type} value={type}>{PARTICIPANT_LABELS[type]}</option>)}
          </select>
        </Field>
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
    const participantSelect = (value: string, key: 'from' | 'to') => (
      <select
        value={value}
        disabled={readOnly}
        onChange={(event) => onChange(update({ [key]: event.target.value }), true)}
        className="theme-input w-full rounded-md px-2 py-1.5 text-sm"
      >
        {sequence.participants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    )
    return (
      <div className="uml-props">
        <p className="uml-props-title">Mensaje {position + 1}</p>
        <Field label="Texto">{text(message.label, (value) => update({ label: value }))}</Field>
        <Field label="Tipo">
          <select
            value={message.type}
            disabled={readOnly}
            onChange={(event) => onChange(update({ type: event.target.value as MessageType }), true)}
            className="theme-input w-full rounded-md px-2 py-1.5 text-sm"
          >
            {(Object.keys(MESSAGE_LABELS) as MessageType[]).map((type) => <option key={type} value={type}>{MESSAGE_LABELS[type]}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Desde">{participantSelect(message.from, 'from')}</Field>
          <Field label="Hacia">{participantSelect(message.to, 'to')}</Field>
        </div>
        {!readOnly && (
          <div className="mt-2 grid gap-2">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={position === 0} onClick={() => onChange(moveMessage(sequence, message.id, position - 1), true)} className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-40">↑ Antes</button>
              <button type="button" disabled={position === sequence.messages.length - 1} onClick={() => onChange(moveMessage(sequence, message.id, position + 1), true)} className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-40">↓ Después</button>
            </div>
            <button type="button" onClick={() => remove({ ...sequence, messages: sequence.messages.filter((item) => item.id !== message.id) })} className="btn-danger px-3 py-1.5 text-sm">Eliminar mensaje</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="uml-props">
      <p className="uml-props-title">Diagrama</p>
      <label className="flex items-center gap-2 text-sm text-[var(--text-main)]">
        <input type="checkbox" checked={sequence.autonumber} disabled={readOnly} onChange={(event) => onChange({ ...sequence, autonumber: event.target.checked }, true)} />
        Numerar los mensajes
      </label>
      <ul className="uml-props-help">
        <li>Agrega participantes desde la paleta (clic o arrastre).</li>
        <li>Arrastra de una línea de vida a otra para crear un mensaje del tipo activo; a la misma línea, un mensaje a sí mismo.</li>
        <li>Arrastra un participante en horizontal o un mensaje en vertical para reordenarlos.</li>
        <li>Supr: eliminar · flechas: reordenar · Ctrl + Z / Ctrl + Y · Ctrl + S.</li>
      </ul>
    </div>
  )
}

export default PropertiesPanel

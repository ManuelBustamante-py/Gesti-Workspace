import { inputClass, textField, type FormProps } from './forms'
import { nextId } from '../../../domain/uml/ids'
import { nwIdentifier, type NetworkHost, type NetworkModel } from '../../../domain/uml/structured'

/** Red: segmentos (con su rango) y equipos conectados a uno o más segmentos. */
function NetworkForm(props: FormProps<NetworkModel>) {
  const { model, readOnly, onChange } = props
  const updateHost = (id: string, patch: Partial<NetworkHost>, record = true) =>
    onChange({ ...model, hosts: model.hosts.map((host) => (host.id === id ? { ...host, ...patch } : host)) }, record)
  const toggleLink = (host: NetworkHost, network: string) => {
    const linked = host.links.some((link) => link.network === network)
    updateHost(host.id, { links: linked ? host.links.filter((link) => link.network !== network) : [...host.links, { network }] })
  }

  return (
    <div className="struct-form">
      <label className="uml-field">
        <span>Título (opcional)</span>
        <input type="text" {...textField(props, model.title ?? '', (value) => ({ ...model, title: value }))} className={inputClass} />
      </label>

      <p className="uml-palette-title">Segmentos de red</p>
      {model.networks.map((network) => (
        <div key={network.id} className="struct-row">
          <input type="text" {...textField(props, network.name, (value) => ({ ...model, networks: model.networks.map((item) => (item.id === network.id ? { ...item, name: nwIdentifier(value) } : item)) }))} placeholder="nombre (sin espacios)" className={inputClass} aria-label="Nombre del segmento" />
          <input type="text" {...textField(props, network.address ?? '', (value) => ({ ...model, networks: model.networks.map((item) => (item.id === network.id ? { ...item, address: value } : item)) }))} placeholder="192.168.1.0/24" className={inputClass} aria-label="Rango de direcciones" />
          {!readOnly && (
            <button type="button" className="flow-zoom-button" title="Eliminar segmento" onClick={() => onChange({
              ...model,
              networks: model.networks.filter((item) => item.id !== network.id),
              hosts: model.hosts.map((host) => ({ ...host, links: host.links.filter((link) => link.network !== network.id) })),
            }, true)}>✕</button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button type="button" className="btn-ghost mb-3 px-3 py-1.5 text-sm" onClick={() => {
          const id = nextId('p', model.networks.map((network) => network.id))
          onChange({ ...model, networks: [...model.networks, { id, name: `red${model.networks.length + 1}`, address: '' }] }, true)
        }}>＋ Segmento</button>
      )}

      <p className="uml-palette-title">Equipos</p>
      <div className="struct-table-wrap">
        <table className="struct-table">
          <thead>
            <tr>
              <th>Equipo</th><th>Descripción</th>
              {model.networks.map((network) => <th key={network.id}>{network.name}</th>)}
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {model.hosts.map((host) => (
              <tr key={host.id}>
                <td><input type="text" {...textField(props, host.name, (value) => ({ ...model, hosts: model.hosts.map((item) => (item.id === host.id ? { ...item, name: nwIdentifier(value) } : item)) }))} className={inputClass} aria-label="Nombre del equipo" /></td>
                <td><input type="text" {...textField(props, host.description ?? '', (value) => ({ ...model, hosts: model.hosts.map((item) => (item.id === host.id ? { ...item, description: value } : item)) }))} className={inputClass} aria-label="Descripción" /></td>
                {model.networks.map((network) => {
                  const link = host.links.find((item) => item.network === network.id)
                  return (
                    <td key={network.id}>
                      <div className="flex items-center gap-1">
                        <input type="checkbox" checked={Boolean(link)} disabled={readOnly} onChange={() => toggleLink(host, network.id)} aria-label={`Conectado a ${network.name}`} />
                        {link && (
                          <input
                            type="text"
                            {...textField(props, link.address ?? '', (value) => ({ ...model, hosts: model.hosts.map((item) => (item.id === host.id ? { ...item, links: item.links.map((other) => (other.network === network.id ? { ...other, address: value } : other)) } : item)) }))}
                            placeholder="dirección"
                            className={`${inputClass} min-w-[7rem]`}
                            aria-label={`Dirección en ${network.name}`}
                          />
                        )}
                      </div>
                    </td>
                  )
                })}
                <td>{!readOnly && <button type="button" className="flow-zoom-button" title="Eliminar equipo" onClick={() => onChange({ ...model, hosts: model.hosts.filter((item) => item.id !== host.id) }, true)}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <button type="button" className="btn-ghost mt-2 px-3 py-1.5 text-sm" disabled={model.networks.length === 0} onClick={() => {
          const id = nextId('n', model.hosts.map((host) => host.id))
          onChange({ ...model, hosts: [...model.hosts, { id, name: `equipo${model.hosts.length + 1}`, links: model.networks[0] ? [{ network: model.networks[0].id }] : [] }] }, true)
        }}>＋ Equipo</button>
      )}
    </div>
  )
}

export default NetworkForm

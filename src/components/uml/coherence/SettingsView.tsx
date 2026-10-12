import {
  CLASSIC_FORBIDDEN,
  COMPARISONS,
  MVC_LAYERS,
  MVC_LAYER_LABELS,
  PASSIVE_FORBIDDEN,
  RULES,
  normalizeName,
  type ArchitectureReport,
  type ArchitectureSettings,
  type MvcLayer,
} from '../../../domain/uml/coherence'

interface SettingsViewProps {
  report: ArchitectureReport
  settings: ArchitectureSettings
  canEdit: boolean
  onChange: (settings: ArchitectureSettings) => void
}

const toggle = (list: string[], value: string, on: boolean) => (on ? [...new Set([...list, value])] : list.filter((item) => item !== value))

/** Reglas arquitectónicas del tablero: estilo declarado, contratos, componentes lógicos y reglas activas. */
function SettingsView({ report, settings, canEdit, onChange }: SettingsViewProps) {
  const disabled = !canEdit
  const classDiagrams = report.model.diagrams.filter((diagram) => diagram.kind === 'class' || diagram.kind === 'package')
  const components = [...new Map(report.model.elements
    .filter((element) => element.kind === 'component' && report.model.diagrams.find((diagram) => diagram.id === element.diagramId)?.kind === 'component')
    .map((element) => [normalizeName(element.name), element.name])).entries()]
  const isForbidden = (from: MvcLayer, to: MvcLayer) => settings.mvc.forbidden.some((rule) => rule.from === from && rule.to === to)
  const setForbidden = (from: MvcLayer, to: MvcLayer, on: boolean) =>
    onChange({ ...settings, mvc: { ...settings.mvc, forbidden: on ? [...settings.mvc.forbidden, { from, to }] : settings.mvc.forbidden.filter((rule) => !(rule.from === from && rule.to === to)) } })

  return (
    <div className="grid gap-6">
      {!canEdit && <p className="text-xs text-[var(--text-muted)]">Tu rol es de lector: puedes consultar la configuración, pero solo el propietario o un editor puede cambiarla.</p>}

      <section>
        <h3 className="uml-interpretation-heading">Estilo arquitectónico declarado</h3>
        <div className="flex flex-wrap gap-2">
          {(['none', 'mvc'] as const).map((style) => (
            <label key={style} className={`uml-mode ${settings.style === style ? 'uml-mode-active' : ''}`}>
              <input type="radio" className="sr-only" name="arch-style" checked={settings.style === style} disabled={disabled} onChange={() => onChange({ ...settings, style })} />
              {style === 'mvc' ? 'MVC' : 'Sin estilo declarado'}
            </label>
          ))}
        </div>
        {settings.style === 'mvc' && (
          <div className="mt-3 grid gap-3">
            <label className="uml-field max-w-sm">
              <span>Variante</span>
              <select
                className="theme-input w-full rounded-md px-2 py-1.5 text-sm"
                value={settings.mvc.variant}
                disabled={disabled}
                onChange={(event) => {
                  const variant = event.target.value as 'classic' | 'passive'
                  onChange({ ...settings, mvc: { ...settings.mvc, variant, forbidden: (variant === 'passive' ? PASSIVE_FORBIDDEN : CLASSIC_FORBIDDEN).map((rule) => ({ ...rule })) } })
                }}
              >
                <option value="classic">Clásico: la vista puede leer el modelo</option>
                <option value="passive">Vista pasiva: la vista solo habla con el controlador</option>
              </select>
            </label>
            <div>
              <p className="mb-1 text-xs text-[var(--text-muted)]">Dependencias prohibidas (fila depende de columna). Las capas se deducen de estereotipos («view», «controller», «model», «repository»), del tipo de participante, del rol en el nombre o del paquete.</p>
              <div className="overflow-x-auto">
                <table className="arch-matrix">
                  <thead>
                    <tr>
                      <th scope="col">Origen \ destino</th>
                      {MVC_LAYERS.map((layer) => <th key={layer} scope="col">{MVC_LAYER_LABELS[layer]}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {MVC_LAYERS.map((from) => (
                      <tr key={from}>
                        <th scope="row">{MVC_LAYER_LABELS[from]}</th>
                        {MVC_LAYERS.map((to) => (
                          <td key={to}>
                            {from === to ? '—' : (
                              <input type="checkbox" aria-label={`Prohibir ${MVC_LAYER_LABELS[from]} → ${MVC_LAYER_LABELS[to]}`} checked={isForbidden(from, to)} disabled={disabled} onChange={(event) => setForbidden(from, to, event.target.checked)} />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <label className="uml-field max-w-xs">
              <span>Operaciones máximas por controlador</span>
              <input
                type="number"
                min={1}
                className="theme-input w-full rounded-md px-2 py-1.5 text-sm"
                value={settings.mvc.controllerMaxOperations}
                disabled={disabled}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  if (Number.isFinite(value) && value >= 1) onChange({ ...settings, mvc: { ...settings.mvc, controllerMaxOperations: Math.round(value) } })
                }}
              />
            </label>
          </div>
        )}
      </section>

      <section>
        <h3 className="uml-interpretation-heading">Contratos completos</h3>
        <p className="mb-2 text-xs text-[var(--text-muted)]">Marca los diagramas de clases que declaran todas las operaciones: ahí una operación invocada que no existe es contradicción. Si no, se trata como omisión de un diagrama parcial.</p>
        {classDiagrams.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No hay diagramas de clases.</p> : (
          <ul className="grid gap-1">
            {classDiagrams.map((diagram) => (
              <li key={diagram.id}>
                <label className="flex items-center gap-2 text-sm text-[var(--text-main)]">
                  <input type="checkbox" checked={settings.completeContracts.includes(diagram.id)} disabled={disabled} onChange={(event) => onChange({ ...settings, completeContracts: toggle(settings.completeContracts, diagram.id, event.target.checked) })} />
                  {diagram.name}
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="uml-interpretation-heading">Componentes lógicos</h3>
        <p className="mb-2 text-xs text-[var(--text-muted)]">Componentes que no se despliegan por separado (bibliotecas, módulos internos): no se les exige ubicación en el despliegue. También se reconocen los estereotipos «library», «module» o «subsystem».</p>
        {components.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No hay componentes.</p> : (
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {components.map(([key, name]) => (
              <li key={key}>
                <label className="flex items-center gap-2 text-sm text-[var(--text-main)]">
                  <input type="checkbox" checked={settings.logicalComponents.includes(key)} disabled={disabled} onChange={(event) => onChange({ ...settings, logicalComponents: toggle(settings.logicalComponents, key, event.target.checked) })} />
                  {name}
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="uml-interpretation-heading">Excepciones registradas ({settings.exceptions.length})</h3>
        {settings.exceptions.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Ninguna. Se registran desde el detalle de un hallazgo.</p>
        ) : (
          <ul className="grid gap-2">
            {settings.exceptions.map((exception) => {
              const active = report.findings.some((finding) => finding.fingerprint === exception.fingerprint)
              return (
                <li key={exception.fingerprint} className="arch-comparison text-xs">
                  <p className="text-sm text-[var(--text-main)]">{exception.title || exception.ruleId}</p>
                  <p className="mt-1 text-[var(--text-muted)]">{exception.justification}{exception.author ? ` — ${exception.author}` : ''}</p>
                  {!active && <p className="mt-1 text-[var(--text-muted)]">El hallazgo ya no aparece (se corrigió o cambió el diagrama).</p>}
                  {canEdit && (
                    <button type="button" className="btn-ghost mt-2 px-3 py-1 text-xs" onClick={() => onChange({ ...settings, exceptions: settings.exceptions.filter((item) => item.fingerprint !== exception.fingerprint) })}>
                      Quitar
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section>
        <h3 className="uml-interpretation-heading">Reglas activas</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {COMPARISONS.map((comparison) => (
            <div key={comparison.id}>
              <p className="text-xs font-semibold text-[var(--text-main)]">{comparison.title}</p>
              <ul className="mt-1 grid gap-1">
                {RULES.filter((rule) => rule.comparison === comparison.id).map((rule) => (
                  <li key={rule.id}>
                    <label className="flex items-start gap-2 text-xs text-[var(--text-muted)]" title={rule.description}>
                      <input type="checkbox" className="mt-0.5" checked={!settings.disabledRules.includes(rule.id)} disabled={disabled} onChange={(event) => onChange({ ...settings, disabledRules: toggle(settings.disabledRules, rule.id, !event.target.checked) })} />
                      <span><span className="text-[var(--text-main)]">{rule.title}</span> — {rule.description}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default SettingsView

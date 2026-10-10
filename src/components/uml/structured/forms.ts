/** Props comunes de los editores estructurados (mapa mental, Gantt, red, tiempos, wireframe). */
export type FormProps<T> = {
  model: T
  readOnly: boolean
  /** record = false: cambio continuo (escribir) que no crea paso de deshacer. */
  onChange: (next: T, record: boolean) => void
  /** Guarda un paso de deshacer antes de una edición continua. */
  onCheckpoint: () => void
  selectedId?: string | null
  onSelect?: (id: string | null) => void
}

/** Props de un campo de texto: el paso de deshacer se guarda al entrar, no por tecla. */
export function textField<T>(props: FormProps<T>, value: string, apply: (value: string) => T) {
  return {
    value,
    readOnly: props.readOnly,
    onFocus: props.onCheckpoint,
    onChange: (event: { target: { value: string } }) => props.onChange(apply(event.target.value), false),
  }
}

export const inputClass = 'theme-input w-full rounded-md px-2 py-1.5 text-sm'

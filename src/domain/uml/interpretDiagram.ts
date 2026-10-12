import { interpretModel, type Interpretation } from './interpret'
import { explainRegex } from './interpretStructured'
import { parsePlantUml } from './parsePlantUml'
import { isVisualKind, modelFromDiagram } from './visualModel'

/**
 * Interpretación de un diagrama guardado (como la muestra su editor): el
 * modelo visual si es válido; si no, el código PlantUML. null si el tipo no
 * tiene interpretación o el código no se puede leer.
 */
export function interpretDiagram(diagram: { kind: string; mode: string; source: string; model: unknown }): Interpretation | null {
  if (diagram.kind === 'regex') return explainRegex(diagram.source ?? '')
  if (!isVisualKind(diagram.kind)) return null
  try {
    if (diagram.mode === 'visual') {
      const model = modelFromDiagram(diagram.kind, diagram.model)
      // modelFromDiagram devuelve el mismo objeto solo si el modelo guardado es válido.
      if (model === diagram.model) return interpretModel(model)
    }
    if (!diagram.source?.trim()) return null
    return interpretModel(parsePlantUml(diagram.source, diagram.kind, null).model)
  } catch {
    return null
  }
}

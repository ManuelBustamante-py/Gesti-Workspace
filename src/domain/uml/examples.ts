import { umlDiagramType } from '../umlCatalog'
import { parsePlantUml } from './parsePlantUml'
import { emptyModel, handmadeExample, type VisualModel } from './visualModel'

/**
 * Modelo con el que empieza un diagrama visual nuevo: vacío, o un ejemplo.
 * Los tipos más usados tienen un ejemplo dibujado a mano; el resto se arma
 * interpretando la plantilla de código del catálogo (y se distribuye solo).
 */
export function initialModel(kind: string, withExample: boolean): VisualModel {
  if (!withExample) return emptyModel(kind)
  const handmade = handmadeExample(kind)
  if (handmade) return handmade
  const template = umlDiagramType(kind)?.template
  return template ? parsePlantUml(template, kind).model : emptyModel(kind)
}

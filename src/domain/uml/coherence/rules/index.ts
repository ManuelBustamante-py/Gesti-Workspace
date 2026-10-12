/**
 * Registro de reglas y de comparaciones entre vistas. Para incorporar un tipo
 * de diagrama nuevo (p. ej. actividades) basta con extraerlo en extract.ts,
 * declarar su comparación aquí y registrar sus reglas.
 */
import type { RuleSpec } from '../context'
import type { AnalyzedKind, ComparisonId } from '../types'
import { INTERACTION_RULES } from './interactions'
import { MODULE_RULES } from './modules'
import { MVC_RULES } from './mvc'
import { SCENARIO_RULES } from './scenarios'
import { STRUCTURE_RULES } from './structure'

export const RULES: RuleSpec[] = [...SCENARIO_RULES, ...INTERACTION_RULES, ...MODULE_RULES, ...STRUCTURE_RULES, ...MVC_RULES]

export type ComparisonSpec = {
  id: ComparisonId
  title: string
  /** Grupos de tipos necesarios (uno de cada grupo). */
  requires: AnalyzedKind[][]
  /** Qué agregar para ejecutarla. */
  enable: string
}

export const COMPARISONS: ComparisonSpec[] = [
  { id: 'uc-seq', title: 'Casos de uso ↔ secuencia', requires: [['usecase'], ['sequence']], enable: 'Un diagrama de casos de uso y al menos un diagrama de secuencia nombrado como el caso que realiza.' },
  { id: 'seq-cls', title: 'Secuencia ↔ clases', requires: [['sequence'], ['class', 'package']], enable: 'Un diagrama de clases con operaciones y escenarios cuyos participantes usen el nombre de las clases.' },
  { id: 'cls-cmp', title: 'Clases ↔ componentes', requires: [['class', 'package'], ['component']], enable: 'Un diagrama de componentes y clases agrupadas en paquetes con el nombre de cada componente.' },
  { id: 'cmp-dep', title: 'Componentes ↔ despliegue', requires: [['component'], ['deployment']], enable: 'Un diagrama de despliegue con los artefactos o componentes dentro de sus nodos y las conexiones entre nodos.' },
  { id: 'seq-cmp', title: 'Secuencia ↔ componentes', requires: [['sequence'], ['component']], enable: 'Un diagrama de componentes cuyos nombres coincidan con los participantes (o con los paquetes de sus clases).' },
  { id: 'uc-cls', title: 'Casos de uso ↔ clases', requires: [['usecase'], ['class', 'package']], enable: 'Un diagrama de clases con las operaciones que realizan los casos de uso.' },
  { id: 'structure', title: 'Estructura entre diagramas (clases, MER)', requires: [['class', 'package', 'er']], enable: 'Dos o más diagramas estructurales (p. ej. clases y entidad-relación) que compartan conceptos.' },
  { id: 'mvc', title: 'Arquitectura MVC', requires: [['class', 'package', 'sequence', 'component']], enable: 'Declarar el estilo MVC en la configuración y marcar las capas con estereotipos.' },
]

export const ruleById = (id: string) => RULES.find((rule) => rule.id === id) ?? null

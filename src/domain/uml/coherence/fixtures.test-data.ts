/** Diagramas de prueba (PlantUML, como los guarda el editor en modo código). */
import type { DiagramInput } from './types'

const code = (id: string, kind: string, name: string, ...lines: string[]): DiagramInput => ({
  id, kind, name, mode: 'code', model: null, source: ['@startuml', ...lines, '@enduml'].join('\n'),
})

export const useCases = code('d1-usecase', 'usecase', 'Casos de uso',
  'left to right direction',
  'actor Miembro',
  'actor Propietario',
  'Propietario --|> Miembro',
  'rectangle Gesti {',
  '  usecase "Crear tarea" as UC1',
  '  usecase "Mover tarea" as UC2',
  '  usecase "Validar permisos" as UC3',
  '}',
  'Miembro -- UC1',
  'Miembro -- UC2',
  'UC1 ..> UC3 : <<include>>',
)

export const sequenceLines = [
  'actor Miembro',
  'boundary TableroVista',
  'control TareaController',
  'participant TareaRepositorio',
  'Miembro -> TableroVista : Crear tarea',
  'TableroVista -> TareaController : crearTarea(titulo)',
  'TareaController -> TareaController : validarPermisos(miembro)',
  'TareaController -> TareaRepositorio : guardar(tarea)',
  'TareaRepositorio --> TareaController : tarea',
  'TareaController --> TableroVista : tarea',
]
export const sequence = code('d2-sequence', 'sequence', 'Crear tarea', ...sequenceLines)

export const classLines = [
  'package Frontend {',
  '  class TableroVista {',
  '    + mostrar(): void',
  '  }',
  '}',
  'package Backend {',
  '  class TareaController {',
  '    + crearTarea(titulo: String): Tarea',
  '    + validarPermisos(miembro: Miembro): boolean',
  '  }',
  '  class TareaRepositorio {',
  '    + guardar(tarea: Tarea): Tarea',
  '  }',
  '  class Tarea {',
  '    - titulo: String',
  '  }',
  '}',
  'TableroVista --> TareaController',
  'TareaController --> TareaRepositorio',
  'TareaRepositorio --> Tarea',
]
export const classes = code('d3-class', 'class', 'Clases', ...classLines)

export const componentLines = [
  'component Frontend',
  'component Backend',
  'database "Base de datos" as DB',
  'Frontend --> Backend',
  'Backend --> DB',
]
export const components = code('d4-component', 'component', 'Componentes', ...componentLines)

export const deploymentLines = [
  'node Navegador <<device>> {',
  '  artifact Frontend',
  '}',
  'node Servidor {',
  '  artifact Backend',
  '  database "Base de datos" as DB',
  '}',
  'Navegador -- Servidor : HTTPS',
]
export const deployment = code('d5-deployment', 'deployment', 'Despliegue', ...deploymentLines)

export const coherentSet = [useCases, sequence, classes, components, deployment]
export { code }

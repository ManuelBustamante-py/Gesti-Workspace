import { describe, expect, it } from 'vitest'

import { parsePlantUml } from '../parsePlantUml'
import { evaluateArchitecture } from './evaluate'
import { code, classes, coherentSet, componentLines, components, deployment, sequence, sequenceLines, useCases } from './fixtures.test-data'
import { stableKey } from './matching'
import { normalizeName, terms } from './names'
import { reportToMarkdown } from './report'
import { defaultSettings } from './settings'
import type { ArchitectureReport, ArchitectureSettings, DiagramInput, FindingCategory } from './types'

const settings = (patch: Partial<ArchitectureSettings> = {}): ArchitectureSettings => ({ ...defaultSettings(), ...patch })
const of = (report: ArchitectureReport, category: FindingCategory) => report.findings.filter((finding) => finding.category === category && !finding.exception)
const types = (report: ArchitectureReport, category?: FindingCategory) =>
  report.findings.filter((finding) => !category || finding.category === category).map((finding) => finding.type)
const comparison = (report: ArchitectureReport, id: string) => report.coverage.comparisons.find((item) => item.id === id)!

describe('normalización de nombres', () => {
  it('unifica singular/plural, sinónimos y estilos de escritura', () => {
    expect(terms('TaskService')).toEqual(['tarea', 'servicio'])
    expect(terms('Servicio de tareas')).toEqual(['servicio', 'tarea'])
    expect(terms('servidores')).toEqual(terms('Servidor'))
    expect(terms('detalles')).toEqual(terms('detalle'))
    expect(terms('Base de Datos')).toEqual(['basedatos'])
    expect(normalizeName('app.jar «artifact»')).toBe('app')
  })
})

describe('evaluateArchitecture · 1. diagramas coherentes', () => {
  const report = evaluateArchitecture(coherentSet)

  it('no informa contradicciones ni posibles inconsistencias', () => {
    expect(of(report, 'contradiction')).toEqual([])
    expect(of(report, 'possible')).toEqual([])
    expect(report.status).toBe('consistent-so-far')
    expect(report.index.value).toBe(1)
    expect(report.index.conclusive).toBeGreaterThan(15)
  })

  it('ejecuta las comparaciones posibles con los cinco diagramas y explica las omitidas', () => {
    for (const id of ['uc-seq', 'seq-cls', 'cls-cmp', 'cmp-dep', 'seq-cmp', 'uc-cls']) expect(comparison(report, id).status).toBe('executed')
    expect(comparison(report, 'structure').status).toBe('skipped')
    expect(comparison(report, 'structure').reason).toMatch(/dos diagramas estructurales/)
    expect(comparison(report, 'mvc').reason).toMatch(/no declara el estilo MVC/)
  })

  it('el caso incluido se respalda como paso del escenario que lo incluye', () => {
    expect(types(report, 'unverifiable')).toContain('usecase-without-scenario')
    const finding = report.findings.find((item) => item.type === 'usecase-without-scenario')!
    expect(finding.elements.map((element) => element.name)).toEqual(['Mover tarea'])
  })

  it('no propone como hipótesis nombres que solo difieren en el rol técnico', () => {
    const pairs = report.correspondences.map((item) => [report.model.elements.find((element) => element.key === item.a)!.name, report.model.elements.find((element) => element.key === item.b)!.name].sort().join(' ≈ '))
    expect(pairs).not.toContain('Tarea ≈ TareaController')
    expect(report.correspondences.filter((item) => item.status === 'hypothesis')).toEqual([])
  })

  it('la interpretación global describe la arquitectura y no afirma coherencia total', () => {
    const text = Object.values(report.interpretation).flat().map((item) => item.text).join('\n')
    expect(text).toMatch(/distribución cliente-servidor/)
    expect(text).toMatch(/«Backend» aparece en 3 diagramas/)
    expect(text).toMatch(/no equivale a una arquitectura completamente coherente/)
  })

  it('cada hallazgo es trazable hasta un diagrama de origen', () => {
    const ids = new Set(coherentSet.map((diagram) => diagram.id))
    for (const finding of report.findings) {
      expect(finding.evidence.length).toBeGreaterThan(0)
      for (const evidence of finding.evidence) expect(ids.has(evidence.diagramId)).toBe(true)
      for (const element of finding.elements) expect(ids.has(element.diagramId)).toBe(true)
    }
  })
})

describe('evaluateArchitecture · 2. contradicción estructural', () => {
  const first = code('s1', 'class', 'Dominio', 'class Usuario', 'class Administrador', 'class Tablero', 'class Tarea', 'Administrador --|> Usuario', 'Tablero "1" *-- "*" Tarea')
  const second = code('s2', 'class', 'Persistencia', 'class Usuario', 'class Administrador', 'class Tablero', 'class Tarea', 'Usuario --|> Administrador', 'Tablero "1" *-- "1" Tarea')
  const report = evaluateArchitecture([first, second])

  it('detecta herencia invertida y multiplicidades incompatibles', () => {
    expect(types(report, 'contradiction')).toEqual(expect.arrayContaining(['inheritance-reversed', 'multiplicity-conflict']))
    const multiplicity = report.findings.find((item) => item.type === 'multiplicity-conflict')!
    expect(multiplicity.severity).toBe('high')
    expect(multiplicity.diagrams).toEqual(['s1', 's2'])
    expect(multiplicity.description).toMatch(/0\.\.\* en «Dominio».*1 en «Persistencia»/)
    expect(report.status).toBe('contradictions')
  })

  it('reconoce la multiplicidad coincidente en el otro extremo', () => {
    expect(report.findings.find((item) => item.category === 'coherent' && item.ruleId === 'structure.relations')?.description).toMatch(/coincide \(1\)/)
  })
})

describe('evaluateArchitecture · 3. secuencia vs. clases', () => {
  const discrepant = code('d2-sequence', 'sequence', 'Crear tarea', ...sequenceLines,
    'TableroVista -> TareaController : eliminarTarea(id)',
    'TableroVista -> TareaController : crearTarea(titulo, descripcion)',
    'TareaRepositorio -> TableroVista : refrescar()')

  it('con un diagrama de clases parcial, una operación ausente es omisión y no contradicción', () => {
    const report = evaluateArchitecture([discrepant, classes])
    expect(types(report, 'omission')).toContain('operation-not-declared')
    expect(types(report, 'contradiction')).not.toContain('operation-missing')
    expect(types(report, 'possible')).toContain('arity-mismatch')
  })

  it('con contrato completo declarado, la operación ausente es contradicción confirmada', () => {
    const report = evaluateArchitecture([discrepant, classes], settings({ completeContracts: [classes.id] }))
    const missing = report.findings.find((item) => item.type === 'operation-missing' && /eliminarTarea/.test(item.title))!
    expect(missing.category).toBe('contradiction')
    expect(missing.evidence.map((item) => item.diagramId)).toEqual(['d2-sequence', 'd3-class'])
    expect(missing.validation).toBe('deterministic')
  })

  it('señala la interacción sin relación estructural entre clases', () => {
    const report = evaluateArchitecture([discrepant, classes])
    const finding = report.findings.find((item) => item.type === 'interaction-without-relation')!
    expect(finding.title).toMatch(/TareaRepositorio.*TableroVista/)
  })

  it('detecta un retorno con valor en una operación void', () => {
    const voidCall = code('q1', 'sequence', 'Mostrar', 'participant A', 'participant TableroVista', 'A -> TableroVista : mostrar()', 'TableroVista --> A : html renderizado')
    const report = evaluateArchitecture([voidCall, classes])
    expect(types(report, 'possible')).toContain('void-returns-value')
  })
})

describe('evaluateArchitecture · 4. componentes y despliegue incompatibles', () => {
  const split = code('d5-deployment', 'deployment', 'Despliegue',
    'node Navegador <<device>> {', '  artifact Frontend', '}',
    'node Servidor {', '  artifact Backend', '}',
    'node "Servidor BD" {', '  database "Base de datos" as DB', '}',
    'Navegador -- Servidor : HTTPS')
  const report = evaluateArchitecture([components, split])

  it('una dependencia sin canal físico, cuando el despliegue modela conexiones, es contradicción', () => {
    const finding = report.findings.find((item) => item.type === 'no-communication-path')!
    expect(finding.category).toBe('contradiction')
    expect(finding.description).toMatch(/«Backend».*«Servidor».*«Base de datos».*«Servidor BD»/)
    expect(report.findings.filter((item) => item.type === 'no-communication-path')).toHaveLength(1)
  })

  it('una base de datos en un dispositivo cliente es posible inconsistencia', () => {
    const onDevice = code('dx', 'deployment', 'Móvil', 'node Telefono <<device>> {', '  database "Base de datos"', '  artifact Frontend', '  artifact Backend', '}')
    const result = evaluateArchitecture([components, onDevice])
    expect(types(result, 'possible')).toContain('server-component-on-device')
  })

  it('un componente lógico no se exige en el despliegue', () => {
    const withLibrary = code('d4-component', 'component', 'Componentes', ...componentLines, 'component Utilidades <<library>>', 'Backend --> Utilidades')
    const result = evaluateArchitecture([withLibrary, deployment])
    expect(result.findings.some((item) => item.type === 'component-unplaced')).toBe(false)
    expect(comparison(result, 'cmp-dep').rules.find((rule) => rule.id === 'cmp-dep.placement')!.reason).toMatch(/Utilidades/)
  })
})

describe('evaluateArchitecture · 5. información incompleta sin falsos positivos', () => {
  const sparseClasses = code('c1', 'class', 'Clases', 'class Tablero', 'class Tarea', 'Tablero -- Tarea')
  const narrative = code('q1', 'sequence', 'Ver tablero', 'actor Miembro', 'participant Tablero', 'participant Tarea', 'Miembro -> Tablero : Abre el tablero', 'Tablero -> Tarea : cargar()', 'Tarea --> Tablero : tareas')
  const report = evaluateArchitecture([sparseClasses, narrative])

  it('no convierte la falta de detalle en inconsistencias', () => {
    expect(of(report, 'contradiction')).toEqual([])
    expect(of(report, 'possible')).toEqual([])
    expect(types(report, 'unverifiable')).toContain('class-without-operations')
  })
})

describe('evaluateArchitecture · 6. nombres distintos para el mismo concepto', () => {
  const spanish = code('q1', 'sequence', 'Crear tarea', 'actor Miembro', 'control "Controlador de tareas" as C', 'participant Vista', 'Vista -> C : crearTarea(titulo)')
  const english = code('c1', 'class', 'Clases', 'class TareaController {', '  + crearTarea(titulo: String): Tarea', '}')

  it('propone y usa una equivalencia por términos normalizados, con su evidencia', () => {
    const report = evaluateArchitecture([spanish, english])
    const link = report.correspondences.find((item) => item.basis === 'equivalent-terms')!
    expect(link.status).toBe('auto')
    expect(link.evidence).toMatch(/mismos términos normalizados/)
    expect(report.findings.find((item) => item.ruleId === 'seq-cls.operations' && item.category === 'coherent')).toBeTruthy()
  })

  it('una coincidencia parcial queda como hipótesis hasta que se confirma', () => {
    const cmp = code('k1', 'component', 'Componentes', 'component API', 'database "Base de datos" as DB', 'API --> DB')
    const dep = code('k2', 'deployment', 'Despliegue', 'node Servidor {', '  artifact API', '  database "Base de datos PostgreSQL" as PG', '}')
    const pending = evaluateArchitecture([cmp, dep])
    const hypothesis = pending.correspondences.find((item) => item.status === 'hypothesis')!
    expect(hypothesis.basis).toBe('partial')
    expect(types(pending, 'omission')).toContain('component-unplaced')

    const element = (key: string) => pending.model.elements.find((item) => item.key === key)!
    const confirmed = evaluateArchitecture([cmp, dep], settings({ equivalences: [{ a: stableKey(element(hypothesis.a)), b: stableKey(element(hypothesis.b)), status: 'confirmed' }] }))
    expect(confirmed.correspondences.find((item) => item.status === 'confirmed')).toBeTruthy()
    expect(types(confirmed, 'omission')).not.toContain('component-unplaced')
  })

  it('una equivalencia rechazada separa elementos con el mismo nombre', () => {
    const report = evaluateArchitecture([components, deployment])
    const link = report.correspondences.find((item) => item.status === 'auto' && report.model.elements.find((e) => e.key === item.a)!.name === 'Backend')!
    const element = (key: string) => report.model.elements.find((item) => item.key === key)!
    const rejected = evaluateArchitecture([components, deployment], settings({ equivalences: [{ a: stableKey(element(link.a)), b: stableKey(element(link.b)), status: 'rejected' }] }))
    expect(rejected.correspondences.find((item) => item.a === link.a && item.b === link.b)!.status).toBe('rejected')
    expect(types(rejected, 'omission')).toContain('component-unplaced')
  })

  it('un nombre ambiguo no se fusiona en silencio', () => {
    const seq = code('q1', 'sequence', 'S', 'participant Gestor', 'participant Otro', 'Otro -> Gestor : hacer()')
    const cls = code('c1', 'class', 'C', 'class GestorTareas', 'class Gestor', 'class Manager')
    const report = evaluateArchitecture([seq, cls])
    const ambiguous = report.correspondences.filter((item) => item.ambiguous)
    expect(ambiguous.length).toBe(2)
    expect(ambiguous.every((item) => item.status === 'hypothesis')).toBe(true)
  })
})

describe('evaluateArchitecture · 7. faltan tipos de diagrama', () => {
  const report = evaluateArchitecture([sequence, classes])

  it('evalúa lo que hay y explica qué falta y cómo ampliarlo', () => {
    expect(comparison(report, 'seq-cls').status).toBe('executed')
    for (const id of ['uc-seq', 'cmp-dep', 'cls-cmp', 'seq-cmp', 'uc-cls']) {
      expect(comparison(report, id).status).toBe('skipped')
      expect(comparison(report, id).enable).toBeTruthy()
    }
    expect(comparison(report, 'cmp-dep').reason).toMatch(/componentes/)
    const physical = report.coverage.views.find((view) => view.view === 'physical')!
    expect(physical.diagrams).toEqual([])
    expect(physical.missing).toMatch(/despliegue/)
    expect(report.coverage.suggestions.some((item) => item.startsWith('Componentes ↔ despliegue'))).toBe(true)
  })

  it('sin diagramas el informe es «no evaluable» y no falla', () => {
    const empty = evaluateArchitecture([])
    expect(empty.status).toBe('not-evaluable')
    expect(empty.index.value).toBeNull()
    expect(empty.interpretation.conclusion[0].text).toMatch(/No hay diagramas analizables/)
  })
})

describe('evaluateArchitecture · 8. errores de extracción y baja confianza', () => {
  const junk = Array.from({ length: 12 }, (_, index) => `esto no es plantuml ${index} ???`)
  const noisy = code('d5-deployment', 'deployment', 'Despliegue', 'node Servidor {', '  artifact Backend', '}', 'node "Servidor BD" {', '  database "Base de datos" as DB', '}', 'node Respaldo', 'Servidor -- Respaldo', ...junk)

  it('baja la confianza de la lectura e informa las líneas no interpretadas', () => {
    const report = evaluateArchitecture([components, noisy])
    const diagram = report.model.diagrams.find((item) => item.id === noisy.id)!
    expect(diagram.extraction.confidence).toBeLessThan(0.6)
    expect(diagram.extraction.issues[0]).toMatch(/no se pudieron interpretar/)
  })

  it('una contradicción con lectura incierta se informa como posible inconsistencia', () => {
    const report = evaluateArchitecture([components, noisy])
    const finding = report.findings.find((item) => item.type === 'no-communication-path')!
    expect(finding.category).toBe('possible')
    expect(finding.confidence).toBeLessThan(0.6)
    expect(finding.severity).toBe('high')
    expect(finding.explanation).toMatch(/lectura de algún diagrama es incierta/)
  })

  it('maneja diagramas vacíos, modelos dañados, tipos no analizados y entradas inválidas', () => {
    const broken: DiagramInput = { id: 'x1', name: 'Roto', kind: 'class', mode: 'visual', model: { kind: 'class', nodes: 'no' }, source: '' }
    const empty: DiagramInput = { id: 'x2', name: 'Vacío', kind: 'sequence', mode: 'code', model: null, source: '' }
    const repaired: DiagramInput = { id: 'x3', name: 'Reparado', kind: 'class', mode: 'visual', model: null, source: '@startuml\nclass A\n@enduml' }
    const activity: DiagramInput = { id: 'x4', name: 'Proceso', kind: 'activity', mode: 'code', model: null, source: '@startuml\nstart\nstop\n@enduml' }
    const report = evaluateArchitecture([broken, empty, repaired, activity, null as unknown as DiagramInput])
    const byId = (id: string) => report.model.diagrams.find((item) => item.id === id)!
    expect(byId('x1').extraction.failed).toBe(true)
    expect(byId('x2').extraction.failed).toBe(true)
    expect(byId('x3').extraction.failed).toBe(false)
    expect(byId('x3').extraction.confidence).toBeLessThan(1)
    expect(report.model.ignored.map((item) => item.id)).toEqual(['x4'])
    expect(report.coverage.suggestions.some((item) => item.includes('«Proceso»'))).toBe(true)
    expect(evaluateArchitecture(undefined as unknown as DiagramInput[]).status).toBe('not-evaluable')
  })

  it('sanea una configuración dañada', () => {
    expect(() => evaluateArchitecture(coherentSet, { style: 42, mvc: { forbidden: [{ from: 'x' }] }, exceptions: [{ fingerprint: 1 }] })).not.toThrow()
  })
})

describe('evaluateArchitecture · 9. excepción arquitectónica justificada', () => {
  const split = code('d5-deployment', 'deployment', 'Despliegue', 'node Servidor {', '  artifact Backend', '}', 'node "Servidor BD" {', '  database "Base de datos" as DB', '}', 'node Respaldo', 'Servidor -- Respaldo')
  const base = evaluateArchitecture([components, split])
  const target = base.findings.find((item) => item.type === 'no-communication-path')!

  it('la excepción se conserva visible, deja de contar como contradicción y guarda su justificación', () => {
    const exception = { fingerprint: target.fingerprint, ruleId: target.ruleId, title: target.title, justification: 'La conexión pasa por una VPN gestionada fuera del modelo.' }
    const report = evaluateArchitecture([components, split], settings({ exceptions: [exception] }))
    const finding = report.findings.find((item) => item.fingerprint === target.fingerprint)!
    expect(finding.validation).toBe('exception')
    expect(finding.exception?.justification).toMatch(/VPN/)
    expect(report.index.contradictions).toBe(base.index.contradictions - 1)
    expect(report.findings.at(-1)?.category === 'coherent' || report.findings.indexOf(finding) > report.findings.findIndex((item) => item.category === 'unverifiable')).toBe(true)
  })

  it('la huella del hallazgo no depende de los ids internos de los elementos', () => {
    const reordered = code('d5-deployment', 'deployment', 'Despliegue', 'node Respaldo', 'node "Servidor BD" {', '  database "Base de datos" as DB', '}', 'node Servidor {', '  artifact Backend', '}', 'Servidor -- Respaldo')
    const again = evaluateArchitecture([components, reordered])
    expect(again.findings.find((item) => item.type === 'no-communication-path')!.fingerprint).toBe(target.fingerprint)
  })
})

describe('evaluateArchitecture · MVC declarado', () => {
  const mvcClasses = code('m1', 'class', 'Clases MVC',
    'class TareaVista <<view>> {', '  + mostrar(): void', '}',
    'class TareaController <<controller>> {', '  + crear(): void', '  + renderHtml(): String', '}',
    'class Tarea <<model>>',
    'TareaVista --> TareaController',
    'TareaController --> Tarea',
    'Tarea --> TareaVista')

  it('no evalúa MVC si no está declarado', () => {
    expect(comparison(evaluateArchitecture([mvcClasses]), 'mvc').status).toBe('skipped')
  })

  it('detecta la dependencia prohibida modelo → vista y responsabilidades ajenas en el controlador', () => {
    const report = evaluateArchitecture([mvcClasses], settings({ style: 'mvc' }))
    const forbidden = report.findings.filter((item) => item.type === 'forbidden-dependency')
    expect(forbidden).toHaveLength(1)
    expect(forbidden[0].title).toMatch(/modelo → vista/)
    expect(forbidden[0].category).toBe('contradiction')
    expect(types(report, 'possible')).toContain('controller-foreign-responsibility')
  })

  it('respeta la variante configurada (vista pasiva prohíbe vista → modelo)', () => {
    const viewToModel = code('m2', 'class', 'Clases', 'class TareaVista <<view>>', 'class Tarea <<model>>', 'TareaVista --> Tarea')
    expect(evaluateArchitecture([viewToModel], settings({ style: 'mvc' })).findings.some((item) => item.type === 'forbidden-dependency')).toBe(false)
    const passive = settings({ style: 'mvc' })
    passive.mvc = { ...passive.mvc, variant: 'passive', forbidden: [...passive.mvc.forbidden, { from: 'view', to: 'model' }] }
    expect(evaluateArchitecture([viewToModel], passive).findings.some((item) => item.type === 'forbidden-dependency')).toBe(true)
  })
})

describe('evaluateArchitecture · casos de uso ↔ secuencia', () => {
  it('detecta un actor que no realiza el caso de uso del escenario', () => {
    const uc = code('u1', 'usecase', 'Casos de uso', 'actor Miembro', 'actor Invitado', 'usecase "Crear tarea" as UC1', 'usecase "Ver tablero" as UC2', 'Miembro -- UC1', 'Invitado -- UC2')
    const seq = code('q1', 'sequence', 'Crear tarea', 'actor Invitado', 'participant App', 'Invitado -> App : crear()')
    const report = evaluateArchitecture([uc, seq])
    const finding = report.findings.find((item) => item.type === 'actor-mismatch')!
    expect(finding.category).toBe('possible')
    expect(finding.description).toMatch(/«Invitado».*«Crear tarea»/)
  })

  it('un include que solo ocurre dentro de un fragmento opcional es posible inconsistencia', () => {
    const seq = code('d2-sequence', 'sequence', 'Crear tarea', 'actor Miembro', 'control TareaController', 'Miembro -> TareaController : crearTarea(titulo)', 'opt si es propietario', 'TareaController -> TareaController : validarPermisos(miembro)', 'end')
    const report = evaluateArchitecture([useCases, seq])
    expect(types(report, 'possible')).toContain('include-conditional')
  })
})

describe('evaluateArchitecture · diagramas en modo visual', () => {
  it('lee el modelo del lienzo (contención por posición) con confianza plena', () => {
    const visual = (input: DiagramInput): DiagramInput => ({ ...input, mode: 'visual', source: '', model: parsePlantUml(input.source, input.kind, null).model })
    const report = evaluateArchitecture(coherentSet.map(visual))
    expect(report.model.diagrams.every((diagram) => diagram.extraction.confidence === 1)).toBe(true)
    const artifact = report.model.elements.find((element) => element.diagramId === 'd5-deployment' && element.name === 'Frontend')!
    expect(report.model.elements.find((element) => element.key === artifact.parent)?.name).toBe('Navegador')
    expect(of(report, 'contradiction')).toEqual([])
    expect(report.index.value).toBe(1)
  })
})

describe('evaluateArchitecture · reproducibilidad', () => {
  it('las mismas entradas y reglas producen el mismo informe, sin importar el orden de los diagramas', () => {
    const first = evaluateArchitecture(coherentSet)
    const second = evaluateArchitecture([...coherentSet].reverse())
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})

describe('reportToMarkdown · 10. informe a partir de hallazgos reales', () => {
  const discrepant = code('d2-sequence', 'sequence', 'Crear tarea', ...sequenceLines, 'TableroVista -> TareaController : eliminarTarea(id)')
  const report = evaluateArchitecture([useCases, discrepant, classes, components, deployment], settings({ completeContracts: [classes.id] }))
  const markdown = reportToMarkdown(report, 'Gesti')

  it('incluye estado, fórmula del índice, cobertura y cada hallazgo con su evidencia', () => {
    const missing = report.findings.find((item) => item.type === 'operation-missing')!
    expect(markdown).toMatch(/^# Coherencia arquitectónica · Gesti/)
    expect(markdown).toContain(`**Estado:** ${report.statusLabel}`)
    expect(markdown).toMatch(/coherentes \/ \(coherentes \+ contradicciones \+ posibles inconsistencias\)/)
    expect(markdown).toContain(`### ${missing.id} · ${missing.title}`)
    expect(markdown).toContain('_Crear tarea_:')
    expect(markdown).toMatch(/\| Componentes ↔ despliegue \| Ejecutada \|/)
    expect(markdown).toMatch(/\| Estructura entre diagramas \(clases, MER\) \| Omitida \|/)
    for (const finding of report.findings) expect(markdown).toContain(finding.id)
  })
})

describe('correspondencias · texto entre paréntesis', () => {
  const names = (report: ArchitectureReport, status: string) =>
    report.correspondences.filter((item) => item.status === status).map((item) => [item.a, item.b].map((key) => report.model.elements.find((element) => element.key === key)!.name).join(' ≈ '))

  it('el detalle entre paréntesis no impide reconocer el mismo elemento ni genera parecidos falsos', () => {
    const cmp = code('k1', 'component', 'Componentes', 'component "Alert Controller" as a', 'component "Transaction Controller (ventas y compras)" as t', 'component "Auth Controller (JWT)" as u', 'a --> t')
    const seq = code('q1', 'sequence', 'S', 'participant "AlertController (Express)" as a', 'participant "TransactionController (Express)" as t', 'participant "AuthController (Express)" as u', 'a -> t : x()', 't -> u : y()')
    const report = evaluateArchitecture([cmp, seq])
    expect(names(report, 'auto')).toEqual(['Alert Controller ≈ AlertController (Express)'])
    const pending = names(report, 'hypothesis')
    expect(pending).toEqual(expect.arrayContaining(['Transaction Controller (ventas y compras) ≈ TransactionController (Express)', 'Auth Controller (JWT) ≈ AuthController (Express)']))
    expect(pending.some((pair) => pair.includes('Alert') && pair.includes('Transaction'))).toBe(false)
  })
})

describe('falsos positivos entre vistas lógica y física', () => {
  it('tipos lógicos y físicos de la misma familia son compatibles; los comentarios en línea no son parte del tipo', () => {
    const cls = code('c1', 'class', 'Clases', 'class Producto {', '  - nombre: String', '  - stock: double', '  - activo: boolean', '  - creado: Date', '}')
    const er = code('e1', 'er', 'MER', 'entity "PRODUCTOS" as p {', '  * id : bigint <<PK>>', '  --', "  * nombre : varchar(120) ' nombre comercial", '  * stock : numeric(10,2)', '  * activo : varchar(5)', '  * creado : timestamptz', '}')
    const conflicts = evaluateArchitecture([cls, er]).findings.filter((item) => item.type === 'attribute-type-conflict')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].title).toMatch(/activo/)
    expect(conflicts[0].description).toBe('«boolean» en «Clases» y «varchar(5)» en «MER»')
  })

  it('las relaciones entre tablas no exigen dependencias entre componentes y depender de la base cubre sus tablas', () => {
    const cls = code('c1', 'class', 'Clases', 'class MotorService', 'class Producto', 'class Venta', 'Venta --> Producto', 'MotorService --> Producto')
    const cmp = code('k1', 'component', 'Componentes', 'component MotorService as m', 'package "Base de datos" as bd {', '  component "VENTAS" as v', '  component "PRODUCTOS" as p', '}', 'm --> bd')
    const report = evaluateArchitecture([cls, cmp])
    expect(types(report)).not.toContain('dependency-undeclared')
    expect(types(report)).not.toContain('dependency-reversed')
  })
})

describe('casos de uso citados por código', () => {
  const uc = code('u1', 'usecase', 'Casos de uso', 'actor Dueno', 'usecase "CU-03: Consultar Dashboard" as CU03', 'usecase "CU-09: Evaluar Semáforo (riesgo)" as CU09', 'usecase "CU-04: Gestionar Catálogo" as CU04', 'Dueno -- CU03', 'Dueno -- CU04', 'CU03 ..> CU09 : <<include>>')
  const seq = code('q1', 'sequence', 'Secuencia 1', 'title Secuencia 1: Consulta (CU-03, CU-09)', 'actor Dueno', 'participant App', 'Dueno -> App : abrir()', 'App -> App : calcular colores')
  const report = evaluateArchitecture([uc, seq])

  it('enlaza el escenario con todos los casos que cita su título, sin ambigüedad', () => {
    expect(types(report)).not.toContain('scenario-without-usecase')
    expect(types(report)).not.toContain('scenario-ambiguous')
    const without = report.findings.find((item) => item.type === 'usecase-without-scenario')!
    expect(without.title).toMatch(/^1 caso/)
    expect(without.description).toContain('CU-04')
  })

  it('un caso incluido que el mismo escenario realiza cuenta como mostrado', () => {
    expect(types(report)).not.toContain('include-not-shown')
  })
})

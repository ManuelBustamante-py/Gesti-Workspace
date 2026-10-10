import { describe, expect, it } from 'vitest'

import { UML_DIAGRAM_TYPES } from '../umlCatalog'
import { initialModel } from './examples'
import { generatePlantUml } from './generatePlantUml'
import { interpretModel } from './interpret'
import { explainRegex, ganttSchedule } from './interpretStructured'
import { parsePlantUml } from './parsePlantUml'
import { STRUCTURED_KINDS, type GanttModel, type MindmapModel, type NetworkModel, type TimingModel, type WireframeModel } from './structured'

const template = (kind: string) => UML_DIAGRAM_TYPES.find((type) => type.id === kind)!.template

describe('tipos estructurados · ida y vuelta', () => {
  it('cada plantilla se lee como modelo y se regenera de forma estable', () => {
    for (const kind of STRUCTURED_KINDS) {
      const first = parsePlantUml(template(kind), kind).model
      const source = generatePlantUml(first)
      const second = parsePlantUml(source, kind).model
      expect(generatePlantUml(second), kind).toBe(source)
    }
  })

  it('mapa mental: lados, niveles y textos de varias líneas', () => {
    const model = parsePlantUml(template('mindmap'), 'mindmap').model as MindmapModel
    expect(model.root.text).toBe('Proyecto')
    expect(model.root.children.map((child) => [child.text, child.side])).toEqual([['Alcance', 'right'], ['Equipo', 'right'], ['Riesgos', 'left'], ['Calidad', 'left']])
    const multi = parsePlantUml('@startmindmap\n* Centro\n**:Línea 1\nLínea 2;\n@endmindmap', 'mindmap').model as MindmapModel
    expect(multi.root.children[0].text).toBe('Línea 1\nLínea 2')
    expect(generatePlantUml(multi)).toContain('**:Línea 1\nLínea 2;')
  })

  it('Gantt: duraciones, dependencias, hitos, avance y días no hábiles', () => {
    const model = parsePlantUml(template('gantt'), 'gantt').model as GanttModel
    expect(model.projectStart).toBe('2026-11-02')
    expect(model.closed.sort()).toEqual([0, 6])
    expect(model.tasks.map((task) => [task.name, task.duration, task.start.type, task.milestone ?? false])).toEqual([
      ['Levantamiento', 5, 'project', false], ['Diseño', 8, 'after', false], ['Desarrollo', 15, 'after', false], ['Pruebas', 5, 'after', false], ['Entrega', 0, 'after', true],
    ])
    const { dates } = ganttSchedule(model)
    // Lunes 2 nov + 5 días hábiles → viernes 6; Diseño parte el lunes 9.
    expect(dates.get(model.tasks[0].id)).toEqual({ start: '2026-11-02', end: '2026-11-06' })
    expect(dates.get(model.tasks[1].id)!.start).toBe('2026-11-09')
  })

  it('red: segmentos, equipos en varias redes y direcciones', () => {
    const model = parsePlantUml(template('network'), 'network').model as NetworkModel
    expect(model.networks.map((network) => [network.name, network.address])).toEqual([['dmz', '210.x.x.x/24'], ['interna', '172.16.0.0/24']])
    const web01 = model.hosts.find((host) => host.name === 'web01')!
    expect(web01.links).toHaveLength(2)
  })

  it('tiempos: participantes, instantes y estados', () => {
    const model = parsePlantUml(template('timing'), 'timing').model as TimingModel
    expect(model.participants.map((participant) => [participant.type, participant.name])).toEqual([['robust', 'Servidor'], ['concise', 'Usuario']])
    expect(model.events.filter((event) => event.time === 300).map((event) => event.state)).toEqual(['Respondiendo'])
  })

  it('wireframe: celdas de Salt a controles y de vuelta', () => {
    const model = parsePlantUml(template('wireframe'), 'wireframe').model as WireframeModel
    expect(model.frame).toBe('window')
    expect(model.rows.map((row) => row.cells.map((cell) => cell.type))).toEqual([
      ['title'], ['text', 'input'], ['text', 'password'], ['checkbox'], ['button', 'button'],
    ])
    expect(model.rows[3].cells[0]).toMatchObject({ label: 'Recordarme', checked: true })
    expect(generatePlantUml(model)).toContain('[Cancelar] | [Ingresar]')
  })

  it('todos los tipos estructurados tienen un ejemplo inicial', () => {
    for (const kind of STRUCTURED_KINDS) expect(generatePlantUml(initialModel(kind, true)).length, kind).toBeGreaterThan(30)
  })
})

describe('tipos estructurados · interpretación', () => {
  it('Gantt: fecha de término, cadena crítica y nombres repetidos', () => {
    const model = parsePlantUml(template('gantt'), 'gantt').model as GanttModel
    const result = interpretModel(model)
    expect(result.summary[0]).toContain('2 de noviembre de 2026')
    expect(result.summary.some((line) => line.startsWith('Cadena que define la fecha de término'))).toBe(true)
    const duplicated = interpretModel({ ...model, tasks: [...model.tasks, { ...model.tasks[0], id: 'n99' }] })
    expect(duplicated.findings.some((finding) => finding.text.includes('repetida'))).toBe(true)
  })

  it('red: direcciones fuera de la subred y duplicadas', () => {
    const model: NetworkModel = {
      kind: 'network', version: 1,
      networks: [{ id: 'p1', name: 'lan', address: '192.168.1.0/24' }],
      hosts: [
        { id: 'n1', name: 'a', links: [{ network: 'p1', address: '192.168.1.10' }] },
        { id: 'n2', name: 'b', links: [{ network: 'p1', address: '192.168.1.10' }] },
        { id: 'n3', name: 'c', links: [{ network: 'p1', address: '10.0.0.5' }] },
      ],
    }
    const texts = interpretModel(model).findings.map((finding) => finding.text)
    expect(texts.some((text) => text.includes('misma dirección 192.168.1.10'))).toBe(true)
    expect(texts.some((text) => text.includes('10.0.0.5, que no pertenece'))).toBe(true)
  })

  it('wireframe: campos sin botón para enviar y botones genéricos', () => {
    const model: WireframeModel = { kind: 'wireframe', version: 1, frame: 'plain', rows: [{ id: 'm1', cells: [{ id: 'n1', type: 'input', label: '' }] }] }
    expect(interpretModel(model).findings.some((finding) => finding.text.includes('no tiene ningún botón'))).toBe(true)
  })

  it('expresiones regulares: explica cada pieza y advierte riesgos', () => {
    const result = explainRegex('@startregex\n^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$\n@endregex')
    expect(result.summary).toContain('• inicio del texto')
    expect(result.summary.some((line) => line.includes('el carácter «@»') || line.includes('el texto «@»'))).toBe(true)
    expect(result.summary.some((line) => line.includes('2 o más veces'))).toBe(true)
    expect(explainRegex('(a+)+b').findings.some((finding) => finding.text.includes('retroceso catastrófico'))).toBe(true)
    expect(explainRegex('([a-z').findings.some((finding) => finding.text.includes('no es válida'))).toBe(true)
  })
})

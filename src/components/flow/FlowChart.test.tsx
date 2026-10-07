import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import FlowChart from './FlowChart'
import { computeForecast, type FlowPoint } from '../../domain/cfd'
import { addDays } from '../../domain/dates'

describe('FlowChart', () => {
  it('dibuja bandas, proyección y fin del Gantt sin valores inválidos', () => {
    const points: FlowPoint[] = Array.from({ length: 29 }, (_, index) => {
      const done = Math.floor(index / 2)
      const completed = index === 0 ? 0 : done - Math.floor((index - 1) / 2)
      return { day: addDays('2026-09-08', index), todo: 18 - done, in_progress: 2, done, total: 20, completed }
    })
    const forecast = computeForecast(points, '2026-10-10')!
    const html = renderToStaticMarkup(<FlowChart points={points} forecast={forecast} width={900} narrow={false} />)

    expect(html).not.toContain('NaN')
    expect(html.match(/class="flow-band /g)).toHaveLength(3)
    expect(html).toContain('flow-projection')
    expect(html).toContain('Fin Gantt')
    expect(html).toContain('Proyección ·')
  })
})

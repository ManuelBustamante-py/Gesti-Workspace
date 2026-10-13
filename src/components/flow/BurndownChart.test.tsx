import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import BurndownChart from './BurndownChart'
import { buildBurndown } from '../../domain/burndown'
import { computeForecast, type FlowPoint } from '../../domain/cfd'
import { addDays } from '../../domain/dates'

describe('BurndownChart', () => {
  it('dibuja real, ideal, proyección y alcance añadido sin valores inválidos', () => {
    const points: FlowPoint[] = Array.from({ length: 15 }, (_, index) => {
      const done = index * 3
      const total = index >= 6 ? 105 : 100
      return { day: addDays('2026-09-28', index), todo: total - done, in_progress: 0, done, total, completed: index === 0 ? 0 : 3 }
    })
    const forecast = computeForecast(points, '2026-10-30')!
    const burndown = buildBurndown(points, { start: points[0].day, deadline: '2026-10-30', workingDays: [2, 3, 4, 5, 6] })
    const html = renderToStaticMarkup(
      <BurndownChart burndown={burndown} forecast={forecast} width={900} narrow={false} unit="pts" workingDays={[2, 3, 4, 5, 6]} />,
    )

    expect(html).not.toContain('NaN')
    expect(html).toContain('burndown-actual')
    expect(html).toContain('burndown-ideal')
    expect(html).toContain('burndown-projection')
    expect(html.match(/burndown-scope-mark/g)).toHaveLength(1)
    expect(html).toContain('burndown-offday')
    expect(html).toContain('Restante (pts)')
  })
})

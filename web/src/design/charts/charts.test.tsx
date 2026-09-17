import { render, screen } from '@testing-library/react'
import { Bars } from './Bars'
import { Line } from './Line'

test('bars expose a text summary, one value label per bar and a hatched legend for unverified', () => {
  render(<Bars title="Reach time" unit="s" values={[1.2, 0.9, null]} verified={[true, false, true]} labels={['1', '2', '3']} />)
  const img = screen.getByRole('img')
  expect(img.getAttribute('aria-label')).toMatch(/2 0.9 s unverified/)
  expect(screen.getByText('1.2')).toBeInTheDocument()
  expect(screen.getByText('0.9')).toBeInTheDocument()
  expect(screen.getByText(/unverified \(hatched\)/)).toBeInTheDocument()
})

test('line chart labels every point and states the trend in words', () => {
  render(<Line title="Nine-Hole Peg Test" unit="s" points={[{ x: '1 Aug', y: 48.1 }, { x: '12 Sep', y: 41.2 }]} target={35} />)
  expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/12 Sep 41.2 s, target 35 s/)
  expect(screen.getByText('41.2')).toBeInTheDocument()
  expect(screen.getByText(/6.9 s better/)).toBeInTheDocument()
})

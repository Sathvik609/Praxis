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

test('bars with a noun say "1 reach" and "3 reaches" in the summary', () => {
  render(<Bars title="Waiter – cup" unit="reaches" noun="reach" values={[1, 3]} labels={['09-10', '09-12']} />)
  const label = screen.getByRole('img').getAttribute('aria-label')
  expect(label).toMatch(/09-10 1 reach, 09-12 3 reaches/)
  expect(label).not.toMatch(/1 reaches/)
})

test('line chart with compare off states no change (mixed sample and real points)', () => {
  render(<Line title="Nine-Hole Peg Test" unit="s" compare={false} note="Includes sample points" points={[{ x: '08-01', y: 68 }, { x: '09-23', y: 38.5 }]} />)
  expect(screen.queryByText(/better than the first point/)).not.toBeInTheDocument()
  expect(screen.getByText(/Includes sample points/)).toBeInTheDocument()
})

test('bars axis reaches the tallest value even when it is not a multiple of the tick step', () => {
  render(<Bars title="Peak angle" unit="°" values={[91, 88]} target={90} />)
  const texts = [...document.querySelectorAll('text')].map((t) => t.textContent)
  expect(texts).toContain('100') // top tick above 91
  expect(texts).toContain('91')
})

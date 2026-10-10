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

// 10 Oct bug: the charts drew into a 320-unit viewBox at `w-full h-auto`, so on a 1200 px report
// card every label rendered ~40 px tall and the bars grew taller than the window. Charts now have a
// fixed pixel height and their viewBox follows the measured width, so 1 unit is 1 CSS px.
function stubResizeObserver(width: number) {
  const orig = globalThis.ResizeObserver
  class RO {
    cb: ResizeObserverCallback
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb
    }
    observe(el: Element) {
      this.cb([{ target: el, contentRect: { width, height: 0 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver
  return () => {
    globalThis.ResizeObserver = orig
  }
}

test.each([
  ['bars', () => <Bars title="Peg split" unit="s" values={[2.1, 1.8, 1.9]} labels={['Peg 1', 'Peg 2', 'Peg 3']} />],
  ['line', () => <Line title="NHPT" unit="s" points={[{ x: '1 Aug', y: 48.1 }, { x: '12 Sep', y: 41.2 }]} />],
])('%s chart keeps a fixed pixel height and 12 px text however wide its card is', (_, make) => {
  const restore = stubResizeObserver(1200)
  try {
    render(make())
    const svg = screen.getByRole('img')
    expect(svg.getAttribute('height')).toBe('160')
    expect(svg.getAttribute('width')).toBe('100%')
    expect(svg.getAttribute('class') ?? '').not.toMatch(/h-auto/)
    // the viewBox is the measured width, so nothing is scaled up
    expect(svg.getAttribute('viewBox')).toBe('0 0 1200 160')
    const sizes = new Set([...svg.querySelectorAll('text')].map((t) => t.getAttribute('font-size')))
    expect([...sizes]).toEqual(['12'])
  } finally {
    restore()
  }
})

test('a chart never grows past a modest height', () => {
  render(<Bars title="Peg split" unit="s" values={[2.1]} height={400} />)
  expect(Number(screen.getByRole('img').getAttribute('height'))).toBeLessThanOrEqual(180)
})

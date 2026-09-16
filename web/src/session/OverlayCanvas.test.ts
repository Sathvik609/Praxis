import { drawOverlay } from './OverlayCanvas'

function fakeCtx(calls: string[]) {
  return new Proxy(
    {},
    {
      get: (_, k) => {
        if (k === 'canvas') return { width: 640, height: 480 }
        return (...a: unknown[]) => {
          calls.push(String(k))
          return a
        }
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D
}

const quad = (x: number, y: number) => [
  [x, y],
  [x + 10, y],
  [x + 10, y + 10],
  [x, y + 10],
]

test('drawOverlay strokes one path per marker, the sheet quad, and one arc per target', () => {
  const calls: string[] = []
  drawOverlay(fakeCtx(calls), {
    type: 'calibration',
    t: 0,
    id: 1,
    calibrated: true,
    missing: [],
    markers_px: { '0': quad(0, 0), '1': quad(100, 0), '2': quad(100, 100), '3': quad(0, 100) },
    targets_px: [
      [5, 5],
      [6, 6],
    ],
  })
  expect(calls.filter((c) => c === 'stroke').length).toBe(5 + 2)
  expect(calls.filter((c) => c === 'arc').length).toBe(2)
})

test('drawOverlay with null only clears', () => {
  const calls: string[] = []
  drawOverlay(fakeCtx(calls), null)
  expect(calls).toEqual(['clearRect'])
})

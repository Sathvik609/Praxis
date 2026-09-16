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

test('drawFrameOverlay fills occupied holes and rings the next one', async () => {
  const { drawFrameOverlay } = await import('./OverlayCanvas')
  const calls: string[] = []
  drawFrameOverlay(fakeCtx(calls), {
    type: 'frame', t: 0, id: 1, calibrated: true, missing: [],
    nhpt: { mode: 'nhpt', state: 'at_source', target: null, reps: 0, finished: false, started: false, completed: false, pegs_done: 1, elapsed_s: 0, total_s: null },
    board: { occupancy: { hole_0: 'occupied', hole_1: 'empty' } },
    overlay: { holes_px: [[1, 1], [2, 2]], target: null, next_hole: 1, markers_px: {} },
  })
  expect(calls.filter((c) => c === 'arc').length).toBe(2)
  expect(calls.filter((c) => c === 'fill').length).toBe(1)
  expect(calls.filter((c) => c === 'stroke').length).toBe(2)
})

test('drawHand draws 20 connections and 21 points', async () => {
  const { drawHand } = await import('./OverlayCanvas')
  const calls: string[] = []
  drawHand(fakeCtx(calls), Array.from({ length: 21 }, (_, i) => [i, i]))
  expect(calls.filter((c) => c === 'stroke').length).toBe(21)
  expect(calls.filter((c) => c === 'arc').length).toBe(21)
  expect(calls.filter((c) => c === 'fill').length).toBe(21)
})

import { drawFrameOverlay, drawHand, drawOverlay, holeStyle, smoothCorners, type FrameEvent } from './OverlayCanvas'

type Rec = { calls: string[]; sets: Record<string, unknown[]> }

function fakeCtx(rec: Rec) {
  return new Proxy(
    {},
    {
      get: (_, k) => {
        if (k === 'canvas') return { width: 640, height: 480 }
        return (...a: unknown[]) => {
          rec.calls.push(String(k))
          if (k === 'createRadialGradient' || k === 'createLinearGradient') return { addColorStop: () => {} }
          return a
        }
      },
      set: (_, k, v) => {
        ;(rec.sets[String(k)] ??= []).push(v)
        return true
      },
    },
  ) as unknown as CanvasRenderingContext2D
}

const rec = (): Rec => ({ calls: [], sets: {} })
const count = (r: Rec, name: string) => r.calls.filter((c) => c === name).length

const quad = (x: number, y: number) => [
  [x, y],
  [x + 10, y],
  [x + 10, y + 10],
  [x, y + 10],
]

const baseFrame = (over: Partial<FrameEvent>): FrameEvent => ({
  type: 'frame', t: 0, id: 1, calibrated: true, missing: [],
  board: {},
  overlay: { markers_px: {} },
  ...over,
})

test('drawOverlay strokes one bracket path per marker, the sheet quad, and one arc per target', () => {
  const r = rec()
  drawOverlay(fakeCtx(r), {
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
  expect(count(r, 'stroke')).toBe(5 + 2)
  expect(count(r, 'arc')).toBe(2)
})

test('drawOverlay with null only clears', () => {
  const r = rec()
  drawOverlay(fakeCtx(r), null)
  expect(r.calls).toEqual(['clearRect'])
})

test('drawFrameOverlay with null draws nothing (only clears)', () => {
  const r = rec()
  drawFrameOverlay(fakeCtx(r), null)
  expect(r.calls).toEqual(['clearRect'])
})

test('markers are drawn as rounded brackets: one path with four corner strokes, not a closed square', () => {
  const r = rec()
  drawFrameOverlay(fakeCtx(r), baseFrame({ overlay: { markers_px: { '0': quad(20, 20) } } }))
  expect(count(r, 'stroke')).toBe(1)
  expect(count(r, 'closePath')).toBe(0)
  expect(count(r, 'moveTo')).toBe(4)
  expect(r.sets.lineJoin).toContain('round')
})

test('holeStyle: occupied wins, then the target, else empty', () => {
  const occ = { hole_0: 'occupied', hole_1: 'empty' } as const
  expect(holeStyle(0, occ, 0)).toBe('occupied')
  expect(holeStyle(1, occ, 1)).toBe('target')
  expect(holeStyle(1, occ, 2)).toBe('empty')
  expect(holeStyle(2, {}, null)).toBe('empty')
})

test('drawFrameOverlay fills occupied holes, outlines empty ones, glows the target and numbers every hole', () => {
  const r = rec()
  drawFrameOverlay(
    fakeCtx(r),
    baseFrame({
      nhpt: { mode: 'nhpt', state: 'at_source', target: null, reps: 0, finished: false, started: false, completed: false, pegs_done: 1, elapsed_s: 0, total_s: null },
      board: { occupancy: { hole_0: 'occupied', hole_1: 'empty', hole_2: 'empty' } },
      overlay: { holes_px: [[1, 1], [2, 2], [3, 3]], target: null, next_hole: 1, markers_px: {} },
    }),
  )
  // occupied disc (1 fill) + empty outline (1 stroke) + target: glow ring + outline (2 strokes)
  expect(count(r, 'fill')).toBe(1)
  expect(count(r, 'stroke')).toBe(3)
  expect(count(r, 'fillText')).toBe(3)
  expect(r.sets.shadowBlur?.some((v) => Number(v) > 0)).toBe(true)
})

test('hole numbers are un-mirrored when the canvas is mirrored', () => {
  const r = rec()
  drawFrameOverlay(fakeCtx(r), baseFrame({ overlay: { holes_px: [[1, 1]], next_hole: null, markers_px: {} } }), { mirrored: true })
  expect(count(r, 'scale')).toBe(1)
  expect(count(r, 'save')).toBe(count(r, 'restore'))
  const r2 = rec()
  drawFrameOverlay(fakeCtx(r2), baseFrame({ overlay: { holes_px: [[1, 1]], next_hole: null, markers_px: {} } }), { mirrored: false })
  expect(count(r2, 'scale')).toBe(0)
})

test('cup: soft amber disc when tracked plus the five target dots, expected dot glows', () => {
  const r = rec()
  drawFrameOverlay(
    fakeCtx(r),
    baseFrame({
      cup: { mode: 'cup', state: 'in_transit', dot: 1, phase: 'slow', arcs_done: 0, arc_index: 1, arcs_planned: { slow: 2, fast: 2 }, expected_next: 2, dots_in_arc: [0, 1], reaches_total: 1, unverified_total: 0, awaiting_phase: false, finished: false },
      overlay: { dots_px: [[10, 10], [20, 10], [30, 10], [40, 10], [50, 10]], cup_px: [25, 25], expected_next: 2, markers_px: {} },
    }),
  )
  // 5 dots + glow ring on the expected dot + cup disc = 7 arcs
  expect(count(r, 'arc')).toBe(7)
  expect(count(r, 'fillText')).toBe(5)
  expect(count(r, 'createRadialGradient')).toBe(1)
  const r2 = rec()
  drawFrameOverlay(fakeCtx(r2), baseFrame({ overlay: { dots_px: [[10, 10]], cup_px: null, markers_px: {} } }))
  expect(count(r2, 'createRadialGradient')).toBe(0)
})

test('arm: translucent limb to the target, dashed amber guide, skeleton with joints', () => {
  const r = rec()
  drawFrameOverlay(
    fakeCtx(r),
    baseFrame({
      overlay: { skeleton_px: [[[0, 0], [10, 10]], [[10, 10], [20, 0]]], shoulder_px: [100, 100], ghost_target_px: [200, 100], markers_px: {} },
    }),
  )
  expect(count(r, 'setLineDash')).toBe(2)
  expect(r.sets.lineCap).toContain('round')
  // ghost limb (1) + dashed guide (1) + target ring (1) + 2 skeleton bones = 5 strokes
  expect(count(r, 'stroke')).toBe(5)
  // joints: one filled dot per bone end (2 bones → 4 dots)
  expect(count(r, 'fill')).toBe(4)
})

test('drawHand draws 20 connections and 21 points', () => {
  const r = rec()
  drawHand(fakeCtx(r), Array.from({ length: 21 }, (_, i) => [i, i]))
  expect(count(r, 'stroke')).toBe(21)
  expect(count(r, 'arc')).toBe(21)
  expect(count(r, 'fill')).toBe(21)
})

test('smoothCorners: exponential filter α 0.35 per corner, new ids snap, missing ids drop', () => {
  const prev = { '0': quad(0, 0) }
  const next = { '0': quad(10, 10), '1': quad(50, 50) }
  const out = smoothCorners(prev, next, 0.35)
  expect(out['0'][0][0]).toBeCloseTo(3.5)
  expect(out['0'][2][1]).toBeCloseTo(10 + 3.5)
  expect(out['1']).toEqual(quad(50, 50))
  expect(Object.keys(smoothCorners(out, { '1': quad(50, 50) }, 0.35))).toEqual(['1'])
  expect(smoothCorners(null, next, 0.35)).toEqual(next)
})

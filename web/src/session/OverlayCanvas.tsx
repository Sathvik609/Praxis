import { useCallback, useEffect, useRef } from 'react'
import type { PraxisEvent } from '../lib/events'

export type CalibrationEvent = PraxisEvent & {
  calibrated: boolean
  missing: number[]
  rms_mm?: number | null
  markers_px?: Record<string, number[][]>
  targets_px?: number[][]
}

export type CupSnapshot = {
  mode: 'cup'
  state: string
  dot: number | null
  phase: 'slow' | 'fast'
  arcs_done: number
  arc_index: number
  arcs_planned: { slow: number; fast: number }
  expected_next: number | null
  dots_in_arc: number[]
  reaches_total: number
  unverified_total: number
  awaiting_phase: boolean
  finished: boolean
}

export type ArmSnapshot = {
  mode: 'arm'
  state: string
  set: number
  rep: number
  sets: number
  reps_per_set: number
  target_deg: number
  ceiling_deg: number
  clamped: boolean
  hold_s: number
  hold_progress: number
  angle_now: number | null
  peak_this_rep: number
  best_this_set: number
  trunk_lean_deg: number
  reps_total: number
  unverified_total: number
  flags: { lean: boolean; lean_count: number; hike_count: number }
  finished: boolean
  /** Registry id the service is scoring (pendulum | flexion | abduction), its rep shape, the
   *  camera view it needs and the pain tier applied to the dose. */
  exercise?: string
  kind?: 'hold' | 'oscillation'
  view_required?: 'side' | 'front'
  tier?: 'full' | 'gentle'
  gate?: string | null
  /** 0..1 through the current rep (lift 0–0.4, hold 0.4–0.8, lower 0.8–1); paces the avatar. */
  rep_progress?: number
}

export type FrameEvent = PraxisEvent & {
  calibrated: boolean
  missing: number[]
  nhpt?: {
    mode: string
    state: string
    target: number | null
    reps: number
    finished: boolean
    started: boolean
    completed: boolean
    pegs_done: number
    elapsed_s: number
    total_s: number | null
  }
  board: {
    occupancy?: Record<string, 'empty' | 'occupied'>
    hole_source?: string
    free_pegs_mm?: number[][]
    /** Sampled peg colour window (tap-to-sample), null until the patient samples one. */
    colour?: { h: number; s: number; v: number; source: string; skin_excluded: boolean } | null
  }
  overlay: {
    holes_px?: number[][]
    target?: number | null
    next_hole?: number | null
    dots_px?: number[][]
    cup_px?: number[] | null
    expected_next?: number | null
    skeleton_px?: number[][][]
    shoulder_px?: number[] | null
    ghost_target_px?: number[] | null
    markers_px: Record<string, number[][]>
  }
  arm?: ArmSnapshot & { angles?: { shoulder_deg: number; elbow_deg: number; trunk_lean_deg: number; shoulder_hike_norm: number; view_ok: boolean; visibility: number } }
  pose?: { present: boolean; landmarks_px?: number[][]; visibility?: number[]; conf?: number; ms?: number }
  cup?: CupSnapshot & { cup_mm?: number[] | null; hand_clear?: boolean }
  hand?: { present: boolean; landmarks_px?: number[][]; pinch_rel_mm?: number | null; tremor_hz?: number | null; sparc?: number | null; ms?: number }
  models?: { hand: boolean }
  proc_ms?: number
}

/** 21-point MediaPipe hand topology. */
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
]

// Overlay colours are fixed: they sit on the camera image, not on a themed surface.
const MINT = '#2FA985'
const AMBER = '#F2B457'
const AMBER_SOFT = 'rgba(242, 180, 87, 0.30)'
const TEAL_GHOST = 'rgba(31, 95, 91, 0.45)'
const INK = '#0B1A1C'
const WHITE = '#FFFFFF'
const WHITE_SOFT = 'rgba(255, 255, 255, 0.75)'

/** Marker-corner smoothing (exponential, α = 0.35): removes the frame-to-frame jitter of the
 *  ArUco quads. New ids snap to their first position; ids that vanish are dropped. */
export function smoothCorners(
  prev: Record<string, number[][]> | null,
  next: Record<string, number[][]>,
  alpha = 0.35,
): Record<string, number[][]> {
  const out: Record<string, number[][]> = {}
  for (const [id, quad] of Object.entries(next)) {
    const p = prev?.[id]
    out[id] = p && p.length === quad.length ? quad.map(([x, y], i) => [p[i][0] + alpha * (x - p[i][0]), p[i][1] + alpha * (y - p[i][1])]) : quad
  }
  return out
}

export type HoleStyle = 'occupied' | 'target' | 'empty'

/** Hole rendering state from the occupancy map and the suggested next hole. */
export function holeStyle(k: number, occupancy: Record<string, 'empty' | 'occupied'> | undefined, nextHole: number | null | undefined): HoleStyle {
  if (occupancy?.[`hole_${k}`] === 'occupied') return 'occupied'
  if (nextHole === k) return 'target'
  return 'empty'
}

type DrawOpts = { mirrored?: boolean }

/** A label that reads correctly even when the canvas is CSS-mirrored to match the video. */
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string, size: number, mirrored: boolean) {
  ctx.save()
  ctx.font = `700 ${size}px Carlito, Calibri, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = colour
  ctx.shadowBlur = 0
  ctx.translate(x, y)
  if (mirrored) ctx.scale(-1, 1)
  ctx.fillText(text, 0, 1)
  ctx.restore()
}

/** ArUco marker as four rounded corner brackets (one path, one stroke): the marker itself is
 *  printed, so the overlay only needs to say "seen here". */
function drawBracket(ctx: CanvasRenderingContext2D, quad: number[][]) {
  const n = quad.length
  if (n < 3) return
  ctx.save()
  ctx.strokeStyle = MINT
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  const leg = 0.32
  for (let i = 0; i < n; i++) {
    const c = quad[i]
    const prev = quad[(i - 1 + n) % n]
    const next = quad[(i + 1) % n]
    ctx.moveTo(c[0] + (prev[0] - c[0]) * leg, c[1] + (prev[1] - c[1]) * leg)
    ctx.lineTo(c[0], c[1])
    ctx.lineTo(c[0] + (next[0] - c[0]) * leg, c[1] + (next[1] - c[1]) * leg)
  }
  ctx.stroke()
  ctx.restore()
}

function glowRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save()
  ctx.strokeStyle = AMBER
  ctx.lineWidth = 4
  ctx.shadowColor = AMBER
  ctx.shadowBlur = 14
  ctx.beginPath()
  ctx.arc(x, y, r + 4, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/** Light hand skeleton: thin translucent bones, 3 px white joints. */
export function drawHand(ctx: CanvasRenderingContext2D, landmarks: number[][]) {
  ctx.save()
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(127, 224, 196, 0.8)'
  for (const [a, b] of HAND_CONNECTIONS) {
    const p = landmarks[a]
    const q = landmarks[b]
    if (!p || !q) continue
    ctx.beginPath()
    ctx.moveTo(p[0], p[1])
    ctx.lineTo(q[0], q[1])
    ctx.stroke()
  }
  ctx.fillStyle = WHITE
  for (const [x, y] of landmarks) {
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawHoles(ctx: CanvasRenderingContext2D, f: FrameEvent, mirrored: boolean) {
  const r = 11
  ;(f.overlay.holes_px ?? []).forEach(([x, y], k) => {
    const style = holeStyle(k, f.board?.occupancy, f.overlay.next_hole)
    if (style === 'occupied') {
      ctx.fillStyle = MINT
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      label(ctx, String(k + 1), x, y, INK, 13, mirrored)
      return
    }
    if (style === 'target') glowRing(ctx, x, y, r)
    ctx.strokeStyle = style === 'target' ? AMBER : MINT
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.stroke()
    label(ctx, String(k + 1), x, y, style === 'target' ? AMBER : WHITE_SOFT, 13, mirrored)
  })
}

function drawCup(ctx: CanvasRenderingContext2D, f: FrameEvent, mirrored: boolean) {
  const r = 13
  ;(f.overlay.dots_px ?? []).forEach(([x, y], k) => {
    const visited = f.cup?.dots_in_arc?.includes(k)
    const expected = k === f.overlay.expected_next
    if (expected) glowRing(ctx, x, y, r)
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    if (visited) {
      ctx.fillStyle = MINT
      ctx.fill()
      label(ctx, String(k + 1), x, y, INK, 14, mirrored)
    } else {
      ctx.strokeStyle = expected ? AMBER : MINT
      ctx.lineWidth = 2.5
      ctx.stroke()
      label(ctx, String(k + 1), x, y, expected ? AMBER : WHITE_SOFT, 14, mirrored)
    }
  })
  if (f.overlay.cup_px) {
    const [cx, cy] = f.overlay.cup_px
    const cr = 22
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, cr)
    g.addColorStop(0, 'rgba(242, 180, 87, 0.65)')
    g.addColorStop(0.7, AMBER_SOFT)
    g.addColorStop(1, 'rgba(242, 180, 87, 0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, cr, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawArm(ctx: CanvasRenderingContext2D, f: FrameEvent) {
  const bones = f.overlay.skeleton_px ?? []
  if (f.overlay.shoulder_px && f.overlay.ghost_target_px) {
    const [sx, sy] = f.overlay.shoulder_px
    const [gx, gy] = f.overlay.ghost_target_px
    // translucent teal limb to the ceiling target
    ctx.save()
    ctx.strokeStyle = TEAL_GHOST
    ctx.lineWidth = 22
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(gx, gy)
    ctx.stroke()
    ctx.restore()
    // dashed amber guide + target ring
    ctx.save()
    ctx.strokeStyle = AMBER
    ctx.lineWidth = 2.5
    ctx.setLineDash([8, 6])
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(gx, gy)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(gx, gy, 10, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  ctx.save()
  ctx.strokeStyle = MINT
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  for (const [p, q] of bones) {
    ctx.beginPath()
    ctx.moveTo(p[0], p[1])
    ctx.lineTo(q[0], q[1])
    ctx.stroke()
  }
  ctx.fillStyle = WHITE
  for (const [p, q] of bones) {
    for (const [x, y] of [p, q]) {
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** Live-session overlay from a `frame` event: marker brackets, numbered hole discs (occupied =
 *  mint fill, empty = outline, target = amber glow), cup disc + target dots, hand skeleton,
 *  ghost limb. Draws nothing until the first frame. Pure: testable without a canvas. */
export function drawFrameOverlay(ctx: CanvasRenderingContext2D, f: FrameEvent | null, opts: DrawOpts = {}) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  if (!f) return
  const mirrored = opts.mirrored ?? false
  for (const quad of Object.values(f.overlay.markers_px ?? {})) drawBracket(ctx, quad)
  if (f.overlay.holes_px) drawHoles(ctx, f, mirrored)
  if (f.overlay.dots_px || f.overlay.cup_px) drawCup(ctx, f, mirrored)
  if (f.overlay.skeleton_px || f.overlay.shoulder_px) drawArm(ctx, f)
  if (f.hand?.present && f.hand.landmarks_px) drawHand(ctx, f.hand.landmarks_px)
}

/** Calibration overlay (screen 05): marker brackets in mint, sheet outline dashed in amber once
 *  calibrated, one amber ring per target. */
export function drawOverlay(ctx: CanvasRenderingContext2D, cal: CalibrationEvent | null) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  if (!cal) return
  const markers = Object.values(cal.markers_px ?? {})
  for (const quad of markers) drawBracket(ctx, quad)
  if (cal.calibrated && markers.length === 4) {
    const centres = markers.map((q) => [
      q.reduce((s, p) => s + p[0], 0) / 4,
      q.reduce((s, p) => s + p[1], 0) / 4,
    ])
    ctx.save()
    ctx.strokeStyle = AMBER
    ctx.lineWidth = 2
    ctx.setLineDash([8, 6])
    ctx.beginPath()
    centres.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.closePath()
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
  }
  for (const [x, y] of cal.targets_px ?? []) {
    ctx.strokeStyle = AMBER
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(x, y, 8, 0, Math.PI * 2)
    ctx.stroke()
  }
}

/** Canvas laid over the feed. `width` × `height` is the frame coordinate space the service
 *  reports in (640 × 480); the backing store follows the feed box (ResizeObserver on the parent,
 *  device-pixel-ratio aware) so lines stay crisp at any size. Marker corners are smoothed
 *  across frames. Draws nothing until the first event. */
export function OverlayCanvas({
  width,
  height,
  calibration,
  frame = null,
  mirrored = true,
}: {
  width: number
  height: number
  calibration: CalibrationEvent | null
  frame?: FrameEvent | null
  mirrored?: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const smoothed = useRef<Record<string, number[][]> | null>(null)
  const latest = useRef({ frame, calibration, mirrored, width, height })

  const draw = useCallback(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const { frame: f, calibration: cal, mirrored: m, width: w, height: h } = latest.current
    ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0)
    if (f) {
      smoothed.current = smoothCorners(smoothed.current, f.overlay.markers_px ?? {})
      drawFrameOverlay(ctx, { ...f, overlay: { ...f.overlay, markers_px: smoothed.current } }, { mirrored: m })
    } else {
      smoothed.current = null
      drawOverlay(ctx, cal)
    }
  }, [])

  // Follow the feed box so the overlay is crisp at any layout size.
  useEffect(() => {
    const canvas = ref.current
    const parent = canvas?.parentElement
    if (!canvas || !parent || typeof ResizeObserver === 'undefined') return
    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      const box = parent.getBoundingClientRect()
      const w = Math.max(1, Math.round(box.width * dpr))
      const h = Math.max(1, Math.round(box.height * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      draw()
    }
    const ro = new ResizeObserver(fit)
    ro.observe(parent)
    fit()
    return () => ro.disconnect()
  }, [draw])

  useEffect(() => {
    latest.current = { frame, calibration, mirrored, width, height }
    draw()
  }, [draw, calibration, frame, mirrored, width, height])

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${mirrored ? '-scale-x-100' : ''}`}
    />
  )
}

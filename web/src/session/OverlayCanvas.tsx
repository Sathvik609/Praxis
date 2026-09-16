import { useEffect, useRef } from 'react'
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
  board: { occupancy?: Record<string, 'empty' | 'occupied'>; hole_source?: string; free_pegs_mm?: number[][] }
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
  hand?: { present: boolean; landmarks_px?: number[][]; pinch_mm?: number | null; tremor_hz?: number | null; sparc?: number | null; ms?: number }
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

export function drawHand(ctx: CanvasRenderingContext2D, landmarks: number[][]) {
  ctx.lineWidth = 2
  ctx.strokeStyle = '#7FE0C4'
  for (const [a, b] of HAND_CONNECTIONS) {
    const p = landmarks[a]
    const q = landmarks[b]
    if (!p || !q) continue
    ctx.beginPath()
    ctx.moveTo(p[0], p[1])
    ctx.lineTo(q[0], q[1])
    ctx.stroke()
  }
  ctx.fillStyle = '#FFFFFF'
  for (const [x, y] of landmarks) {
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, Math.PI * 2)
    ctx.fill()
  }
}

const MINT = '#2FA985'
const AMBER = '#C97F14'

/** Live-session overlay from a `frame` event: marker quads, hole rings (filled when occupied),
 *  amber ring on the suggested next hole. */
export function drawFrameOverlay(ctx: CanvasRenderingContext2D, f: FrameEvent | null) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  if (!f) return
  ctx.lineWidth = 3
  for (const quad of Object.values(f.overlay.markers_px ?? {})) {
    ctx.strokeStyle = MINT
    ctx.beginPath()
    quad.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.closePath()
    ctx.stroke()
  }
  ;(f.overlay.holes_px ?? []).forEach(([x, y], k) => {
    const occupied = f.board?.occupancy?.[`hole_${k}`] === 'occupied'
    ctx.strokeStyle = k === f.overlay.next_hole ? AMBER : MINT
    ctx.fillStyle = MINT
    ctx.beginPath()
    ctx.arc(x, y, 9, 0, Math.PI * 2)
    if (occupied) ctx.fill()
    ctx.stroke()
  })
  ;(f.overlay.dots_px ?? []).forEach(([x, y], k) => {
    const visited = f.cup?.dots_in_arc?.includes(k)
    ctx.strokeStyle = k === f.overlay.expected_next ? AMBER : MINT
    ctx.fillStyle = MINT
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(x, y, 12, 0, Math.PI * 2)
    if (visited) ctx.fill()
    ctx.stroke()
  })
  if (f.overlay.cup_px) {
    ctx.strokeStyle = '#FFFFFF'
    ctx.beginPath()
    ctx.arc(f.overlay.cup_px[0], f.overlay.cup_px[1], 18, 0, Math.PI * 2)
    ctx.stroke()
  }
  for (const [p, q] of f.overlay.skeleton_px ?? []) {
    ctx.strokeStyle = MINT
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(p[0], p[1])
    ctx.lineTo(q[0], q[1])
    ctx.stroke()
  }
  if (f.overlay.shoulder_px && f.overlay.ghost_target_px) {
    const [sx, sy] = f.overlay.shoulder_px
    const [gx, gy] = f.overlay.ghost_target_px
    ctx.strokeStyle = AMBER
    ctx.setLineDash([8, 6])
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(gx, gy)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.arc(gx, gy, 10, 0, Math.PI * 2)
    ctx.stroke()
  }
  if (f.hand?.present && f.hand.landmarks_px) drawHand(ctx, f.hand.landmarks_px)
}

/** Pure drawing routine (testable without WebGL/canvas): marker quads in mint, sheet
 *  outline dashed in amber once calibrated, one amber ring per target. */
export function drawOverlay(ctx: CanvasRenderingContext2D, cal: CalibrationEvent | null) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  if (!cal) return
  ctx.lineWidth = 3
  const markers = Object.values(cal.markers_px ?? {})
  for (const quad of markers) {
    ctx.strokeStyle = MINT
    ctx.beginPath()
    quad.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.closePath()
    ctx.stroke()
  }
  if (cal.calibrated && markers.length === 4) {
    const centres = markers.map((q) => [
      q.reduce((s, p) => s + p[0], 0) / 4,
      q.reduce((s, p) => s + p[1], 0) / 4,
    ])
    ctx.strokeStyle = AMBER
    ctx.setLineDash([8, 6])
    ctx.beginPath()
    centres.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.closePath()
    ctx.stroke()
    ctx.setLineDash([])
  }
  for (const [x, y] of cal.targets_px ?? []) {
    ctx.strokeStyle = AMBER
    ctx.beginPath()
    ctx.arc(x, y, 8, 0, Math.PI * 2)
    ctx.stroke()
  }
}

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
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    if (frame) drawFrameOverlay(ctx, frame)
    else drawOverlay(ctx, calibration)
  }, [calibration, frame])
  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      className={`pointer-events-none absolute inset-0 h-full w-full ${mirrored ? '-scale-x-100' : ''}`}
    />
  )
}

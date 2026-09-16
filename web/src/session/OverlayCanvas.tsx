import { useEffect, useRef } from 'react'
import type { PraxisEvent } from '../lib/events'

export type CalibrationEvent = PraxisEvent & {
  calibrated: boolean
  missing: number[]
  rms_mm?: number | null
  markers_px?: Record<string, number[][]>
  targets_px?: number[][]
}

export type FrameEvent = PraxisEvent & {
  calibrated: boolean
  missing: number[]
  nhpt: {
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
  overlay: { holes_px: number[][]; target: number | null; next_hole: number | null; markers_px: Record<string, number[][]> }
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
  f.overlay.holes_px.forEach(([x, y], k) => {
    const occupied = f.board?.occupancy?.[`hole_${k}`] === 'occupied'
    ctx.strokeStyle = k === f.overlay.next_hole ? AMBER : MINT
    ctx.fillStyle = MINT
    ctx.beginPath()
    ctx.arc(x, y, 9, 0, Math.PI * 2)
    if (occupied) ctx.fill()
    ctx.stroke()
  })
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

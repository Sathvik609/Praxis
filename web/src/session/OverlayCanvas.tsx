import { useEffect, useRef } from 'react'
import type { PraxisEvent } from '../lib/events'

export type CalibrationEvent = PraxisEvent & {
  calibrated: boolean
  missing: number[]
  rms_mm?: number | null
  markers_px?: Record<string, number[][]>
  targets_px?: number[][]
}

const MINT = '#2FA985'
const AMBER = '#C97F14'

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
  mirrored = true,
}: {
  width: number
  height: number
  calibration: CalibrationEvent | null
  mirrored?: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (ctx) drawOverlay(ctx, calibration)
  }, [calibration])
  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      className={`pointer-events-none absolute inset-0 h-full w-full ${mirrored ? '-scale-x-100' : ''}`}
    />
  )
}

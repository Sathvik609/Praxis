import type { Insets } from './framing'
import type { Side } from './layout'

/** Joint labels (pills) on the avatar stage. They never sit on the figure: they stack in a column
 *  in a gutter on one side of the stage (or a band on top of a narrow stage), the figure is
 *  framed in the rest (`Insets`), and a short leader line runs from each joint dot to its pill.
 *  Pure layout, so it is unit-tested; the panel moves the DOM nodes from the render loop. */

export type Gutter = 'left' | 'right' | 'top'

/** Pill height (the 56 px tap target), gap between pills, stage edge margin, and the view line
 *  ("Front view · 1×") at the top-left of the stage. */
export const CHIP_H = 56
export const GAP = 8
export const EDGE = 8
export const VIEW_H = 32

/** Side of the stage the labels go on, outside the figure's silhouette with leader lines that
 *  cross no body part. Front view: beyond the practising arm (the model faces the camera, so its
 *  left arm is on screen right); the arm is the outermost part of the silhouette on that side,
 *  so the leaders never cross the torso. Side view (the camera stands on the practising side):
 *  behind the figure, away from the face and the reach in front of it. */
export function gutterSide(camera: 'front' | 'side', side: Side): 'left' | 'right' {
  if (camera === 'front') return side === 'left' ? 'right' : 'left'
  return side === 'left' ? 'right' : 'left'
}

/** A side column unless it would leave the figure less than 45 % of the stage width; then a
 *  band across the top (the narrow live-session reference panels). */
export function chooseGutter(w: number, chipW: number, preferred: 'left' | 'right'): Gutter {
  return w - (chipW + 2 * EDGE) < 0.45 * w ? 'top' : preferred
}

type InsetInput = { gutter: Gutter; chipW: number; captionH: number; overlayTop: number; rows: number }

function bandY(overlayTop: number): number {
  return Math.max(VIEW_H, overlayTop) + 4
}

/** Stage pixels the figure keeps clear of. The view line sits at the top-left and a host's
 *  overlay buttons (Home zoom) at the top-right: each only pushes the figure down when it is
 *  over the figure's side of the stage, not over the label gutter. */
export function stageInsets({ gutter, chipW, captionH, overlayTop, rows }: InsetInput): Insets {
  const bottom = captionH + 4
  const col = chipW + 2 * EDGE
  if (gutter === 'top') return { top: bandY(overlayTop) + rows * (CHIP_H + GAP) - GAP + 4, bottom, left: EDGE, right: EDGE }
  if (gutter === 'left') return { top: Math.max(EDGE, overlayTop), bottom, left: col, right: EDGE }
  return { top: Math.max(EDGE, VIEW_H), bottom, left: EDGE, right: col }
}

/** Rows the top band needs for these pill widths on a stage `w` wide. */
export function bandRows(widths: number[], w: number): number {
  let rows = widths.length ? 1 : 0
  let x = EDGE
  for (const cw of widths) {
    if (x > EDGE && x + cw > w - EDGE) {
      rows += 1
      x = EDGE
    }
    x += cw + GAP
  }
  return rows
}

export type Anchor = { id: string; x: number; y: number }
/** A placed pill (x, y, w, h: its box in stage pixels) and its leader line (joint → pill). */
export type Placed = { id: string; x: number; y: number; w: number; h: number; x1: number; y1: number; x2: number; y2: number }
type PlaceOpts = { w: number; h: number; gutter: Gutter; insets: Insets; captionH: number; overlayTop: number }

/** Pills in the gutter: a column ordered like the joints top to bottom, each as level with its
 *  joint as the column allows, no two overlapping, all between the view line (or overlay) and
 *  the caption bar. In the top band: left to right in the joints' screen order. */
export function placeLabels(anchors: readonly Anchor[], widths: Readonly<Record<string, number>>, o: PlaceOpts): Placed[] {
  const wOf = (id: string) => widths[id] ?? 160
  if (o.gutter === 'top') {
    // rows left to right in the joints' screen order; each pill as far over its joint as the
    // row allows, so its leader drops nearly straight down
    const out: Placed[] = []
    let row: { a: Anchor; cw: number }[] = []
    let used = 0
    let y = bandY(o.overlayTop)
    const flush = () => {
      let x = EDGE
      for (let i = 0; i < row.length; i++) {
        const { a, cw } = row[i]
        const rest = row.slice(i + 1).reduce((s, r) => s + r.cw + GAP, 0) // room the pills after it need
        x = Math.max(x, Math.min(a.x - cw / 2, o.w - EDGE - rest - cw))
        out.push({ id: a.id, x, y, w: cw, h: CHIP_H, x1: a.x, y1: a.y, x2: Math.min(x + cw - 16, Math.max(x + 16, a.x)), y2: y + CHIP_H })
        x += cw + GAP
      }
      row = []
      used = 0
      y += CHIP_H + GAP
    }
    for (const a of [...anchors].sort((p, q) => p.x - q.x)) {
      const cw = wOf(a.id)
      if (row.length && EDGE + used + cw > o.w - EDGE) flush()
      row.push({ a, cw })
      used += cw + GAP
    }
    if (row.length) flush()
    return out
  }
  const left = o.gutter === 'left'
  const yMin = left ? VIEW_H : Math.max(EDGE, o.overlayTop ? o.overlayTop + 4 : EDGE)
  const yMax = o.h - o.captionH - 4 - CHIP_H
  const sorted = [...anchors].sort((p, q) => p.y - q.y)
  const ys = sorted.map((a) => Math.min(yMax, Math.max(yMin, a.y - CHIP_H / 2)))
  for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + CHIP_H + GAP)
  for (let i = ys.length - 1; i >= 0; i--) {
    const cap = i === ys.length - 1 ? yMax : ys[i + 1] - CHIP_H - GAP
    ys[i] = Math.max(Math.min(ys[i], cap), i === 0 ? yMin : -Infinity)
  }
  return sorted.map((a, i) => {
    const cw = wOf(a.id)
    const x = left ? EDGE : o.w - EDGE - cw
    return { id: a.id, x, y: ys[i], w: cw, h: CHIP_H, x1: a.x, y1: a.y, x2: left ? x + cw : x, y2: ys[i] + CHIP_H / 2 }
  })
}

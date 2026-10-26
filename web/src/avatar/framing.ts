import * as THREE from 'three'
import type { Side } from './layout'

/** What the camera framing depends on, for either figure (procedural clip or GLB action). */
export type Framing = {
  camera: 'front' | 'side'
  closeUp: boolean
  compact: boolean
  /** Practising side: the side camera stands on it. */
  side: Side
  /** A table task: look down a little so the sheet reads. */
  hasTable: boolean
  /** Arm-elevation clips reach overhead: frame a little taller and further back. */
  tall: boolean
  /** Vertical offset of the whole framing (the GLB's table sits lower than the procedural bust's). */
  yShift?: number
}

/** Camera presets: front 2.3 m, look height 1.30 m (Home compact 2.25 m / 1.36 m), side from
 *  the practising side, close-up 1.5 m on the hand. Table clips look down a little so the sheet reads. */
export function framingPreset(f: Framing, hand: THREE.Vector3): { eye: THREE.Vector3; look: THREE.Vector3 } {
  const { camera, closeUp, compact, hasTable, tall } = f
  const sx = f.side === 'right' ? -1 : 1
  if (closeUp) {
    const look = hand.clone()
    const eye = camera === 'side' ? new THREE.Vector3(sx * 1.5, look.y + 0.3, look.z + 0.2) : new THREE.Vector3(look.x * 0.5, look.y + 0.45, look.z + 1.35)
    return { eye, look }
  }
  const dist = (compact ? 2.25 : 2.3) + (tall ? 0.25 : 0)
  const y = (hasTable ? (compact ? 1.26 : 1.22) : compact ? 1.36 : 1.3) + (tall ? 0.1 : 0) + (f.yShift ?? 0)
  if (camera === 'side') return { eye: new THREE.Vector3(sx * dist, y + 0.12, 0.2), look: new THREE.Vector3(0, y, 0.16) }
  return { eye: new THREE.Vector3(0.08, y + (hasTable ? 0.5 : 0.12), dist), look: new THREE.Vector3(0, y - (hasTable ? 0.02 : 0), 0.05) }
}

export type Box = { min: THREE.Vector3; max: THREE.Vector3 }

/** Camera that fits `box` in view, from the front (+z) or from the practising side, pitched down by
 *  `pitchDeg`, for a viewport `aspect` (w / h) and vertical field of view `vfovDeg`. Every corner of
 *  the box lands inside the frame with `margin` to spare; the box centre is the look target. Used
 *  for the Blender figure, whose box is sampled from the action itself (so each exercise is framed
 *  around the space it actually uses and the camera does not bob while it plays). */
export function fitFraming(box: Box, camera: 'front' | 'side', side: Side, aspect: number, vfovDeg: number, pitchDeg = 6, margin = 1.08): { eye: THREE.Vector3; look: THREE.Vector3 } {
  const c = box.min.clone().add(box.max).multiplyScalar(0.5)
  const sx = side === 'right' ? -1 : 1
  const flat = camera === 'side' ? new THREE.Vector3(sx, 0, 0) : new THREE.Vector3(0, 0, 1)
  const p = (pitchDeg * Math.PI) / 180
  const toCam = flat.multiplyScalar(Math.cos(p)).add(new THREE.Vector3(0, Math.sin(p), 0)).normalize()
  const fwd = toCam.clone().negate()
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize()
  const up = new THREE.Vector3().crossVectors(right, fwd)
  const tanV = Math.tan(((vfovDeg * Math.PI) / 180) / 2)
  const tanH = tanV * aspect
  let d = 0
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const v = new THREE.Vector3(x, y, z).sub(c)
    const toward = v.dot(toCam)
    d = Math.max(d, toward + Math.abs(v.dot(right)) / tanH, toward + Math.abs(v.dot(up)) / tanV)
  }
  return { eye: c.clone().add(toCam.multiplyScalar(d * margin)), look: c }
}

/** Stage pixels kept clear of the figure: the view line on top, the caption bar at the bottom,
 *  and the label gutter on one side. The figure is framed inside what is left (the safe rect). */
export type Insets = { top: number; right: number; bottom: number; left: number }
export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

/** Point `cam` so its fov and aspect describe the safe rect of a w × h canvas: an off-axis view
 *  (three's `setViewOffset`) in which the safe rect is the "full" frame and the insets are extra
 *  canvas around it. `fitFraming(…, aspect = the returned value)` then lands the box exactly in
 *  the safe rect, and projecting through `cam` still gives canvas coordinates for the labels. */
export function setSafeView(cam: THREE.PerspectiveCamera, w: number, h: number, ins: Insets): number {
  const sw = Math.max(40, w - ins.left - ins.right)
  const sh = Math.max(40, h - ins.top - ins.bottom)
  cam.aspect = sw / sh
  cam.setViewOffset(sw, sh, -ins.left, -ins.top, w, h)
  cam.updateProjectionMatrix()
  return cam.aspect
}

type P3 = readonly [number, number, number]

/** What a GLB action's framing box is built from. `frames` are world positions of the rig's
 *  joints and bone tips sampled across the action (`glbFrames`), `propPoints` the sheet / board /
 *  pegs / target anchors of a table task (`glbPropPoints`), mirrored for the right side. */
export type BoxInput = {
  frames: readonly ReadonlyMap<string, P3>[]
  propPoints?: readonly P3[]
  /** A table task: frame from the table top up (the legs under the table are not the task). */
  tableTop?: number | null
  closeUp?: boolean
}

/** The practising hand (the model is mirrored for the right side, so it is always the `_L` chain). */
const PRACTISING_HAND = /^(hand|index|middle|ring|little|thumb)(_\d)?_L(_leaf)?$/
const CLOSE_UP_KEEP = new Set(['head', 'head_leaf', 'neck', 'upper_arm_L', 'upper_arm_R', 'clavicle_L', 'clavicle_R'])
const PAD = 0.07 // body thickness around the bone line
const CROWN = 0.08 // top of the head a table close-up may trim

/** A padded point the camera must keep in view (r = radius around it, metres). */
export type FramePoint = { p: THREE.Vector3; r: number }
export type Frame = { points: FramePoint[]; box: Box }

/** What the camera frames for a GLB action.
 *  - Standing / seated exercise: every joint across the action, head to feet.
 *  - Table task (cup, NHPT): head to table top plus the sheet or board, so the sheet, the pegs and
 *    the amber target ring read; the legs under the table are left out.
 *  - Table close-up: the face and shoulders (the crown may trim, as in a film close-up), the
 *    practising hand across the whole action, and the sheet or board; seen from a steeper angle
 *    (`pitchFor`), so the sheet opens up toward the viewer.
 *  Sampled over the whole action, so the view stays still while the figure moves. */
export function actionFrame(input: BoxInput): Frame {
  const table = input.tableTop != null
  const floor = table ? input.tableTop! - 0.03 : -Infinity
  const points: FramePoint[] = []
  for (const f of input.frames) {
    for (const [name, p] of f) {
      if (p[1] < floor) continue // under the table: the legs are not the task
      const tableClose = input.closeUp && table
      if (tableClose && !CLOSE_UP_KEEP.has(name) && !PRACTISING_HAND.test(name)) continue
      if (tableClose && name === 'head_leaf') {
        // a close-up may trim the crown, as a film close-up does; the face and chin stay in
        points.push({ p: new THREE.Vector3(p[0], p[1] - CROWN, p[2]), r: 0 })
        continue
      }
      // a bone tip is the end of the mesh (top of the head, fingertips, toes): little padding
      points.push({ p: new THREE.Vector3(p[0], p[1], p[2]), r: name.endsWith('_leaf') ? 0.02 : PAD })
    }
  }
  for (const p of input.propPoints ?? []) points.push({ p: new THREE.Vector3(p[0], p[1], p[2]), r: 0.01 })
  const b = new THREE.Box3()
  for (const { p, r } of points) b.expandByPoint(p.clone().addScalar(r)).expandByPoint(p.clone().subScalar(r))
  if (table) b.min.y = Math.max(b.min.y, floor)
  return { points, box: { min: b.min, max: b.max } }
}

/** Box of a frame (kept for callers that only need the extent). */
export function actionBox(input: BoxInput): Box {
  return actionFrame(input).box
}

/** Tight fit of a point set: like `fitFraming`, from the front or the practising side pitched
 *  down by `pitchDeg`, but centred on where the points actually project (not on box corners), so
 *  an L-shaped subject (a head above a sheet on a table) fills the frame. A few fixed-point steps
 *  re-centre the look target and rescale the distance; `margin` is the slack left on the tighter
 *  axis. */
export function fitPoints(frame: Frame, camera: 'front' | 'side', side: Side, aspect: number, vfovDeg: number, pitchDeg = 6, margin = 1.05): { eye: THREE.Vector3; look: THREE.Vector3 } {
  const start = fitFraming(frame.box, camera, side, aspect, vfovDeg, pitchDeg, 1)
  const c = start.look.clone()
  const toCam = start.eye.clone().sub(c)
  let d = toCam.length()
  toCam.normalize()
  const fwd = toCam.clone().negate()
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize()
  const up = new THREE.Vector3().crossVectors(right, fwd)
  const tanV = Math.tan(((vfovDeg * Math.PI) / 180) / 2)
  const tanH = tanV * aspect
  const rel = new THREE.Vector3()
  for (let it = 0; it < 6; it++) {
    const eye = c.clone().addScaledVector(toCam, d)
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const { p, r } of frame.points) {
      rel.copy(p).sub(eye)
      const z = Math.max(1e-3, rel.dot(fwd))
      const x = rel.dot(right)
      const y = rel.dot(up)
      x0 = Math.min(x0, (x - r) / (z * tanH))
      x1 = Math.max(x1, (x + r) / (z * tanH))
      y0 = Math.min(y0, (y - r) / (z * tanV))
      y1 = Math.max(y1, (y + r) / (z * tanV))
    }
    c.addScaledVector(right, ((x0 + x1) / 2) * d * tanH).addScaledVector(up, ((y0 + y1) / 2) * d * tanV)
    d *= Math.max((x1 - x0) / 2, (y1 - y0) / 2) || 1
  }
  return { eye: c.clone().addScaledVector(toCam, d * margin), look: c }
}

/** Home zoom: scale the framed view by `zoom` about a point on the top of the box (the head stays
 *  where it is and the figure grows downward). `edge` picks where along the top: 0 the centre,
 *  +1 / -1 the box's screen-right / screen-left edge, so with the labels in a gutter on that side
 *  the figure grows away from them and never under them. A pure dolly of eye and look toward the
 *  anchor, so the view keeps its direction. */
export function zoomAbout(f: { eye: THREE.Vector3; look: THREE.Vector3 }, box: Box, zoom: number, edge: -1 | 0 | 1 = 0): { eye: THREE.Vector3; look: THREE.Vector3 } {
  if (!(zoom > 1)) return f
  const c = box.min.clone().add(box.max).multiplyScalar(0.5)
  const anchor = new THREE.Vector3(c.x, box.max.y, c.z)
  if (edge) {
    const fwd = f.look.clone().sub(f.eye)
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize()
    let half = 0
    for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) half = Math.max(half, Math.abs((x - c.x) * right.x + (z - c.z) * right.z))
    anchor.addScaledVector(right, edge * half)
  }
  const k = 1 / zoom
  return { eye: f.eye.clone().sub(anchor).multiplyScalar(k).add(anchor), look: f.look.clone().sub(anchor).multiplyScalar(k).add(anchor) }
}

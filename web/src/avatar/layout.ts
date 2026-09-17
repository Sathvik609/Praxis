import { REST, type Vec3 } from './rig'

/** Where the stage props sit, in rig metres (figure's left = +x, toward the viewer = +z).
 *  Shared by the clips (reach targets solved by IK) and the prop meshes so the hand really lands
 *  on the dot or hole the caption names. The sheet geometry mirrors `board_spec.py`. */
export type Side = 'left' | 'right'

/** Table surface: a little above the hips so a seated bust reads as sitting at a table. */
export const TABLE_Y = REST.hips.offset[1] + 0.02
/** Table slab: width, depth, and the z of its near (patient) edge. */
export const TABLE = { width: 0.9, depth: 0.42, nearZ: 0.14, thickness: 0.018 }

/** Waiter – cup target sheet (A4 landscape, 297 × 210 mm) centred in front of the bust. */
export const CUP_SHEET = { width: 0.297, height: 0.21, centreX: 0, centreZ: 0.295 }
const ARC_RADIUS_MM = 250
const ARC_APEX_Y_MM = 105 - 12.5
const ARC_HALF_DEG = 26

/** Five dot centres in sheet millimetres (origin top-left, x right, y down), as printed. */
export function cupDotsMm(): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < 5; i++) {
    const a = ((-ARC_HALF_DEG + (2 * ARC_HALF_DEG * i) / 4) * Math.PI) / 180
    out.push([148.5 + ARC_RADIUS_MM * Math.sin(a), ARC_APEX_Y_MM + ARC_RADIUS_MM - ARC_RADIUS_MM * Math.cos(a)])
  }
  return out
}

/** Dot centres on the table in world metres, ordered 1 → 5 starting on the practising side. */
export function cupDots(side: Side = 'left'): Vec3[] {
  const dots = cupDotsMm().map(([x, y]): Vec3 => [
    CUP_SHEET.centreX + (x - 148.5) / 1000,
    TABLE_Y,
    CUP_SHEET.centreZ + (105 - y) / 1000,
  ])
  return side === 'left' ? dots.reverse() : dots
}

/** Cup: base radius, rim radius, height; the hand holds it by the rim. */
export const CUP = { rBase: 0.03, rRim: 0.035, height: 0.09 }

/** NHPT board (140 × 140 mm plate, 3 × 3 holes at 32 mm pitch) in front of the bust, and the
 *  peg dish on the practising side. */
export const NHPT_BOARD = { size: 0.14, centreX: 0, centreZ: 0.30, pitch: 0.032 }
export const NHPT_DISH = { radius: 0.05, offsetX: 0.19, centreZ: 0.265 }
export const PEG = { radius: 0.004, length: 0.032 }

/** Nine hole centres in world metres, row by row from the far row, starting on the practising side. */
export function nhptHoles(side: Side = 'left'): Vec3[] {
  const s = side === 'left' ? 1 : -1
  const out: Vec3[] = []
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out.push([NHPT_BOARD.centreX + s * (1 - c) * NHPT_BOARD.pitch, TABLE_Y, NHPT_BOARD.centreZ + (1 - r) * NHPT_BOARD.pitch])
    }
  }
  return out
}

export function nhptDish(side: Side = 'left'): Vec3 {
  return [side === 'left' ? NHPT_DISH.offsetX : -NHPT_DISH.offsetX, TABLE_Y, NHPT_DISH.centreZ]
}

/** Arm to the front: the 90° ceiling line runs from the shoulder straight forward. */
export const CEILING_LENGTH = 0.62

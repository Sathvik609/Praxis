/** Which GLB nodes the camera frames (pure; shared by the stage and the framing tests, which
 *  sample the shipped GLB with an independent reader). */

type P3 = readonly [number, number, number]

/** Camera pitch (degrees, looking down): nearly level for a standing or seated exercise; down on
 *  a table task so the sheet or board reads; steeper in the table close-up, where the dots,
 *  holes and pegs open up toward the viewer. */
export const BODY_PITCH = 6
export const TABLE_PITCH = 28
export const TABLE_CLOSE_PITCH = 45

export function pitchFor(table: boolean, closeUp: boolean): number {
  return table ? (closeUp ? TABLE_CLOSE_PITCH : TABLE_PITCH) : BODY_PITCH
}

const NOT_BODY = /^(prop_|anchor_)|^(praxis_rig|body|root)$/

/** The rig's joints and bone tips only (no props, target anchors, mesh or armature nodes). */
export function isBodyNode(name: string): boolean {
  return !NOT_BODY.test(name)
}

/** Keep only body nodes in each sampled frame. */
export function glbFrames(frames: readonly ReadonlyMap<string, P3>[]): Map<string, P3>[] {
  return frames.map((f) => new Map([...f].filter(([n]) => isBodyNode(n))))
}

/** Half extents (x, z) of the printed sheet (A4 landscape) and the NHPT plate, in metres. */
const HALF: Record<'sheet' | 'pegboard', [number, number]> = { sheet: [0.15, 0.105], pegboard: [0.075, 0.075] }

/** Points a table task must keep in view: the sheet or board corners, every target anchor (where
 *  the amber ring sits), the cup and the pegs. `frame` is one sampled frame of every node. */
export function glbPropPoints(frame: ReadonlyMap<string, P3>, prop: 'sheet' | 'pegboard'): P3[] {
  const out: P3[] = []
  const node = prop === 'sheet' ? 'prop_sheet' : 'prop_pegboard'
  const c = frame.get(node)
  if (c) {
    const [hx, hz] = HALF[prop]
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push([c[0] + sx * hx, c[1], c[2] + sz * hz])
  }
  const want = prop === 'sheet' ? /^(anchor_dot_\d+|prop_cup)$/ : /^(anchor_hole_\d+|prop_peg_\d+)$/
  for (const [n, p] of frame) if (want.test(n)) out.push(p)
  return out
}

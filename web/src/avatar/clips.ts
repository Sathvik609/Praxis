import { solveArm } from './ik'
import { TABLE_Y, cupDots, nhptDish, nhptHoles, type Side } from './layout'
import { type Angles, type Joint, type Vec3, restAngles } from './rig'

/** Keyframed clips for the mannequin. Reaches are authored as *targets* on the stage (a dot, a
 *  hole, the dish) and solved to joint angles by `solveArm`, so the mitt lands where the caption
 *  says. Every clip is clinician-reviewed choreography, not a scoring reference (CLAUDE.md §1). */

export type Ease = 'inout' | 'anticipate' | 'overshoot'
export type CueTarget = { kind: 'dot' | 'hole' | 'ceiling' | 'dish'; index: number }
export type Carry = 'cup' | 'peg'
export type Key = {
  t: number
  pose: Partial<Record<Joint, Vec3>>
  /** 0 open … 1 closed; inherited from the previous key when omitted. */
  pinch?: number
  /** Zero velocity at this key (a human stop). */
  hold?: boolean
  ease?: Ease
  step?: number
  caption?: string
  /** Cue target from this key on: where the hand is heading (or, with `landed`, has arrived). null hides the ring. */
  target?: CueTarget | null
  landed?: boolean
  carry?: Carry | null
  parked?: number
}
export type Prop = 'table' | 'cupSheet' | 'cup' | 'nhptBoard' | 'dish' | 'ceiling'
/** Angle cue drawn in skeleton mode: a dashed amber arc to the clip's target angle and a mint
 *  arc to the figure's current angle, both about `joint`, measured on the `child` bone from
 *  `startDir` toward `peakDir` (unit vectors in the rig's reference torso frame). It describes
 *  the reference figure's own movement, never the patient's. */
export type ArcCue = {
  kind: 'elevation' | 'rotation'
  joint: Joint
  child: Joint
  targetDeg: number
  peakDir: Vec3
  startDir: Vec3
}
export type Clip = {
  name: string
  duration: number
  loop: boolean
  camera: 'front' | 'side'
  side: Side
  keys: Key[]
  steps: number
  /** Joint whose reach path is drawn as the mint tube. */
  pathJoint?: Joint
  breathHz?: number
  props: Prop[]
  /** Joint the skeleton mode highlights and labels. */
  focusJoint?: Joint
  arc?: ArcCue
  /** Where the motion came from ("procedural" or dataset + subject + rep), shown on the stage. */
  source?: string
}

const D = Math.PI / 180
const HAND_OVER_TABLE = 0.05

/** Rest: arms hang with a slight natural bend and abduction. */
function rest(): Angles {
  const a = restAngles()
  a.lShoulder = [-3 * D, 0, 4 * D]
  a.rShoulder = [-3 * D, 0, -4 * D]
  a.lElbow = [-8 * D, 0, 0]
  a.rElbow = [-8 * D, 0, 0]
  return a
}
const REST_POSE = rest()

/** Torso lean/turn toward a target: a few degrees of pitch into a far reach and 15 % of the yaw. */
function torsoToward(target: Vec3, lean = 0): Partial<Record<Joint, Vec3>> {
  const yaw = 0.15 * Math.atan2(target[0], Math.max(0.05, target[2]))
  return { spine: [lean * D, yaw, 0] }
}

/** Pose entries for the practising (left) arm reaching `target` with the hand joint, plus the torso follow. */
function reach(target: Vec3, lean = 0): Partial<Record<Joint, Vec3>> {
  const torso = torsoToward(target, lean)
  const base = { ...REST_POSE, ...torso } as Angles
  const solved = solveArm(base, 'left', target)
  return { ...torso, lShoulder: solved.lShoulder, lElbow: solved.lElbow }
}

const over = (p: Vec3, lift = HAND_OVER_TABLE): Vec3 => [p[0], p[1] + lift, p[2]]
const LAP: Vec3 = [0.2, TABLE_Y + 0.04, 0.16]
const restKeys = (): Partial<Record<Joint, Vec3>> => ({ ...REST_POSE })

function cupClip(): Clip {
  const dots = cupDots('left')
  const lean = (i: number) => (i >= 3 ? 4 : i === 2 ? 2 : 0)
  const at = (i: number) => reach(over(dots[i]), lean(i))
  const lifted = (i: number) => reach(over(dots[i], HAND_OVER_TABLE + 0.05), lean(i))
  const keys: Key[] = [
    { t: 0, pose: reach(LAP), pinch: 0.6, carry: 'cup', target: null, parked: 0, step: 1, caption: 'Step 1 of 5 · cup in your weaker hand, sheet in front of you' },
    { t: 1.0, pose: reach(LAP), pinch: 0.6, hold: true, ease: 'anticipate', target: { kind: 'dot', index: 0 }, step: 2, caption: 'Step 2 of 5 · place the cup on dot 1, hand back to lap' },
    { t: 2.2, pose: at(0), ease: 'overshoot', target: { kind: 'dot', index: 0 }, landed: true },
    { t: 2.45, pose: at(0), pinch: 0, hold: true, carry: null, parked: 0 },
    { t: 2.7, pose: lifted(0), target: null },
    { t: 3.6, pose: reach(LAP), hold: true },
    { t: 4.2, pose: reach(LAP), hold: true, ease: 'anticipate', target: { kind: 'dot', index: 0 }, step: 3, caption: 'Step 3 of 5 · reach and move the cup to the next dot, one at a time' },
    { t: 5.2, pose: at(0), ease: 'overshoot', target: { kind: 'dot', index: 0 }, landed: true },
    { t: 5.45, pose: at(0), pinch: 0.6, hold: true, carry: 'cup' },
  ]
  let t = 5.45
  const hop = (from: number, to: number) => {
    keys.push({ t: t + 0.15, pose: lifted(from), target: { kind: 'dot', index: to } })
    keys.push({ t: t + 1.25, pose: at(to), ease: 'overshoot', target: { kind: 'dot', index: to }, landed: true, parked: to })
    t += 1.25
  }
  hop(0, 1)
  hop(1, 2)
  hop(2, 3)
  hop(3, 4)
  keys.push({ t: t + 0.15, pose: at(4), hold: true, step: 4, caption: 'Step 4 of 5 · after dot 5, go back the way you came' })
  t += 0.15
  hop(4, 3)
  hop(3, 2)
  hop(2, 1)
  hop(1, 0)
  keys.push({ t: t + 0.25, pose: at(0), pinch: 0, hold: true, carry: null, parked: 0 })
  keys.push({ t: t + 0.5, pose: lifted(0), target: null })
  keys.push({ t: t + 1.4, pose: reach(LAP), hold: true, step: 5, caption: 'Step 5 of 5 · repeat twice, then twice as fast as you can' })
  keys.push({ t: t + 2.6, pose: reach(LAP), hold: true })
  return { name: 'cup', duration: t + 2.6, loop: false, camera: 'front', side: 'left', steps: 5, keys, pathJoint: 'lHand', props: ['table', 'cupSheet', 'cup'] }
}

function nhptClip(): Clip {
  const holes = nhptHoles('left')
  const dish = nhptDish('left')
  const atDish = reach(over(dish, 0.03))
  const keys: Key[] = []
  const PEG = 3.1
  for (let k = 0; k < 3; k++) {
    const T = k * PEG
    const hole = holes[k]
    keys.push({ t: T, pose: atDish, pinch: 0, hold: true, target: { kind: 'dish', index: 0 }, landed: true, carry: null, parked: k, step: 1, caption: 'Step 1 of 3 · pick a peg from the dish with a pinch' })
    keys.push({ t: T + 0.25, pose: atDish, pinch: 1, hold: true, carry: 'peg' })
    keys.push({ t: T + 0.4, pose: reach(over(dish, 0.1)), target: { kind: 'hole', index: k }, step: 2, caption: 'Step 2 of 3 · carry it over the board, any hole' })
    keys.push({ t: T + 1.2, pose: reach(over(hole, 0.09), 2), step: 3, caption: 'Step 3 of 3 · seat it and let go; the timer stops at the ninth peg' })
    keys.push({ t: T + 1.5, pose: reach(over(hole, 0.03), 2), ease: 'overshoot', target: { kind: 'hole', index: k }, landed: true })
    keys.push({ t: T + 1.7, pose: reach(over(hole, 0.03), 2), pinch: 0, hold: true, carry: null, parked: k + 1 })
    keys.push({ t: T + 1.9, pose: reach(over(hole, 0.09), 2), target: null })
    keys.push({ t: T + 2.75, pose: atDish, ease: 'overshoot', hold: true })
  }
  keys.push({ t: 3 * PEG, pose: atDish, pinch: 0, hold: true })
  return { name: 'nhpt', duration: 3 * PEG, loop: true, camera: 'front', side: 'left', steps: 3, keys, pathJoint: 'lHand', breathHz: 2 / (3 * PEG), props: ['table', 'nhptBoard', 'dish'] }
}

function armFrontClip(): Clip {
  const up = (pitch: number, elbow = 0): Partial<Record<Joint, Vec3>> => ({ lShoulder: [pitch * D, 0, 2 * D], lElbow: [elbow * D, 0, 0] })
  return {
    name: 'armFront', duration: 9, loop: false, camera: 'side', side: 'left', steps: 3, pathJoint: 'lHand', props: ['ceiling'],
    keys: [
      { t: 0, pose: restKeys(), ease: 'anticipate', target: { kind: 'ceiling', index: 0 }, step: 1, caption: 'Step 1 of 3 · lift the arm to the front for three' },
      { t: 3, pose: up(-90), hold: true, target: { kind: 'ceiling', index: 0 }, landed: true, step: 2, caption: 'Step 2 of 3 · hold at shoulder height for three, no higher' },
      { t: 4, pose: up(-89.2, -8) },
      { t: 5, pose: up(-90.6, -6) },
      { t: 6, pose: up(-90), hold: true, target: null, step: 3, caption: 'Step 3 of 3 · lower for three' },
      { t: 9, pose: restKeys(), hold: true },
    ],
  }
}

function idleClip(): Clip {
  const sway = (yaw: number, roll: number): Partial<Record<Joint, Vec3>> => ({ ...REST_POSE, spine: [0, yaw * D, 0], hips: [0, 0, roll * D] })
  return {
    name: 'idle', duration: 14, loop: true, camera: 'front', side: 'left', steps: 1, breathHz: 3 / 14, props: [],
    keys: [
      { t: 0, pose: sway(0, 0), step: 1, caption: 'Ready when you are.' },
      { t: 3.5, pose: sway(2, 1) },
      { t: 7, pose: sway(0, 0) },
      { t: 10.5, pose: sway(-2, -1) },
      { t: 14, pose: sway(0, 0) },
    ],
  }
}

export const CLIPS: Record<'idle' | 'nhpt' | 'cup' | 'armFront', Clip> = {
  idle: idleClip(),
  armFront: armFrontClip(),
  cup: cupClip(),
  nhpt: nhptClip(),
}

const SWAP: Record<Joint, Joint> = {
  hips: 'hips', spine: 'spine', neck: 'neck', head: 'head',
  lShoulder: 'rShoulder', lElbow: 'rElbow', lWrist: 'rWrist', lHand: 'rHand',
  rShoulder: 'lShoulder', rElbow: 'lElbow', rWrist: 'lWrist', rHand: 'lHand',
}
const mirrored = new WeakMap<Clip, Clip>()

/** The same clip for the other side: arms swapped, yaw and roll negated, targets re-laid out by side. */
export function mirror(clip: Clip): Clip {
  const hit = mirrored.get(clip)
  if (hit) return hit
  const keys = clip.keys.map((k) => {
    const pose: Partial<Record<Joint, Vec3>> = {}
    for (const j of Object.keys(k.pose) as Joint[]) {
      const [x, y, z] = k.pose[j] as Vec3
      pose[SWAP[j]] = [x, -y, -z]
    }
    return { ...k, pose }
  })
  const mv = (v: Vec3): Vec3 => [-v[0], v[1], v[2]]
  const out: Clip = {
    ...clip,
    keys,
    side: clip.side === 'left' ? 'right' : 'left',
    pathJoint: clip.pathJoint ? SWAP[clip.pathJoint] : undefined,
    focusJoint: clip.focusJoint ? SWAP[clip.focusJoint] : undefined,
    arc: clip.arc ? { ...clip.arc, joint: SWAP[clip.arc.joint], child: SWAP[clip.arc.child], peakDir: mv(clip.arc.peakDir), startDir: mv(clip.arc.startDir) } : undefined,
  }
  mirrored.set(clip, out)
  return out
}

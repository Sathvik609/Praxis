import type { Joint, Vec3 } from './rig'

export type Key = { t: number; pose: Partial<Record<Joint, Vec3>>; step?: number; caption?: string }
export type Clip = {
  name: string
  duration: number
  loop: boolean
  camera: 'front' | 'side'
  keys: Key[]
  steps: number
  /** Joint whose path is drawn as the mint "ideal path" tube. */
  pathJoint?: Joint
  /** Joint the amber "current target" ring follows. */
  targetJoint?: Joint
}

const D = Math.PI / 180
const rest = {}

export const CLIPS: Record<'idle' | 'nhpt' | 'cup' | 'armFront', Clip> = {
  idle: {
    name: 'idle', duration: 4, loop: true, camera: 'front', steps: 1,
    keys: [
      { t: 0, pose: { spine: [0, 0, 0] }, step: 1, caption: 'Ready when you are.' },
      { t: 2, pose: { spine: [2 * D, 0, 0], lShoulder: [0, 0, -2 * D], rShoulder: [0, 0, 2 * D] } },
      { t: 4, pose: { spine: [0, 0, 0], lShoulder: [0, 0, 0], rShoulder: [0, 0, 0] } },
    ],
  },
  armFront: {
    name: 'armFront', duration: 9, loop: false, camera: 'side', steps: 3, pathJoint: 'lWrist', targetJoint: 'lWrist',
    keys: [
      { t: 0, pose: { ...rest, lShoulder: [0, 0, 0], lElbow: [0, 0, 0] }, step: 1, caption: 'Step 1 of 3 · lift the arm to the front for three' },
      { t: 3, pose: { lShoulder: [-90 * D, 0, 0], lElbow: [0, 0, 0] }, step: 2, caption: 'Step 2 of 3 · hold at shoulder height for three, no higher' },
      { t: 6, pose: { lShoulder: [-90 * D, 0, 0] }, step: 3, caption: 'Step 3 of 3 · lower for three' },
      { t: 9, pose: { lShoulder: [0, 0, 0] } },
    ],
  },
  cup: {
    name: 'cup', duration: 10, loop: false, camera: 'front', steps: 5, pathJoint: 'lWrist', targetJoint: 'lWrist',
    keys: [
      { t: 0, pose: { lShoulder: [-20 * D, 0, 0], lElbow: [-70 * D, 0, 0] }, step: 1, caption: 'Step 1 of 5 · cup in your weaker hand, sheet in front of you' },
      { t: 2, pose: { lShoulder: [-35 * D, 10 * D, 0], lElbow: [-40 * D, 0, 0] }, step: 2, caption: 'Step 2 of 5 · place the cup on dot 1, hand back to lap' },
      { t: 3, pose: { lShoulder: [-10 * D, 0, 0], lElbow: [-60 * D, 0, 0] } },
      { t: 4, pose: { lShoulder: [-40 * D, 25 * D, 0], lElbow: [-30 * D, 0, 0] }, step: 3, caption: 'Step 3 of 5 · reach and move the cup to the next dot, one at a time' },
      { t: 5.5, pose: { lShoulder: [-45 * D, 45 * D, 0], lElbow: [-20 * D, 0, 0] } },
      { t: 7, pose: { lShoulder: [-40 * D, 20 * D, 0], lElbow: [-30 * D, 0, 0] }, step: 4, caption: 'Step 4 of 5 · after dot 5, go back the way you came' },
      { t: 8.5, pose: { lShoulder: [-35 * D, 0, 0], lElbow: [-40 * D, 0, 0] } },
      { t: 9, pose: { lShoulder: [-20 * D, 0, 0], lElbow: [-70 * D, 0, 0] }, step: 5, caption: 'Step 5 of 5 · repeat twice, then twice as fast as you can' },
      { t: 10, pose: { lShoulder: [-20 * D, 0, 0], lElbow: [-70 * D, 0, 0] } },
    ],
  },
  nhpt: {
    name: 'nhpt', duration: 6, loop: true, camera: 'front', steps: 3, pathJoint: 'lWrist', targetJoint: 'lWrist',
    keys: [
      { t: 0, pose: { lShoulder: [-30 * D, 15 * D, 0], lElbow: [-60 * D, 0, 0] }, step: 1, caption: 'Step 1 of 3 · pick a peg from the dish with a pinch' },
      { t: 2, pose: { lShoulder: [-45 * D, -10 * D, 0], lElbow: [-35 * D, 0, 0] }, step: 2, caption: 'Step 2 of 3 · carry it over the board, any hole' },
      { t: 4, pose: { lShoulder: [-40 * D, -12 * D, 0], lElbow: [-45 * D, 0, 0] }, step: 3, caption: 'Step 3 of 3 · seat it and let go; the timer stops at the ninth peg' },
      { t: 6, pose: { lShoulder: [-30 * D, 15 * D, 0], lElbow: [-60 * D, 0, 0] } },
    ],
  },
}

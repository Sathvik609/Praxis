import type { Side } from './layout'
import type { Joint } from './rig'

/** Pure glue between the app and the Blender-built avatar (`public/avatar/praxis_avatar.glb` +
 *  `praxis_avatar.meta.json`): which action to play, where in it the patient's rep progress puts
 *  the figure, which props show, which caption and target are current, and which bone a rig joint
 *  label follows. No three.js here, so all of it is unit-tested. The figure never scores anyone:
 *  it is a pacing reference and reps are verified from OpenCV events only (CLAUDE.md §1 Avatar). */

export const GLB_ACTIONS = ['idle', 'pendulum', 'flexion', 'abduction', 'external_rotation', 'internal_rotation', 'waiter_cup', 'nhpt'] as const
export type GlbAction = (typeof GLB_ACTIONS)[number]

export type GlbProp = 'table' | 'sheet' | 'cup' | 'pegboard'
export type GlbStep = { t: number; step: number; caption: string }
export type GlbTarget = { t: number; kind: 'dot' | 'hole'; index: number; landed?: boolean }
export type GlbActionMeta = {
  duration: number
  loop: boolean
  camera: 'front' | 'side'
  props: GlbProp[]
  rep: [number, number]
  steps: GlbStep[]
  targets: GlbTarget[]
  focus_bone: string | null
  source?: string
  seated?: boolean
  /** Upper-arm elevation ceiling the recorded rep was scaled to, and its recorded peak. */
  ceiling_deg?: number
  scaled_from_deg?: number
  [extra: string]: unknown
}
export type AvatarMeta = { fps: number; actions: Record<string, GlbActionMeta> }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Every name the app uses for an exercise (clip ids, seed ids, display names) → action. */
const NAMES: Record<string, GlbAction> = {
  pendulum: 'pendulum',
  flexion: 'flexion',
  armfront: 'flexion',
  arm: 'flexion',
  'arm to the front': 'flexion',
  abduction: 'abduction',
  'arm out to the side': 'abduction',
  'external rotation': 'external_rotation',
  'rotate out': 'external_rotation',
  'internal rotation': 'internal_rotation',
  'rotate in': 'internal_rotation',
  cup: 'waiter_cup',
  'waiter cup': 'waiter_cup',
  nhpt: 'nhpt',
  'nine hole peg test': 'nhpt',
}

/** App clip / exercise name → GLB action; anything unknown (Home, idle, instructions-only) → idle. */
export function actionFor(name: string | null | undefined): GlbAction {
  return NAMES[norm(name ?? '')] ?? 'idle'
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/** Where rep progress p (0..1, from the camera) puts the figure: `rep[0] + p·(rep[1] − rep[0])`. */
export function pacedActionTime(rep: [number, number], p: number): number {
  return rep[0] + clamp01(p) * (rep[1] - rep[0])
}

export function isPropNode(name: string): boolean {
  return name.startsWith('prop_')
}

/** Is prop node `name` shown for an action with `props`? table ⇒ table + chair; sheet ⇒ sheet;
 *  cup ⇒ cup; pegboard ⇒ pegboard + the nine pegs. Everything else is hidden. */
export function propVisible(name: string, props: readonly string[]): boolean {
  const has = (p: GlbProp) => props.includes(p)
  if (name === 'prop_table' || name === 'prop_chair') return has('table')
  if (name === 'prop_sheet') return has('sheet')
  if (name === 'prop_cup') return has('cup')
  if (name === 'prop_pegboard' || /^prop_peg_\d+$/.test(name)) return has('pegboard')
  return false
}

/** Caption in force at time t (the latest step at or before t; the first step before any key). */
export function stepAt(steps: readonly GlbStep[], t: number): { step: number; caption: string } {
  if (!steps.length) return { step: 1, caption: '' }
  let cur = steps[0]
  for (const s of steps) if (s.t <= t) cur = s
  return { step: cur.step, caption: cur.caption }
}

/** Target being reached at time t (amber ring), or null before the first reach and once it lands. */
export function targetAt(targets: readonly GlbTarget[], t: number): { kind: 'dot' | 'hole'; index: number } | null {
  let cur: GlbTarget | null = null
  for (const x of targets) if (x.t <= t) cur = x
  return cur && !cur.landed ? { kind: cur.kind, index: cur.index } : null
}

/** Rig joint → the GLB bone whose head sits at that joint (hand = the mitt centre). */
const JOINT_BONE: Record<Joint, string> = {
  hips: 'hips',
  spine: 'chest',
  neck: 'neck',
  head: 'head',
  lShoulder: 'upper_arm_L',
  lElbow: 'forearm_L',
  lWrist: 'hand_L',
  lHand: 'mitten_L',
  rShoulder: 'upper_arm_R',
  rElbow: 'forearm_R',
  rWrist: 'hand_R',
  rHand: 'mitten_R',
}
const swapLR = (bone: string) => bone.replace(/_([LR])$/, (_, s: string) => (s === 'L' ? '_R' : '_L'))

/** Bone a joint label follows. The right side is drawn by mirroring the whole model in x, so the
 *  practising right arm is the (mirrored) left bone chain. */
export function boneFor(joint: Joint, side: Side): string {
  const b = JOINT_BONE[joint]
  return side === 'right' ? swapLR(b) : b
}

/** `meta.focus_bone` → the rig joint the Focus label names (bone head), mirrored for the right. */
export function focusJointOf(bone: string | null | undefined, side: Side): Joint | null {
  if (!bone) return null
  const j = (Object.keys(JOINT_BONE) as Joint[]).find((k) => JOINT_BONE[k] === bone)
  if (!j) return null
  if (side === 'left') return j
  return (j.startsWith('l') ? `r${j.slice(1)}` : j.startsWith('r') ? `l${j.slice(1)}` : j) as Joint
}

/** Mutable action clock shared by the panel and the stage (same shape as the procedural one). */
export type GlbClock = { time: number; playing: boolean; speed: number; target?: number | null }

/** Advance the action clock by dt seconds. Free-running: dt × speed (Slower is the time scale),
 *  wrapping a looping action. Paced (`target` set from the patient's rep progress): ease toward
 *  the target, frame-rate independent, and settle on it. Pure; the stage then sets `action.time`. */
export function advanceGlbClock(clock: GlbClock, dt: number, action: { duration: number; loop: boolean }): { ended: boolean } {
  if (clock.target != null) {
    const target = Math.max(0, Math.min(action.duration, clock.target))
    clock.time += (target - clock.time) * Math.min(1, dt * 6)
    if (Math.abs(target - clock.time) < 0.005) clock.time = target
    return { ended: false }
  }
  if (clock.playing) clock.time += dt * clock.speed
  if (action.loop) {
    if (action.duration > 0) clock.time = ((clock.time % action.duration) + action.duration) % action.duration
    return { ended: false }
  }
  if (clock.time >= action.duration) {
    clock.time = action.duration
    const ended = clock.playing
    clock.playing = false
    return { ended }
  }
  return { ended: false }
}

/** Validate the sidecar and fill safe defaults; extra fields (e.g. `ceiling_deg`) pass through. */
export function parseAvatarMeta(json: unknown): AvatarMeta {
  const j = json as { fps?: unknown; actions?: unknown } | null
  if (!j || typeof j !== 'object' || !j.actions || typeof j.actions !== 'object') throw new Error('avatar meta: no actions')
  const actions: Record<string, GlbActionMeta> = {}
  for (const [name, raw] of Object.entries(j.actions as Record<string, Record<string, unknown>>)) {
    const duration = Number(raw.duration)
    if (!(duration > 0)) throw new Error(`avatar meta: ${name} has no duration`)
    const rep = Array.isArray(raw.rep) && raw.rep.length === 2 ? ([Number(raw.rep[0]), Number(raw.rep[1])] as [number, number]) : ([0, duration] as [number, number])
    actions[name] = {
      ...raw,
      duration,
      loop: raw.loop !== false,
      camera: raw.camera === 'side' ? 'side' : 'front',
      props: Array.isArray(raw.props) ? (raw.props as GlbProp[]) : [],
      rep,
      steps: Array.isArray(raw.steps) ? (raw.steps as GlbStep[]) : [],
      targets: Array.isArray(raw.targets) ? (raw.targets as GlbTarget[]) : [],
      focus_bone: typeof raw.focus_bone === 'string' ? raw.focus_bone : null,
      source: typeof raw.source === 'string' ? raw.source : undefined,
    }
  }
  return { fps: Number(j.fps) || 30, actions }
}

/** Provenance for the stage line: "motion from UI-PRMD", "procedural motion", plus
 *  "· scaled to 90°" when the recorded rep was scaled down to the ceiling (`ceiling_deg` /
 *  `scaled_from_deg` in the sidecar). */
export function sourceLabel(source: string | undefined, meta?: { ceiling_deg?: unknown; scaled_from_deg?: unknown }): string {
  const base = !source || source === 'procedural' ? 'procedural motion' : `motion from ${source.split(' (')[0]}`
  const ceiling = Number(meta?.ceiling_deg)
  const from = Number(meta?.scaled_from_deg)
  return Number.isFinite(ceiling) && Number.isFinite(from) && from > ceiling ? `${base} · scaled to ${Math.round(ceiling)}°` : base
}

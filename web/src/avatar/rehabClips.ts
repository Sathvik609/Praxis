import type { ArcCue, Clip, Key } from './clips'
import { REST, euler, type Joint, type Mat3, type Vec3 } from './rig'

/** Real-motion reference clips: one healthy adult's repetition from a public rehabilitation
 *  dataset (UI-PRMD, ODC PDDL 1.0; IntelliRehabDS, CC BY 4.0), retargeted offline to this rig's
 *  joint angles by `evaluation/scripts/make_rehab_clips.py` and shipped as keyframes (12 keys per
 *  rep with holds at the extremes), never as recorded frames. Pendulum is authored procedurally and
 *  says so. Like every other clip these are pacing references: the avatar never scores anyone.
 *  Each key carries the source's upper-arm / forearm directions so a test can check that the
 *  rig's forward kinematics reproduces them (`rehabClips.test.ts`). */

export const REHAB_CLIP_NAMES = ['pendulum', 'flexion', 'abduction', 'external_rotation', 'internal_rotation'] as const
export type RehabClipName = (typeof REHAB_CLIP_NAMES)[number]

/** `ua`/`fa`: directions the rig's FK must reproduce from the key's angles (convention check);
 *  `src_ua`/`src_fa`: the recorded skeleton's directions (fidelity, within smoothing + fit). */
export type RehabCheck = { ua: Vec3; fa: Vec3; src_ua: Vec3; src_fa: Vec3; elevation_deg: number; bend_deg: number; rotation_deg: number }
export type RehabKeyJson = { t: number; hold: boolean; lShoulder: Vec3; lElbow: Vec3; spine: Vec3; check?: RehabCheck }
export type RehabClipJson = {
  name: RehabClipName
  title: string
  source: { dataset: string; license: string; movement: string; subject: string | null; rep: string | null; arm: string; position: string; fps_original: number | null }
  side: 'left'
  camera: 'front' | 'side'
  plane: 'sagittal' | 'frontal' | 'scapular' | 'transverse'
  focus_joint: Joint
  metric: 'elevation' | 'rotation'
  target_deg: number
  duration: number
  rest: Record<string, Vec3>
  keys: RehabKeyJson[]
  steps: { t: number; step: number; caption: string }[]
  fit: { forearm_error_deg_mean: number; forearm_error_deg_max: number } | null
  note: string
  /** Present when the recorded rep was scaled under the elevation ceiling (see `capElevation`). */
  scaled?: { ceiling_deg: number; recorded_peak_deg: number; scale: number }
}

const D = Math.PI / 180
/** Seconds of ease appended after the last recorded key so a looping clip returns to its first
 *  pose instead of jumping (the bridge is interpolation between two recorded rest poses). */
export const LOOP_BRIDGE_S = 0.7

const rad = (v: Vec3): Vec3 => [v[0] * D, v[1] * D, v[2] * D]

/** The avatar never lifts the upper arm above the prescription ceiling (Arm to the
 *  front and Arm out to the side stop at 90°). Every recorded rep that goes higher is scaled so
 *  its peak sits exactly on the ceiling: at each key the upper arm is turned back toward hanging
 *  straight down, in its own plane of elevation, by the same proportion. Timing, the plane of the
 *  movement, the elbow bend and the trunk are the recording's; only the height changes. The same
 *  rule is applied to the Blender avatar by `web/blender/animate.py` (and `glbAnim.test.ts` checks
 *  the two agree). Elevation is torso-relative: the angle between the upper arm and the trunk's
 *  down axis. */
export const AVATAR_ELEVATION_CEILING_DEG = 90

const mul3 = (a: Mat3, b: Mat3): Mat3 =>
  [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j])) as Mat3
const app3 = (m: Mat3, v: Vec3): Vec3 => [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]) as Vec3
const tr3 = (m: Mat3): Mat3 => [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[j][i])) as Mat3
const unit3 = (v: Vec3): Vec3 => {
  const n = Math.hypot(v[0], v[1], v[2])
  return [v[0] / n, v[1] / n, v[2] / n]
}
/** Rotation by `a` radians about unit axis `n` (Rodrigues). */
function axisAngle(n: Vec3, a: number): Mat3 {
  const [x, y, z] = n
  const c = Math.cos(a), s = Math.sin(a), k = 1 - c
  return [
    [c + x * x * k, x * y * k - z * s, x * z * k + y * s],
    [y * x * k + z * s, c + y * y * k, y * z * k - x * s],
    [z * x * k - y * s, z * y * k + x * s, c + z * z * k],
  ]
}
/** Inverse of rig.ts `euler` (M = Rx·Ry·Rz), radians. */
function eulerOf(m: Mat3): Vec3 {
  const y = Math.asin(Math.max(-1, Math.min(1, m[0][2])))
  return [Math.atan2(-m[1][2], m[2][2]), y, Math.atan2(-m[0][1], m[0][0])]
}
const UPPER_ARM_REST = unit3(REST.lElbow.offset)

/** Left upper-arm direction in the trunk's frame for a shoulder Euler (radians). */
export function upperArmDir(lShoulder: Vec3): Vec3 {
  return app3(euler(lShoulder), UPPER_ARM_REST)
}
/** Torso-relative elevation of the left upper arm (0° hanging down, 90° level), degrees. */
export function torsoElevationDeg(lShoulder: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, -upperArmDir(lShoulder)[1]))) / D
}

export function capElevation(json: RehabClipJson, ceilingDeg = AVATAR_ELEVATION_CEILING_DEG): RehabClipJson {
  const peak = Math.max(...json.keys.map((k) => torsoElevationDeg(rad(k.lShoulder))))
  if (peak <= ceilingDeg) return json
  const scale = ceilingDeg / peak
  const keys = json.keys.map((k): RehabKeyJson => {
    const E = euler(rad(k.lShoulder))
    const u = app3(E, UPPER_ARM_REST)
    const e = Math.acos(Math.max(-1, Math.min(1, -u[1])))
    const axis: Vec3 = [-u[2], 0, u[0]] // down × u: turning about it by +a lifts the arm
    if (Math.hypot(axis[0], axis[2]) < 1e-9) return k
    const R = axisAngle(unit3(axis), e * scale - e)
    const lShoulder = eulerOf(mul3(R, E)).map((v) => v / D) as Vec3
    if (!k.check) return { ...k, lShoulder }
    // the check vectors are world directions: turn them by the same rotation seen through the trunk
    const S = euler(rad(k.spine))
    const Rw = mul3(mul3(S, R), tr3(S))
    const turn = (v: Vec3) => app3(Rw, v)
    return {
      ...k,
      lShoulder,
      check: { ...k.check, ua: turn(k.check.ua), fa: turn(k.check.fa), src_ua: turn(k.check.src_ua), src_fa: turn(k.check.src_fa), elevation_deg: k.check.elevation_deg * scale },
    }
  })
  return {
    ...json,
    keys,
    target_deg: json.metric === 'elevation' ? ceilingDeg : json.target_deg,
    scaled: { ceiling_deg: ceilingDeg, recorded_peak_deg: Math.round(peak * 100) / 100, scale },
  }
}

/** Arc cue for the shoulder: elevation clips measure the upper arm from hanging straight down in
 *  the plane of the rep's peak; rotation clips measure the forearm about the elbow from its
 *  starting direction toward the peak. Directions are in the rig's reference torso frame. */
function arcOf(json: RehabClipJson): ArcCue | undefined {
  const withCheck = json.keys.filter((k) => k.check)
  if (!withCheck.length) {
    if (json.name === 'pendulum') return { kind: 'elevation', joint: 'lShoulder', child: 'lElbow', targetDeg: json.target_deg, peakDir: [0, -Math.cos(json.target_deg * D), Math.sin(json.target_deg * D)], startDir: [0, -1, 0] }
    return undefined
  }
  if (json.metric === 'elevation') {
    const peak = withCheck.reduce((b, k) => (k.check!.elevation_deg > b.check!.elevation_deg ? k : b), withCheck[0])
    return { kind: 'elevation', joint: 'lShoulder', child: 'lElbow', targetDeg: json.target_deg, peakDir: peak.check!.ua, startDir: [0, -1, 0] }
  }
  const sign = json.name === 'internal_rotation' ? -1 : 1
  const peak = withCheck.reduce((b, k) => (sign * k.check!.rotation_deg > sign * b.check!.rotation_deg ? k : b), withCheck[0])
  const start = withCheck[0].check!
  const dot = start.fa[0] * peak.check!.fa[0] + start.fa[1] * peak.check!.fa[1] + start.fa[2] * peak.check!.fa[2]
  const excursion = Math.acos(Math.max(-1, Math.min(1, dot))) / D
  return { kind: 'rotation', joint: 'lElbow', child: 'lWrist', targetDeg: Math.round(excursion * 10) / 10, peakDir: peak.check!.fa, startDir: start.fa }
}

export function toClip(json: RehabClipJson): Clip {
  const keys: Key[] = json.keys.map((k, i) => ({
    t: k.t,
    hold: k.hold,
    pose: i === 0
      ? { lShoulder: rad(k.lShoulder), lElbow: rad(k.lElbow), spine: rad(k.spine), rShoulder: rad(json.rest.rShoulder), rElbow: rad(json.rest.rElbow) }
      : { lShoulder: rad(k.lShoulder), lElbow: rad(k.lElbow), spine: rad(k.spine) },
    ...(i === 0 ? { pinch: 0, target: null } : {}),
  }))
  // captions ride on the nearest recorded key (an extra key would flatten the spline)
  for (const s of json.steps) {
    const near = keys.reduce((b, k) => (Math.abs(k.t - s.t) < Math.abs(b.t - s.t) ? k : b), keys[0])
    near.step = s.step
    near.caption = s.caption
  }
  const first = keys[0]
  keys.push({ t: json.duration + LOOP_BRIDGE_S, hold: true, pose: { lShoulder: first.pose.lShoulder!, lElbow: first.pose.lElbow!, spine: first.pose.spine! } })
  // short provenance for the stage readout: "UI-PRMD s03 e03+e04" (the full text stays in the JSON)
  const rep = (json.source.rep ?? '').replace(/\s*\([^)]*\)/g, '').replace(/\s*\+\s*/g, '+')
  const base = json.source.dataset === 'procedural' ? 'procedural' : `${json.source.dataset.split(' (')[0]} ${json.source.subject} ${rep}`
  const label = json.scaled ? `${base} · scaled to ${json.scaled.ceiling_deg}°` : base
  return {
    name: json.name,
    duration: json.duration + LOOP_BRIDGE_S,
    loop: true,
    camera: json.camera,
    side: 'left',
    steps: json.steps.length,
    keys,
    pathJoint: 'lHand',
    props: [],
    focusJoint: json.focus_joint,
    arc: arcOf(json),
    source: label,
  }
}

const files = import.meta.glob<RehabClipJson>('./clips/rehab/*.json', { eager: true, import: 'default' })
/** The clips exactly as recorded and retargeted (provenance, fidelity checks). */
export const REHAB_JSON_RECORDED: Record<RehabClipName, RehabClipJson> = Object.fromEntries(
  Object.values(files).map((j) => [j.name, j]),
) as Record<RehabClipName, RehabClipJson>

/** What the avatar plays: the recorded clips under the elevation ceiling. */
export const REHAB_JSON: Record<RehabClipName, RehabClipJson> = Object.fromEntries(
  Object.entries(REHAB_JSON_RECORDED).map(([n, j]) => [n, capElevation(j)]),
) as Record<RehabClipName, RehabClipJson>

export const REHAB_CLIPS: Record<RehabClipName, Clip> = Object.fromEntries(
  REHAB_CLIP_NAMES.map((n) => [n, toClip(REHAB_JSON[n])]),
) as Record<RehabClipName, Clip>

export function isRehabClip(name: string): name is RehabClipName {
  return (REHAB_CLIP_NAMES as readonly string[]).includes(name)
}

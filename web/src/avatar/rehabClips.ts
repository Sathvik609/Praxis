import type { ArcCue, Clip, Key } from './clips'
import type { Joint, Vec3 } from './rig'

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
}

const D = Math.PI / 180
/** Seconds of ease appended after the last recorded key so a looping clip returns to its first
 *  pose instead of jumping (the bridge is interpolation between two recorded rest poses). */
export const LOOP_BRIDGE_S = 0.7

const rad = (v: Vec3): Vec3 => [v[0] * D, v[1] * D, v[2] * D]

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
  const label = json.source.dataset === 'procedural' ? 'procedural' : `${json.source.dataset.split(' (')[0]} ${json.source.subject} ${rep}`
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
export const REHAB_JSON: Record<RehabClipName, RehabClipJson> = Object.fromEntries(
  Object.values(files).map((j) => [j.name, j]),
) as Record<RehabClipName, RehabClipJson>

export const REHAB_CLIPS: Record<RehabClipName, Clip> = Object.fromEntries(
  REHAB_CLIP_NAMES.map((n) => [n, toClip(REHAB_JSON[n])]),
) as Record<RehabClipName, Clip>

export function isRehabClip(name: string): name is RehabClipName {
  return (REHAB_CLIP_NAMES as readonly string[]).includes(name)
}

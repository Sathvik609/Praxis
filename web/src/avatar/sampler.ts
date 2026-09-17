import type { Carry, Clip, CueTarget, Key } from './clips'
import { JOINTS, type Angles, type Joint, type Vec3, restAngles } from './rig'

export type Sample = {
  angles: Angles
  /** 0 = open hand, 1 = closed pinch. */
  pinch: number
  /** 0 = exhaled, 1 = inhaled; procedural, continuous across loops. */
  breath: number
  progress: number
  step: number
  caption: string
  t: number
  /** Where the amber ring sits (null = hidden). */
  target: CueTarget | null
  /** Prop attached to the practising hand, if any. */
  carry: Carry | null
  /** Cup: index of the dot it rests on. NHPT: pegs seated so far. */
  parked: number
  /** Time range of the reach in progress, for the mint path; null when nothing is being reached. */
  segment: [number, number] | null
}

const CH = JOINTS.length * 3 + 1 // joint channels + pinch
const PINCH = CH - 1
const ANTICIPATE_RAD = (4 * Math.PI) / 180
const ANTICIPATE_S = 0.15
const OVERSHOOT_S = 0.25
const OVERSHOOT_FRAC = 0.03

type Track = { t: number; v: number[]; hold: boolean; m: number[] }

/** Keys expanded to full channel vectors (inheriting the previous key), with the anticipation and
 *  overshoot virtual keys inserted, then per-channel Hermite tangents. */
function expand(clip: Clip): Track[] {
  const prev = restAngles()
  let pinch = 0
  const raw: { t: number; v: number[]; hold: boolean; key: Key }[] = []
  for (const key of clip.keys) {
    for (const j of Object.keys(key.pose) as Joint[]) prev[j] = [...(key.pose[j] as Vec3)] as Vec3
    if (key.pinch !== undefined) pinch = key.pinch
    const v: number[] = []
    for (const j of JOINTS) v.push(prev[j][0], prev[j][1], prev[j][2])
    v.push(pinch)
    raw.push({ t: key.t, v, hold: key.hold === true || key.ease === 'inout', key })
  }
  const tracks: Track[] = []
  for (let i = 0; i < raw.length; i++) {
    const k = raw[i]
    const next = raw[i + 1]
    const before = raw[i - 1]
    if (k.key.ease === 'overshoot' && before) {
      const dt = Math.min(OVERSHOOT_S, 0.4 * (k.t - before.t))
      const v = k.v.map((x, c) => (c === PINCH ? x : x + OVERSHOOT_FRAC * (x - before.v[c])))
      tracks.push({ t: k.t - dt, v, hold: false, m: [] })
    }
    tracks.push({ t: k.t, v: k.v, hold: k.hold, m: [] })
    if (k.key.ease === 'anticipate' && next) {
      const dt = Math.min(ANTICIPATE_S, 0.3 * (next.t - k.t))
      const v = k.v.map((x, c) => {
        const d = next.v[c] - x
        return c === PINCH || Math.abs(d) < 0.05 ? x : x - ANTICIPATE_RAD * Math.sign(d)
      })
      tracks.push({ t: k.t + dt, v, hold: false, m: [] })
    }
  }
  for (let i = 0; i < tracks.length; i++) {
    const k = tracks[i]
    const a = tracks[i - 1]
    const b = tracks[i + 1]
    k.m = k.v.map((x, c) => {
      if (k.hold || !a || !b) return 0
      const d0 = x - a.v[c]
      const d1 = b.v[c] - x
      if (d0 * d1 <= 0) return 0 // extremum or flat: stop, don't wiggle
      return (b.v[c] - a.v[c]) / (b.t - a.t)
    })
  }
  return tracks
}

const cache = new WeakMap<Clip, Track[]>()

/** Cubic Hermite between two keys with per-second tangents (the non-uniform Catmull–Rom form). */
export function hermite(p0: number, m0: number, p1: number, m1: number, u: number, span: number): number {
  const u2 = u * u
  const u3 = u2 * u
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * span * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * span * m1
}

/** Uniform Catmull–Rom on four equally spaced samples (u in [0, 1] between p1 and p2). */
export function catmull1(p0: number, p1: number, p2: number, p3: number, u: number): number {
  return hermite(p1, (p2 - p0) / 2, p2, (p3 - p1) / 2, u, 1)
}

export function breathAt(clip: Clip, time: number): number {
  const hz = clip.breathHz ?? 0.22
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * hz * time)
}

export function sample(clip: Clip, t: number, speed = 1): Sample {
  let tracks = cache.get(clip)
  if (!tracks) {
    tracks = expand(clip)
    cache.set(clip, tracks)
  }
  let time = t * speed
  if (clip.loop) time = ((time % clip.duration) + clip.duration) % clip.duration
  else time = Math.max(0, Math.min(clip.duration, time))

  let i = 0
  while (i < tracks.length - 1 && tracks[i + 1].t <= time) i++
  const a = tracks[i]
  const b = tracks[Math.min(i + 1, tracks.length - 1)]
  const span = b.t - a.t
  const u = span > 0 ? Math.min(1, (time - a.t) / span) : 0
  const v = a.v.map((x, c) => (span > 0 ? hermite(x, a.m[c], b.v[c], b.m[c], u, span) : x))
  const angles = restAngles()
  JOINTS.forEach((j, k) => {
    angles[j] = [v[k * 3], v[k * 3 + 1], v[k * 3 + 2]]
  })

  let step = 1
  let caption = ''
  let target: CueTarget | null = null
  let carry: Carry | null = null
  let parked = 0
  let segStart: Key | null = null
  for (const k of clip.keys) {
    if (k.t > time + 1e-9) break
    if (k.step !== undefined) step = k.step
    if (k.caption !== undefined) caption = k.caption
    if (k.target !== undefined) {
      target = k.target
      segStart = k.target && !k.landed ? k : null
    }
    if (k.carry !== undefined) carry = k.carry
    if (k.parked !== undefined) parked = k.parked
  }
  let segment: [number, number] | null = null
  if (segStart) {
    const start = segStart
    const arrive = clip.keys.find((k) => k.t > start.t && k.landed)
    if (arrive) segment = [start.t, arrive.t]
  }
  return {
    angles,
    pinch: Math.min(1, Math.max(0, v[PINCH])),
    breath: breathAt(clip, time),
    progress: clip.duration ? time / clip.duration : 0,
    step,
    caption,
    t: time,
    target,
    carry,
    parked,
    segment,
  }
}

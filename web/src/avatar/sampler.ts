import type { Clip, Key } from './clips'
import { JOINTS, type Angles, type Joint, type Vec3, restAngles } from './rig'

export type Sample = { angles: Angles; progress: number; step: number; caption: string; t: number }

/** Keys with partial poses are expanded so every key carries every joint (inheriting the previous key). */
function expand(clip: Clip): { t: number; angles: Angles; key: Key }[] {
  const out: { t: number; angles: Angles; key: Key }[] = []
  let prev = restAngles()
  for (const key of clip.keys) {
    const angles = { ...prev } as Angles
    for (const j of Object.keys(key.pose) as Joint[]) angles[j] = [...(key.pose[j] as Vec3)] as Vec3
    out.push({ t: key.t, angles, key })
    prev = angles
  }
  return out
}

const cache = new WeakMap<Clip, ReturnType<typeof expand>>()
const smooth = (u: number) => u * u * (3 - 2 * u)

export function sample(clip: Clip, t: number, speed = 1): Sample {
  const keys = cache.get(clip) ?? (cache.set(clip, expand(clip)), cache.get(clip)!)
  let time = t * speed
  if (clip.loop) time = ((time % clip.duration) + clip.duration) % clip.duration
  else time = Math.max(0, Math.min(clip.duration, time))
  let i = 0
  while (i < keys.length - 1 && keys[i + 1].t <= time) i++
  const a = keys[i]
  const b = keys[Math.min(i + 1, keys.length - 1)]
  const span = b.t - a.t
  const u = span > 0 ? smooth((time - a.t) / span) : 0
  const angles = restAngles()
  for (const j of JOINTS) {
    angles[j] = [0, 1, 2].map((k) => a.angles[j][k] + (b.angles[j][k] - a.angles[j][k]) * u) as Vec3
  }
  let step = 1
  let caption = ''
  for (const k of keys) {
    if (k.t <= time + 1e-9 && k.key.step !== undefined) {
      step = k.key.step
      caption = k.key.caption ?? caption
    }
  }
  return { angles, progress: clip.duration ? time / clip.duration : 0, step, caption, t: time }
}

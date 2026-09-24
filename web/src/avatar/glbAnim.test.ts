/** Animation contract for the Blender-built avatar (`web/blender/animate.py` → `praxis_avatar.glb`
 *  + `praxis_avatar.meta.json`). The GLB is sampled and posed here by an independent reader
 *  (`src/test/glb.ts`), so these checks do not trust Blender's own bookkeeping:
 *  - the real-motion clips reproduce the upper-arm and forearm directions of the web app's own
 *    clips after the 90° ceiling (`REHAB_JSON`, scaled in TypeScript), so the Blender and web
 *    implementations of that rule are checked against each other (glTF's frame is the rig.ts frame);
 *  - no standing clip lifts the upper arm past the ceiling;
 *  - the cup lands on the dot and each peg in the hole the caption names;
 *  - every action loops without a jump, and the sidecar agrees with the GLB. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Glb, angleDeg, len, sub, unit, type V3 } from '../test/glb'
import { AVATAR_ELEVATION_CEILING_DEG, REHAB_JSON } from './rehabClips'
import { pacedActionTime, parseAvatarMeta } from './glbActions'

const DIR = resolve(__dirname, '../../public/avatar')
const glb = new Glb(resolve(DIR, 'praxis_avatar.glb'))
type Target = { t: number; kind: 'dot' | 'hole'; index: number; landed?: boolean }
type ActionMeta = { ceiling_deg?: number; scaled_from_deg?: number; duration: number; loop: boolean; camera: 'front' | 'side'; props: string[]; rep: [number, number]; steps: { t: number; step: number; caption: string }[]; targets: Target[]; seated: boolean }
const meta = JSON.parse(readFileSync(resolve(DIR, 'praxis_avatar.meta.json'), 'utf8')) as { fps: number; actions: Record<string, ActionMeta> }

const ACTIONS = ['idle', 'pendulum', 'flexion', 'abduction', 'external_rotation', 'internal_rotation', 'waiter_cup', 'nhpt']
const FPS = meta.fps
const atFrame = (t: number) => Math.round(t * FPS) / FPS
const at = (w: Map<string, V3>, n: string): V3 => {
  const p = w.get(n)
  if (!p) throw new Error(`missing node ${n}`)
  return p
}
const horiz = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[2] - b[2])

test('the GLB carries exactly the eight actions, and the sidecar matches it', () => {
  expect((glb.json.animations ?? []).map((a) => a.name).sort()).toEqual([...ACTIONS].sort())
  expect(Object.keys(meta.actions).sort()).toEqual([...ACTIONS].sort())
  for (const n of ACTIONS) {
    const m = meta.actions[n]
    expect(Math.abs(glb.duration(n) - m.duration), n).toBeLessThan(1.5 / FPS)
    expect(m.rep[0]).toBeGreaterThanOrEqual(0)
    expect(m.rep[1]).toBeGreaterThan(m.rep[0])
    expect(m.rep[1]).toBeLessThanOrEqual(m.duration)
    expect(m.steps.length).toBeGreaterThan(0)
    for (let i = 1; i < m.steps.length; i++) {
      expect(m.steps[i].t).toBeGreaterThanOrEqual(m.steps[i - 1].t)
      expect(m.steps[i].step).toBeGreaterThan(m.steps[i - 1].step)
    }
    for (const s of m.steps) expect(s.caption.length).toBeGreaterThan(5)
  }
})

test('postures match the instructions: table tasks and the "Sit tall" exercises seated, pendulum standing', () => {
  expect(meta.actions.waiter_cup).toMatchObject({ seated: true, camera: 'front' })
  expect(meta.actions.waiter_cup.props).toEqual(expect.arrayContaining(['table', 'sheet', 'cup']))
  expect(meta.actions.nhpt.props).toEqual(expect.arrayContaining(['table', 'pegboard']))
  for (const n of ['flexion', 'abduction', 'external_rotation', 'internal_rotation']) {
    expect(meta.actions[n].seated, n).toBe(true)
    expect(meta.actions[n].props, n).toEqual(['chair'])
  }
  for (const n of ['idle', 'pendulum']) {
    expect(meta.actions[n].seated, n).toBe(false)
    expect(meta.actions[n].props, n).toEqual([])
  }
})

const rehab = (n: 'flexion' | 'abduction' | 'external_rotation' | 'internal_rotation') => REHAB_JSON[n]

test.each(['flexion', 'abduction', 'external_rotation', 'internal_rotation'] as const)(
  '%s reproduces the web clip\'s upper-arm and forearm directions at every key (< 1.5°)',
  (name) => {
    const clip = rehab(name)
    expect(meta.actions[name].camera).toBe(clip.camera)
    const keys = clip.keys.filter((k) => k.check)
    expect(keys.length).toBeGreaterThan(8)
    for (const k of keys) {
      const w = glb.world(name, atFrame(k.t))
      const ua = sub(at(w, 'forearm_L'), at(w, 'upper_arm_L'))
      const fa = sub(at(w, 'hand_L'), at(w, 'forearm_L'))
      expect(angleDeg(ua, k.check!.ua), `${name} ua t=${k.t}`).toBeLessThan(1.5)
      expect(angleDeg(fa, k.check!.fa), `${name} fa t=${k.t}`).toBeLessThan(1.5)
    }
  },
)

test.each(['idle', 'pendulum', 'flexion', 'abduction', 'external_rotation', 'internal_rotation'])(
  '%s never lifts the upper arm past the 90° ceiling (torso-relative, sampled every frame)',
  (name) => {
    let peak = 0
    for (let f = 0; f <= Math.round(glb.duration(name) * FPS); f++) {
      const w = glb.world(name, f / FPS)
      const up = unit(sub(at(w, 'neck'), at(w, 'chest')))
      const ua = unit(sub(at(w, 'forearm_L'), at(w, 'upper_arm_L')))
      peak = Math.max(peak, angleDeg(ua, [-up[0], -up[1], -up[2]]))
    }
    expect(peak).toBeLessThan(AVATAR_ELEVATION_CEILING_DEG + 1.5)
    if (name === 'flexion' || name === 'abduction') {
      expect(peak).toBeGreaterThan(AVATAR_ELEVATION_CEILING_DEG - 3) // it does reach shoulder height
      expect(meta.actions[name]).toMatchObject({ ceiling_deg: 90 })
    }
  },
)

test('Waiter – cup: the cup is set down on the dot each step names, in order 2 → 5 → 1', () => {
  const landed = meta.actions.waiter_cup.targets.filter((t) => t.landed)
  expect(landed.map((t) => t.index)).toEqual([2, 3, 4, 5, 4, 3, 2, 1])
  for (const tg of landed) {
    const w = glb.world('waiter_cup', atFrame(tg.t))
    const cup = at(w, 'prop_cup')
    const dot = at(w, `anchor_dot_${tg.index}`)
    expect(horiz(cup, dot), `dot ${tg.index} at ${tg.t}s`).toBeLessThan(0.003)
    expect(Math.abs(cup[1] - dot[1])).toBeLessThan(0.003)
    expect(len(sub(at(w, 'hand_L'), cup)), 'hand stays on the cup').toBeLessThan(0.16)
  }
})

test('Waiter – cup: between dots the cup is lifted clear of the sheet', () => {
  const heading = meta.actions.waiter_cup.targets.filter((t) => !t.landed)
  for (const tg of heading) {
    const w = glb.world('waiter_cup', atFrame(tg.t + 0.4))
    expect(at(w, 'prop_cup')[1] - at(w, 'anchor_dot_1')[1]).toBeGreaterThan(0.02)
  }
})

test('NHPT: every peg starts in the dish and is seated upright in its own hole', () => {
  const start = glb.world('nhpt', 0)
  for (let k = 1; k <= 9; k++) {
    for (let h = 1; h <= 9; h++) expect(horiz(at(start, `prop_peg_${k}`), at(start, `anchor_hole_${h}`))).toBeGreaterThan(0.02)
  }
  const landed = meta.actions.nhpt.targets.filter((t) => t.landed)
  expect(landed.map((t) => t.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  const end = glb.world('nhpt', atFrame(landed[8].t) + 2 / FPS)
  for (const tg of landed) {
    const w = glb.world('nhpt', atFrame(tg.t) + 1 / FPS)
    for (const ww of [w, end]) {
      const peg = at(ww, `prop_peg_${tg.index}`)
      const hole = at(ww, `anchor_hole_${tg.index}`)
      expect(horiz(peg, hole), `peg ${tg.index}`).toBeLessThan(0.003)
      expect(peg[1] - hole[1]).toBeGreaterThan(0)       // stands proud of the board
      expect(peg[1] - hole[1]).toBeLessThan(0.016)      // but sits in the hole
    }
  }
})

test.each(ACTIONS)('%s loops without a jump (every joint within 5 mm of its first-frame position)', (name) => {
  const a = glb.world(name, 0)
  const b = glb.world(name, glb.duration(name))
  for (const bone of ['head', 'chest', 'hand_L', 'hand_R', 'forearm_L', 'foot_L', 'foot_R']) {
    expect(len(sub(at(a, bone), at(b, bone))), `${name} ${bone}`).toBeLessThan(0.005)
  }
})

test.each(['waiter_cup', 'nhpt'])('%s: every prop is back where it started when the loop restarts', (name) => {
  const a = glb.world(name, 0)
  const b = glb.world(name, glb.duration(name))
  const props = name === 'nhpt' ? Array.from({ length: 9 }, (_, i) => `prop_peg_${i + 1}`) : ['prop_cup']
  for (const p of props) expect(len(sub(at(a, p), at(b, p))), p).toBeLessThan(0.002)
})

test('seated actions put the pelvis on the chair seat and the feet on the floor', () => {
  for (const n of ['waiter_cup', 'nhpt', 'flexion', 'abduction', 'external_rotation', 'internal_rotation']) {
    const w = glb.world(n, 1)
    expect(at(w, 'hips')[1], `${n} hips`).toBeGreaterThan(0.5)
    expect(at(w, 'hips')[1]).toBeLessThan(0.7)
    expect(at(w, 'foot_L')[1]).toBeLessThan(0.12)
  }
})

// ---------------------------------------------------------------------------------------------
// Hands: three-phalanx digits; tips are the exporter's `<bone>_leaf` nodes.
// capsule radius per phalanx (larger end), as in web/blender/animate.py PHALANX_R
const PHALANX_R: Record<string, number> = {
  thumb: 0.0135, thumb_2: 0.0118, thumb_3: 0.0104,
  index: 0.0086, index_2: 0.008, index_3: 0.0074,
  middle: 0.0088, middle_2: 0.0082, middle_3: 0.0076,
  ring: 0.0082, ring_2: 0.0077, ring_3: 0.0071,
  little: 0.0072, little_2: 0.0067, little_3: 0.0062,
}
const DIGIT_NAMES = ['thumb', 'index', 'middle', 'ring', 'little']
const phalanges = (d: string) => [d, `${d}_2`, `${d}_3`]
const DIGIT_R: Record<string, number> = Object.fromEntries(Object.entries(PHALANX_R).map(([k, v]) => [`${k}_L`, v]))
/** Phalanx k of a digit as a segment: its joint node to the next joint (or the fingertip leaf). */
function segment(w: Map<string, V3>, bone: string, side: 'L' | 'R'): [V3, V3] {
  const [d, n] = bone.includes('_') ? [bone.split('_')[0], Number(bone.split('_')[1])] : [bone, 1]
  const next = n === 3 ? `${d}_3_${side}_leaf` : `${d}_${n + 1}_${side}`
  return [at(w, `${bone}_${side}`), at(w, next)]
}
function segDist(p1: V3, q1: V3, p2: V3, q2: V3): number {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2)
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), c = dot(d1, r), b = dot(d1, d2)
  const den = a * e - b * b
  let s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0
  let t = e > 1e-12 ? (b * s + f) / e : 0
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)) } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)) }
  return len(sub([p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s], [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t]))
}
const PAD_GAP = 0.008 + 0.007 + 0.009 // peg diameter + index and thumb tip radii

test('NHPT: thumb and index tips pinch each peg pad to pad, with the peg between them', () => {
  const tg = meta.actions.nhpt.targets
  const picks = tg.filter((t) => !t.landed)
  const seats = tg.filter((t) => t.landed)
  expect(picks).toHaveLength(9)
  for (const [t, k] of [...picks.map((p) => [atFrame(p.t), p.index] as const), ...seats.map((p) => [atFrame(p.t - 0.15), p.index] as const)]) {
    const w = glb.world('nhpt', t)
    const it = at(w, 'index_3_L_leaf')
    const tt = at(w, 'thumb_3_L_leaf')
    expect(Math.abs(len(sub(it, tt)) - PAD_GAP), `tips apart, peg ${k} t=${t}`).toBeLessThan(0.0025)
    const mid: V3 = [(it[0] + tt[0]) / 2, (it[1] + tt[1]) / 2, (it[2] + tt[2]) / 2]
    // the pads meet the peg on its upper half: its centre sits 4 mm below the pad midpoint
    expect(len(sub([mid[0], mid[1] - 0.004, mid[2]], at(w, `prop_peg_${k}`))), `peg ${k} between the pads`).toBeLessThan(0.003)
  }
})

test('NHPT: no part of the hand goes into the board or the dish at any frame (fingertip pads may touch)', () => {
  const rest = glb.world()
  const top = at(rest, 'anchor_hole_1')[1]
  const board = at(rest, 'prop_pegboard')
  const dish = [board[0] + 0.068, board[2]]
  const surface = (x: number, z: number) => {
    const r = Math.hypot(x - dish[0], z - dish[1])
    return r < 0.052 ? top + 0.004 - 0.016 * Math.sqrt(1 - (r / 0.052) ** 2) : top
  }
  let worst = Infinity
  for (let f = 0; f <= Math.round(glb.duration('nhpt') * FPS); f++) {
    const w = glb.world('nhpt', f / FPS)
    for (const [bone, r] of Object.entries(DIGIT_R)) {
      const p = at(w, bone)
      worst = Math.min(worst, p[1] - r - surface(p[0], p[2]))
    }
    for (const tipNode of ['index_3_L_leaf', 'thumb_3_L_leaf', 'middle_3_L_leaf', 'ring_3_L_leaf', 'little_3_L_leaf']) {
      const p = at(w, tipNode)
      const r = DIGIT_R[tipNode.replace('_leaf', '')]
      worst = Math.min(worst, p[1] - r - surface(p[0], p[2]) + (/^(index|thumb)/.test(tipNode) ? 0.006 : 0))
    }
  }
  expect(worst).toBeGreaterThan(-0.0015)
})

test('Waiter – cup: the fingers wrap the cup without going through it', () => {
  for (const tg of meta.actions.waiter_cup.targets.filter((t) => t.landed)) {
    const w = glb.world('waiter_cup', atFrame(tg.t))
    const cup = at(w, 'prop_cup')
    for (const n of ['index_3_L_leaf', 'middle_3_L_leaf', 'ring_3_L_leaf', 'little_3_L_leaf', 'thumb_3_L_leaf', 'index_2_L', 'middle_2_L']) {
      const p = at(w, n)
      const fromAxis = Math.hypot(p[0] - cup[0], p[2] - cup[2])
      expect(fromAxis, `${n} dot ${tg.index}`).toBeGreaterThan(0.03) // outside the cup wall
      expect(fromAxis, `${n} dot ${tg.index}`).toBeLessThan(0.075) // but on it, not in the air
    }
  }
})

test.each(ACTIONS)('%s: no two digits of either hand touch at any frame (fingers stay separate)', (name) => {
  let worst = Infinity
  let where = ''
  for (let f = 0; f <= Math.round(glb.duration(name) * FPS); f += 2) {
    const w = glb.world(name, f / FPS)
    for (const side of ['L', 'R'] as const) {
      for (let i = 0; i < DIGIT_NAMES.length; i++) {
        for (let j = i + 1; j < DIGIT_NAMES.length; j++) {
          for (const a of phalanges(DIGIT_NAMES[i])) {
            for (const b of phalanges(DIGIT_NAMES[j])) {
              const gap = segDist(...segment(w, a, side), ...segment(w, b, side)) - PHALANX_R[a] - PHALANX_R[b]
              if (gap < worst) { worst = gap; where = `${a}/${b}_${side} f${f}` }
            }
          }
        }
      }
    }
  }
  expect(worst, where).toBeGreaterThan(-0.0005)
})

test.each(['flexion', 'abduction'])(
  '%s: paced by the service rep_progress, the figure is as far up as the patient (lift/lower by angle, still at the top while holding)',
  (name) => {
    const am = parseAvatarMeta(meta).actions[name]
    expect(am.pace).toBeTruthy()
    const elev = (t: number) => {
      const w = glb.world(name, t)
      const up = unit(sub(at(w, 'neck'), at(w, 'chest')))
      return angleDeg(sub(at(w, 'forearm_L'), at(w, 'upper_arm_L')), [-up[0], -up[1], -up[2]])
    }
    const lo = elev(pacedActionTime(am, 0))
    const hi = elev(pacedActionTime(am, 0.4))
    expect(hi).toBeGreaterThan(AVATAR_ELEVATION_CEILING_DEG - 3)
    const frac = (p: number) => (elev(pacedActionTime(am, p)) - lo) / (hi - lo)
    // service: lift 0..0.4 proportional to the patient's angle, hold 0.4..0.8, lower 0.8..1 by angle
    for (const p of [0.1, 0.2, 0.3]) expect(Math.abs(frac(p) - p / 0.4), `lift p=${p}`).toBeLessThan(0.06)
    for (const p of [0.45, 0.6, 0.75]) expect(frac(p), `hold p=${p}`).toBeGreaterThan(0.95)
    for (const p of [0.85, 0.9, 0.95]) expect(Math.abs(frac(p) - (1 - (p - 0.8) / 0.2)), `lower p=${p}`).toBeLessThan(0.06)
  },
)

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

test('seated table tasks show their props; standing exercises show none', () => {
  expect(meta.actions.waiter_cup).toMatchObject({ seated: true, camera: 'front' })
  expect(meta.actions.waiter_cup.props).toEqual(expect.arrayContaining(['table', 'sheet', 'cup']))
  expect(meta.actions.nhpt.props).toEqual(expect.arrayContaining(['table', 'pegboard']))
  for (const n of ['idle', 'pendulum', 'flexion', 'abduction', 'external_rotation', 'internal_rotation']) {
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

test('seated actions put the pelvis on the chair seat and the feet on the floor', () => {
  for (const n of ['waiter_cup', 'nhpt']) {
    const w = glb.world(n, 1)
    expect(at(w, 'hips')[1], `${n} hips`).toBeGreaterThan(0.5)
    expect(at(w, 'hips')[1]).toBeLessThan(0.7)
    expect(at(w, 'foot_L')[1]).toBeLessThan(0.12)
  }
})

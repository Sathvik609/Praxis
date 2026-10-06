/** The demonstration script for the three exercises left after the 28 Sep lock: one source of
 *  truth for the step text (player caption and the Demonstration step list), and for Arm out to
 *  the side a phase-aware time warp so the GLB's 2.7 s rep plays at the prescribed pace. The warp
 *  is checked against the arm's real elevation in the shipped GLB, not against its own table. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Glb, angleDeg, sub } from '../test/glb'
import { parseAvatarMeta } from './glbActions'
import { advanceScriptClock, buildScript, paceTimeAt, scriptAt, scriptCaption, stepAtActionTime, stepTexts, stepTextsForClip } from './script'

const DIR = resolve(__dirname, '../../public/avatar')
const glb = new Glb(resolve(DIR, 'praxis_avatar.glb'))
const meta = parseAvatarMeta(JSON.parse(readFileSync(resolve(DIR, 'praxis_avatar.meta.json'), 'utf8')))

/** Upper-arm elevation of the practising (left) arm at action time t, as a fraction of its range. */
const elev = (t: number) => {
  const w = glb.world('abduction', t)
  return angleDeg(sub(w.get('forearm_L')!, w.get('upper_arm_L')!), [0, -1, 0])
}
const lo = Math.min(...Array.from({ length: 55 }, (_, i) => elev(i * 0.05)))
const hi = Math.max(...Array.from({ length: 55 }, (_, i) => elev(i * 0.05)))
const frac = (t: number) => (elev(t) - lo) / (hi - lo)

describe('Arm out to the side plays at the prescribed pace', () => {
  for (const holdS of [3, 2]) {
    test(`raise ≈ 3 s, hold = ${holdS} s, lower ≈ 3 s, short rest (±0.2 s)`, () => {
      const s = buildScript('abduction', meta.actions.abduction, { holdS })!
      const dt = 0.01
      const f: number[] = []
      let prev = -1
      for (let tau = 0; tau < s.total; tau += dt) {
        const t = scriptAt(s, tau).time
        f.push(frac(t))
        // monotonic through the rep (the only wrap is at the end of the loop)
        expect(t).toBeGreaterThanOrEqual(prev - 1e-9)
        prev = t
      }
      const top = f.findIndex((x) => x >= 0.97)
      const leave = f.findIndex((x, i) => i > top && x < 0.97)
      const down = f.findIndex((x, i) => i > leave && x <= 0.01)
      let start = top
      while (start > 0 && f[start - 1] > 0.01) start--
      const raise = (top - start) * dt
      const hold = (leave - top) * dt
      const lower = (down - leave) * dt
      const rest = s.total - raise - hold - lower
      expect(raise).toBeGreaterThan(2.8)
      expect(raise).toBeLessThan(3.2)
      expect(hold).toBeGreaterThan(holdS - 0.2)
      expect(hold).toBeLessThan(holdS + 0.2)
      expect(lower).toBeGreaterThan(2.8)
      expect(lower).toBeLessThan(3.2)
      expect(rest).toBeGreaterThan(0.8)
      expect(rest).toBeLessThan(2.6)
    })
  }

  test('the captions follow the phases: sit, lift, hold, lower, and back to sit for the rest', () => {
    const s = buildScript('abduction', meta.actions.abduction, { holdS: 3 })!
    expect(scriptAt(s, 0.2).step).toBe(1)
    expect(scriptAt(s, 2.5).step).toBe(2)
    expect(scriptAt(s, 5.5).step).toBe(3)
    expect(scriptAt(s, 8.5).step).toBe(4)
    expect(scriptAt(s, s.total - 0.2).step).toBe(1)
    expect(scriptAt(s, s.total + 2.5).step).toBe(2) // loops
  })

  test('Slower scales the warped clock; paced (camera) mode leaves it alone', () => {
    const s = buildScript('abduction', meta.actions.abduction, { holdS: 3 })!
    const clock = { time: 0, playing: true, speed: 0.5, warp: 0 }
    advanceScriptClock(clock, 2, s, meta.actions.abduction)
    expect(clock.warp).toBeCloseTo(1)
    const paced = { time: 0, playing: true, speed: 1, warp: 3, target: 1.5 }
    advanceScriptClock(paced, 0.1, s, meta.actions.abduction)
    expect(paced.warp).toBe(3)
    expect(paced.time).toBeGreaterThan(0) // eases toward the patient's rep, in action time
    expect(stepAtActionTime(s, 0.4)).toBe(2)
    expect(stepAtActionTime(s, 1.0)).toBe(3)
    expect(stepAtActionTime(s, 1.6)).toBe(4)
    expect(stepAtActionTime(s, 2.5)).toBe(1)
  })
})

describe('one source of truth for the step text', () => {
  test('the player caption and the step list are the same steps, same count, same numbering', () => {
    for (const action of ['abduction', 'waiter_cup', 'nhpt'] as const) {
      const s = buildScript(action, meta.actions[action], { holdS: 3 })!
      const texts = stepTexts(action, { holdS: 3 })!
      expect(s.steps).toEqual(texts)
      const seen = new Set(s.segments.map((g) => g.step))
      expect([...seen].sort()).toEqual(texts.map((_, i) => i + 1)) // every step is shown, none extra
      for (let k = 1; k <= texts.length; k++) expect(scriptCaption(s, k)).toBe(`Step ${k} of ${texts.length} · ${texts[k - 1]}`)
    }
  })

  test('Arm out to the side says palm down everywhere (the figure turns the palm down at the top)', () => {
    const texts = stepTexts('abduction', { holdS: 3 })!
    expect(texts.join(' ')).toMatch(/palm down/)
    expect(texts.join(' ')).not.toMatch(/palm forward|palm up/)
    expect(texts).toHaveLength(4)
    expect(texts[2]).toMatch(/Hold for 3 s/)
    expect(stepTexts('abduction', { holdS: 2 })![2]).toMatch(/Hold for 2 s/)
  })

  test('the cup and peg steps follow the animation: every caption change lines up with the motion', () => {
    const cup = buildScript('waiter_cup', meta.actions.waiter_cup, {})!
    expect(cup.steps).toHaveLength(5)
    expect(cup.total).toBeCloseTo(meta.actions.waiter_cup.duration)
    expect(scriptAt(cup, 0.5).step).toBe(1) // hand resting beside the cup
    expect(scriptAt(cup, 1.5).step).toBe(2) // taking hold
    expect(scriptAt(cup, 5).step).toBe(3) // out to dot 5
    expect(scriptAt(cup, 10).step).toBe(4) // back to dot 1
    expect(scriptAt(cup, 15).step).toBe(5) // let go, rest
    const peg = buildScript('nhpt', meta.actions.nhpt, {})!
    expect(peg.steps).toHaveLength(4)
    expect(scriptAt(peg, 0.3).step).toBe(1)
    expect(scriptAt(peg, 1.2).step).toBe(2)
    expect(scriptAt(peg, 10).step).toBe(3)
    expect(scriptAt(peg, 20).step).toBe(4)
    for (const s of [cup, peg]) for (let tau = 0; tau < s.total; tau += 0.1) expect(scriptAt(s, tau).time).toBeCloseTo(tau) // 1×, no warp
  })

  test('app clip names map to the same texts; other exercises keep their own (null)', () => {
    expect(stepTextsForClip('cup', {})).toEqual(stepTexts('waiter_cup', {}))
    expect(stepTextsForClip('abduction', { holdS: 2 })).toEqual(stepTexts('abduction', { holdS: 2 }))
    expect(stepTextsForClip('nhpt', {})).toEqual(stepTexts('nhpt', {}))
    expect(stepTextsForClip('armFront', {})).toBeNull()
    expect(stepTextsForClip('pendulum', {})).toBeNull()
  })

  test('no opening freeze longer than ~2 s at 1× (cup and pegs start moving at once)', () => {
    for (const action of ['waiter_cup', 'nhpt'] as const) {
      const s = buildScript(action, meta.actions[action], {})!
      const hand = (t: number) => glb.world(action, t).get('middle_L')!
      const p0 = hand(scriptAt(s, 0).time)
      let tau = 0
      while (tau < 3 && Math.hypot(...sub(hand(scriptAt(s, tau).time), p0)) < 0.01) tau += 0.05
      expect(tau, action).toBeLessThan(2)
    }
  })
})

describe('a gentle-day limit caps the demonstration (design v2 limitDeg)', () => {
  test('limitDeg 60 says "up to 60°" and holds at 60°, above 85 keeps "shoulder height"', () => {
    const t60 = stepTexts('abduction', { holdS: 3, limitDeg: 60 })!
    expect(t60[1]).toMatch(/up to 60°/)
    expect(t60[2]).toMatch(/Hold for 3 s at 60°/)
    const t90 = stepTexts('abduction', { holdS: 3, limitDeg: 90 })!
    expect(t90[1]).toMatch(/up to shoulder height/)
    expect(t90[2]).toMatch(/at shoulder height/)
  })

  test('the hold clip time maps to peak_deg scaled to 60° and the figure stops near 60°', () => {
    const am = meta.actions.abduction
    expect(am.pace?.peak_deg).toBeGreaterThan(80)
    expect(am.pace?.rest_deg).toBeLessThan(20)
    const s = buildScript('abduction', am, { holdS: 3, limitDeg: 60 })!
    const hold = s.segments.find((x) => x.step === 3)!
    const f = (60 - am.pace!.rest_deg!) / (am.pace!.peak_deg! - am.pace!.rest_deg!)
    expect(hold.from).toBeCloseTo(paceTimeAt(am, 'lift', f))
    expect(hold.to).toBe(hold.from)
    const lower = s.segments.find((x) => x.step === 4)!
    expect(lower.from).toBeCloseTo(paceTimeAt(am, 'lower', f))
    // the real arm in the GLB is below the full-range top at the hold
    expect(frac(hold.from)).toBeLessThan(0.85)
    expect(frac(hold.from)).toBeGreaterThan(0.4)
    // no limit (or at the ceiling) keeps the full-range hold
    const full = buildScript('abduction', am, { holdS: 3 })!
    expect(full.segments.find((x) => x.step === 3)!.from).toBe(am.pace!.hold[0])
  })

  test('paceTimeAt is monotonic in u (later on the way up, earlier on the way down)', () => {
    const am = meta.actions.abduction
    let up = -Infinity
    let down = Infinity
    for (let u = 0; u <= 1.0001; u += 0.05) {
      const a = paceTimeAt(am, 'lift', Math.min(1, u))
      const b = paceTimeAt(am, 'lower', Math.min(1, u))
      expect(a).toBeGreaterThanOrEqual(up - 1e-9)
      expect(b).toBeLessThanOrEqual(down + 1e-9)
      up = a
      down = b
    }
  })
})

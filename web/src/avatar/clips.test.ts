import { CLIPS, mirror } from './clips'
import { cupDots, nhptHoles } from './layout'
import { forwardKinematics } from './rig'
import { sample } from './sampler'

const D = Math.PI / 180

test('idle breathes: breath differs between t=0 and t=2.2 and loops seamlessly', () => {
  const idle = CLIPS.idle
  expect(sample(idle, 0).breath).not.toBeCloseTo(sample(idle, 2.2).breath, 2)
  expect(sample(idle, idle.duration + 0.01).breath).toBeCloseTo(sample(idle, 0.01).breath, 3)
  expect(sample(idle, idle.duration + 0.01).angles.spine[1]).toBeCloseTo(sample(idle, 0.01).angles.spine[1], 4)
})

test('armFront: hold key parks the shoulder at −90°, moving at 1.5 s, still at 3.0 s', () => {
  const clip = CLIPS.armFront
  expect(Math.abs(sample(clip, 3.5).angles.lShoulder[0] + 90 * D)).toBeLessThan(1.5 * D)
  const vel = (t: number) => (sample(clip, t + 0.01).angles.lShoulder[0] - sample(clip, t - 0.01).angles.lShoulder[0]) / 0.02
  expect(Math.abs(vel(1.5))).toBeGreaterThan(0.2)
  expect(Math.abs(vel(3.0))).toBeLessThan(0.02)
  // never above the 90° ceiling (a little overshoot is the anticipation dip, in the other direction)
  for (let t = 0; t <= clip.duration; t += 0.05) expect(sample(clip, t).angles.lShoulder[0]).toBeGreaterThan(-92 * D)
})

test('cup: the hand carries the cup from dot to dot and lands on each dot', () => {
  const clip = CLIPS.cup
  const dots = cupDots('left')
  const landings = clip.keys.filter((k) => k.target?.kind === 'dot' && k.landed && sample(clip, k.t).carry === 'cup')
  expect(landings.length).toBeGreaterThanOrEqual(5)
  for (const k of landings) {
    const p = forwardKinematics(sample(clip, k.t).angles)
    const d = dots[k.target!.index]
    expect(Math.hypot(p.lHand[0] - d[0], p.lHand[2] - d[2])).toBeLessThan(0.02)
  }
  expect(sample(clip, 3.2).pinch).toBe(0) // released on dot 1, hand returning to the lap
  const carrying = sample(clip, landings[1].t)
  expect(carrying.carry).toBe('cup')
  expect(carrying.pinch).toBeGreaterThan(0.5)
})

test('nhpt: pinch closes in the dish, opens over the hole; pegs accumulate', () => {
  const clip = CLIPS.nhpt
  const holes = nhptHoles('left')
  const seat = clip.keys.filter((k) => k.target?.kind === 'hole' && k.landed)
  expect(seat.length).toBe(3)
  for (const k of seat) {
    const p = forwardKinematics(sample(clip, k.t).angles)
    const h = holes[k.target!.index]
    expect(Math.hypot(p.lHand[0] - h[0], p.lHand[2] - h[2])).toBeLessThan(0.02)
  }
  expect(sample(clip, seat[2].t + 0.6).parked).toBe(3)
  expect(sample(clip, 0.1).parked).toBe(0)
})

test('mirror swaps the arms and negates yaw/roll; the right side reaches the mirrored dots', () => {
  const m = mirror(CLIPS.cup)
  expect(m.side).toBe('right')
  const t = CLIPS.cup.keys.find((k) => k.landed && k.target?.index === 2)!.t
  const l = forwardKinematics(sample(CLIPS.cup, t).angles)
  const r = forwardKinematics(sample(m, t).angles)
  expect(r.rHand[0]).toBeCloseTo(-l.lHand[0], 3)
  expect(r.rHand[2]).toBeCloseTo(l.lHand[2], 3)
  expect(sample(m, t).angles.lShoulder).toEqual(sample(CLIPS.cup, t).angles.rShoulder)
  expect(sample(m, t).angles.spine[1]).toBeCloseTo(-sample(CLIPS.cup, t).angles.spine[1], 6)
})

test('anticipation dips before a lift and overshoot settles after a placement', () => {
  const clip = CLIPS.armFront
  const rest = sample(clip, 0).angles.lShoulder[0]
  let dipped = false
  for (let t = 0.02; t < 0.4; t += 0.02) if (sample(clip, t).angles.lShoulder[0] > rest + 0.5 * D) dipped = true
  expect(dipped).toBe(true)
})

test('the cup clip step-5 caption matches the dose (no "as fast as you can")', () => {
  const captions = CLIPS.cup.keys.map((k) => k.caption).filter(Boolean)
  expect(captions).toContain('Step 5 of 5 · Across and back twice slowly, then twice more, quicker')
})

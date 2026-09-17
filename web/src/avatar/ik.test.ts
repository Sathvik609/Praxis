import { solveArm } from './ik'
import { cupDots, nhptDish, nhptHoles } from './layout'
import { forwardKinematics, restAngles, type Vec3 } from './rig'

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

test('the left hand reaches every cup dot and every peg hole within 4 mm', () => {
  const targets: Vec3[] = [...cupDots('left'), ...nhptHoles('left'), nhptDish('left')].map(([x, y, z]) => [x, y + 0.05, z])
  for (const t of targets) {
    const angles = solveArm(restAngles(), 'left', t)
    const p = forwardKinematics(angles)
    expect(dist(p.lHand, t)).toBeLessThan(0.004)
    expect(angles.lElbow[0]).toBeLessThanOrEqual(0) // flexion only
    expect(p.lElbow[1]).toBeLessThan(p.lShoulder[1]) // elbow stays below the shoulder on a table reach
    expect((p.lElbow[0] / 0.26) ** 2 + (p.lElbow[2] / 0.17) ** 2).toBeGreaterThan(1) // and outside the torso
  }
})

test('the right arm mirrors: reaching a mirrored target gives mirrored angles', () => {
  const t: Vec3 = [-0.12, 1.07, 0.3]
  const l = solveArm(restAngles(), 'left', [0.12, 1.07, 0.3])
  const r = solveArm(restAngles(), 'right', t)
  expect(r.rShoulder[0]).toBeCloseTo(l.lShoulder[0], 1)
  expect(r.rShoulder[1]).toBeCloseTo(-l.lShoulder[1], 1)
  expect(r.rShoulder[2]).toBeCloseTo(-l.lShoulder[2], 1)
  expect(r.rElbow[0]).toBeCloseTo(l.lElbow[0], 1)
  expect(r.lShoulder).toEqual([0, 0, 0]) // the other arm is untouched
})

test('unreachable targets end at full extension toward the target without throwing', () => {
  const angles = solveArm(restAngles(), 'left', [1.5, 1.3, 1.5])
  const p = forwardKinematics(angles)
  expect(dist(p.lShoulder, p.lHand)).toBeGreaterThan(0.58)
})

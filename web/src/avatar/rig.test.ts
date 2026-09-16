import { JOINTS, REST, forwardKinematics, restAngles } from './rig'

test('rest pose: head above hips, wrists below shoulders, arms symmetric', () => {
  const p = forwardKinematics(restAngles())
  expect(p.head[1]).toBeGreaterThan(p.hips[1])
  expect(p.lWrist[1]).toBeLessThan(p.lShoulder[1])
  expect(p.rWrist[1]).toBeLessThan(p.rShoulder[1])
  expect(Math.abs(p.lShoulder[0] + p.rShoulder[0])).toBeLessThan(1e-6)
  expect(JOINTS.every((j) => j in REST)).toBe(true)
})

test('raising the left shoulder pitch brings the wrist forward and up', () => {
  const a = restAngles()
  a.lShoulder = [-Math.PI / 2, 0, 0]
  const p = forwardKinematics(a)
  expect(p.lWrist[2]).toBeGreaterThan(p.lShoulder[2] + 0.3)
  expect(Math.abs(p.lWrist[1] - p.lShoulder[1])).toBeLessThan(0.05)
})

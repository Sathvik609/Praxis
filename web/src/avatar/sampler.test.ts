import { CLIPS } from './clips'
import { forwardKinematics } from './rig'
import { sample } from './sampler'

test('armFront reaches shoulder height at its peak key and returns at the end', () => {
  const clip = CLIPS.armFront
  const peakT = clip.keys.reduce((best, k) => ((k.pose.lShoulder?.[0] ?? 0) < (best.pose.lShoulder?.[0] ?? 0) ? k : best), clip.keys[0]).t
  const peak = forwardKinematics(sample(clip, peakT).angles)
  expect(Math.abs(peak.lWrist[1] - peak.lShoulder[1])).toBeLessThan(0.06)
  const end = forwardKinematics(sample(clip, clip.duration).angles)
  expect(end.lWrist[1]).toBeLessThan(end.lShoulder[1] - 0.3)
})

test('idle loops and interpolation is continuous', () => {
  const idle = CLIPS.idle
  const a = sample(idle, idle.duration + 0.1).angles
  const b = sample(idle, 0.1).angles
  expect(a.spine[0]).toBeCloseTo(b.spine[0], 6)
  const c = sample(CLIPS.cup, 1.0).angles
  const d = sample(CLIPS.cup, 1.01).angles
  expect(Math.abs(c.lShoulder[0] - d.lShoulder[0])).toBeLessThan(0.05)
})

test('cup clip walks its five steps in order with captions', () => {
  const clip = CLIPS.cup
  const steps = new Set<number>()
  for (let t = 0; t <= clip.duration; t += 0.05) steps.add(sample(clip, t).step)
  expect([...steps]).toEqual([1, 2, 3, 4, 5])
  expect(sample(clip, 0).caption).toMatch(/Step 1 of 5/)
  expect(sample(clip, clip.duration / 2, 0.5).progress).toBeLessThan(sample(clip, clip.duration / 2).progress)
})

test('every clip declares a camera and at least two keys', () => {
  for (const clip of Object.values(CLIPS)) {
    expect(['front', 'side']).toContain(clip.camera)
    expect(clip.keys.length).toBeGreaterThanOrEqual(2)
    expect(clip.keys[0].t).toBe(0)
  }
})

import * as THREE from 'three'
import type { ArcCue } from './clips'
import { REHAB_CLIPS } from './rehabClips'
import { BONES, forwardKinematicsFull, restAngles } from './rig'
import { sample } from './sampler'
import { arcAngle, arcBasis, makeSkeletonFigure } from './skeleton'

const D = Math.PI / 180

test('skeleton joints sit on the forward kinematics and bones span their joints (no WebGL needed)', () => {
  const fig = makeSkeletonFigure()
  const angles = restAngles()
  angles.lShoulder = [-60 * D, 0.1, 0.2]
  angles.lElbow = [-50 * D, 0, 0]
  const fk = forwardKinematicsFull(angles)
  fig.update({ angles, pinch: 0, breath: 0 })
  const v = (a: [number, number, number]) => new THREE.Vector3(...a)
  expect(fig.joints.lWrist.position.distanceTo(v(fk.pos.lWrist))).toBeLessThan(1e-6)
  expect(fig.joints.head.position.distanceTo(v(fk.pos.head))).toBeLessThan(1e-6)
  expect(fig.silhouette.position.distanceTo(v(fk.pos.hips))).toBeLessThan(1e-6)
  BONES.forEach(([a, b], i) => {
    const mid = v(fk.pos[a]).add(v(fk.pos[b])).multiplyScalar(0.5)
    expect(fig.bones[i].position.distanceTo(mid)).toBeLessThan(1e-6)
    expect(fig.bones[i].scale.y).toBeCloseTo(v(fk.pos[a]).distanceTo(v(fk.pos[b])), 6)
  })
  const sil = fig.silhouette.material as THREE.MeshBasicMaterial
  expect(sil.opacity).toBeCloseTo(0.12, 6)
  expect(sil.transparent).toBe(true)
  fig.dispose()
})

test('the elevation arc reads 0° at rest and ~90° with the left arm out to the side; the target arc is dashed amber', () => {
  const arc: ArcCue = { kind: 'elevation', joint: 'lShoulder', child: 'lElbow', targetDeg: 90, peakDir: [1, 0, 0], startDir: [0, -1, 0] }
  const fig = makeSkeletonFigure()
  const rest = restAngles()
  fig.update({ angles: rest, pinch: 0, breath: 0 }, { arc, focus: 'lShoulder', time: 0 })
  expect(fig.currentDeg()!).toBeLessThan(8) // the rest upper arm is 5° off vertical
  const up = restAngles()
  up.lShoulder = [0, 0, 90 * D]
  fig.update({ angles: up, pinch: 0, breath: 0 }, { arc, focus: 'lShoulder', time: 0.3 })
  expect(Math.abs(fig.currentDeg()! - 90)).toBeLessThan(6)
  const { pos, rot } = forwardKinematicsFull(up)
  const { e0, e1 } = arcBasis(arc, pos, rot)
  expect(Math.abs(arcAngle(arc, pos, e0, e1) - fig.currentDeg()!)).toBeLessThan(1e-6)
  let dashes = 0
  let amber = 0
  fig.arcGroup.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      dashes += 1
      if ((m.material as THREE.MeshBasicMaterial).color.getHex() === 0xc97f14) amber += 1
    }
  })
  expect(dashes).toBeGreaterThan(10)
  expect(amber).toBeGreaterThan(5)
  fig.dispose()
})

test('every rehab clip drives the skeleton without a WebGL context and the arc tracks the clip', () => {
  const fig = makeSkeletonFigure()
  for (const clip of Object.values(REHAB_CLIPS)) {
    let maxDeg = -Infinity
    for (let t = 0; t <= clip.duration; t += 0.1) {
      const s = sample(clip, t)
      fig.update({ angles: s.angles, pinch: s.pinch, breath: s.breath }, { arc: clip.arc, focus: clip.focusJoint, time: t })
      maxDeg = Math.max(maxDeg, fig.currentDeg()!)
    }
    expect(maxDeg).toBeGreaterThan(clip.arc!.targetDeg - 8)
  }
  fig.dispose()
})

import { advanceClock } from './scene'

test('a paced clock eases toward the target time instead of free-running', () => {
  const clip = { duration: 4, loop: true }
  const clock: import('./scene').Clock = { time: 0, playing: true, speed: 1, target: 2 }
  advanceClock(clock, 0.1, clip)
  expect(clock.time).toBeGreaterThan(0)
  expect(clock.time).toBeLessThan(2)
  for (let i = 0; i < 100; i++) advanceClock(clock, 0.1, clip)
  expect(clock.time).toBeCloseTo(2, 2)
  clock.target = null
  advanceClock(clock, 0.5, clip)
  expect(clock.time).toBeCloseTo(2.5, 5)
})

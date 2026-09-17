import * as THREE from 'three'
import { makeFigure } from './figure'
import { forwardKinematicsFull, restAngles } from './rig'

test('figure parts follow the forward kinematics: torso at the hips, hands at the wrists, limbs between joints', () => {
  const fig = makeFigure()
  const angles = restAngles()
  angles.lShoulder = [-Math.PI / 3, 0.2, 0]
  angles.lElbow = [-0.8, 0, 0]
  const fk = forwardKinematicsFull(angles)
  fig.update({ angles, pinch: 0, breath: 0 })
  const v = (a: [number, number, number]) => new THREE.Vector3(...a)
  expect(fig.torso.position.distanceTo(v(fk.pos.hips))).toBeLessThan(1e-6)
  expect(fig.left.hand.group.position.distanceTo(v(fk.pos.lWrist))).toBeLessThan(1e-6)
  expect(fig.right.hand.group.position.distanceTo(v(fk.pos.rWrist))).toBeLessThan(1e-6)
  const mid = v(fk.pos.lElbow).add(v(fk.pos.lWrist)).multiplyScalar(0.5)
  expect(fig.left.forearm.position.distanceTo(mid)).toBeLessThan(1e-6)
  // the mitt points along the forearm toward the hand joint
  const tip = fig.left.hand.group.localToWorld(new THREE.Vector3(0, -0.09, 0))
  expect(tip.distanceTo(v(fk.pos.lHand))).toBeLessThan(1e-4)
})

test('every body mesh casts a shadow and breath scales the torso', () => {
  const fig = makeFigure()
  fig.group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !(o.userData.decor as boolean)) expect(o.castShadow).toBe(true)
  })
  fig.update({ angles: restAngles(), pinch: 0, breath: 0 })
  const s0 = fig.torso.scale.x
  fig.update({ angles: restAngles(), pinch: 0, breath: 1 })
  expect(fig.torso.scale.x).toBeGreaterThan(s0)
  fig.dispose()
})

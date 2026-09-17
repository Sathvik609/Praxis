import * as THREE from 'three'
import { PLINTH_DEPTH, makeContourLines, makeForearm, makeHand, makeJoint, makePlinth, makeShoulderCap, makeTorso, makeUpperArm, torsoProfile } from './body'
import { REST } from './rig'

test('torso profile: 17 control points from pelvis to crown, monotone in y, radii >= 0', () => {
  const p = torsoProfile()
  expect(p).toHaveLength(17)
  for (let i = 1; i < p.length; i++) expect(p[i].y).toBeGreaterThanOrEqual(p[i - 1].y)
  for (const v of p) expect(v.x).toBeGreaterThanOrEqual(0)
  expect(p[0].y).toBeCloseTo(-0.05, 6) // pelvis bottom sits 5 cm under the hips joint
  expect(p[p.length - 1].x).toBe(0) // closed crown
  expect(p[p.length - 1].y).toBeGreaterThan(REST.head.offset[1] + REST.neck.offset[1] + REST.spine.offset[1]) // crown above the head joint
})

test('torso lathe is one seamless mesh, flattened front-to-back, with sane bounds', () => {
  const torso = makeTorso()
  expect(torso.geometry.getAttribute('position').count).toBeGreaterThan(1000)
  torso.geometry.computeBoundingBox()
  const b = torso.geometry.boundingBox!
  expect(b.min.y).toBeCloseTo(-0.05, 2)
  expect(b.max.y).toBeGreaterThan(0.75)
  expect(b.max.x).toBeGreaterThan(0.23)
  expect(b.max.z).toBeLessThan(b.max.x) // chest is shallower than it is wide
  expect(torso.castShadow).toBe(true)
})

test('limb builders produce meshes with the requested length along y', () => {
  for (const mk of [makeUpperArm, makeForearm]) {
    const m = mk(0.3)
    m.geometry.computeBoundingBox()
    const b = m.geometry.boundingBox!
    expect(b.max.y - b.min.y).toBeCloseTo(0.3, 3)
    expect(b.max.x).toBeLessThan(0.08)
  }
  expect(makeJoint(0.05).geometry).toBeInstanceOf(THREE.SphereGeometry)
  expect(makeShoulderCap().geometry).toBeInstanceOf(THREE.SphereGeometry)
})

test('hand is a mitt plus a thumb and closes with the pinch scalar', () => {
  const hand = makeHand()
  expect(hand.group.children).toHaveLength(2)
  hand.setPinch(0)
  const open = hand.mitt.scale.y
  hand.setPinch(1)
  expect(hand.mitt.scale.y).toBeLessThan(open)
  expect(hand.mitt.scale.y).toBeGreaterThan(0.5)
})

test('contour lines are faint additive tubes on the front of the chest', () => {
  const g = makeContourLines()
  expect(g.children.length).toBeGreaterThanOrEqual(3)
  for (const c of g.children) {
    const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial
    expect(m.transparent).toBe(true)
    expect(m.opacity).toBeLessThan(0.5)
    ;(c as THREE.Mesh).geometry.computeBoundingBox()
    expect((c as THREE.Mesh).geometry.boundingBox!.min.z).toBeGreaterThan(0)
  }
})

test('plinth reaches from under the pelvis down to the stage floor', () => {
  const m = makePlinth()
  m.geometry.computeBoundingBox()
  expect(m.geometry.boundingBox!.min.y).toBeCloseTo(-PLINTH_DEPTH, 6)
  expect(m.geometry.boundingBox!.max.y).toBeLessThan(0)
  expect(m.receiveShadow).toBe(true)
})

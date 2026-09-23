import * as THREE from 'three'
import { CLIPS } from './clips'
import { framingPreset } from './framing'
import { cameraPreset } from './scene'

const hand = new THREE.Vector3(0.3, 1.1, 0.2)
const same = (a: { eye: THREE.Vector3; look: THREE.Vector3 }, b: { eye: THREE.Vector3; look: THREE.Vector3 }) => {
  expect(a.eye.distanceTo(b.eye)).toBeLessThan(1e-9)
  expect(a.look.distanceTo(b.look)).toBeLessThan(1e-9)
}

test('the procedural presets are unchanged: cameraPreset is framingPreset on the clip', () => {
  for (const clip of Object.values(CLIPS)) {
    for (const camera of ['front', 'side'] as const) {
      for (const compact of [false, true]) {
        for (const closeUp of [false, true]) {
          same(
            cameraPreset({ clip, camera, closeUp, compact }, hand),
            framingPreset({ camera, closeUp, compact, side: clip.side, hasTable: clip.props.includes('table'), tall: !!clip.arc }, hand),
          )
        }
      }
    }
  }
})

test('preset values are pinned (Home compact front 2.25 m at 1.36; tall side 2.55 m from the practising side)', () => {
  const home = framingPreset({ camera: 'front', closeUp: false, compact: true, side: 'left', hasTable: false, tall: false }, hand)
  expect(home.eye.toArray()).toEqual([0.08, expect.closeTo(1.48), 2.25])
  expect(home.look.toArray()).toEqual([0, 1.36, 0.05])
  const side = framingPreset({ camera: 'side', closeUp: false, compact: false, side: 'left', hasTable: false, tall: true }, hand)
  expect(side.eye.toArray()).toEqual([2.55, expect.closeTo(1.52), 0.2])
  expect(side.look.toArray()).toEqual([0, expect.closeTo(1.4), 0.16])
})

test('yShift lowers the whole framing (eye and look) for a lower table, but not the hand close-up', () => {
  const base = { camera: 'front' as const, closeUp: false, compact: true, side: 'left' as const, hasTable: true, tall: false }
  const a = framingPreset(base, hand)
  const b = framingPreset({ ...base, yShift: -0.28 }, hand)
  expect(b.eye.y).toBeCloseTo(a.eye.y - 0.28)
  expect(b.look.y).toBeCloseTo(a.look.y - 0.28)
  expect(b.eye.z).toBeCloseTo(a.eye.z)
  same(framingPreset({ ...base, closeUp: true }, hand), framingPreset({ ...base, closeUp: true, yShift: -0.28 }, hand))
})

test('the side camera sits on the practising side', () => {
  const f = { camera: 'side' as const, closeUp: false, compact: false, hasTable: false, tall: true }
  expect(framingPreset({ ...f, side: 'left' }, hand).eye.x).toBeGreaterThan(1)
  expect(framingPreset({ ...f, side: 'right' }, hand).eye.x).toBeLessThan(-1)
})

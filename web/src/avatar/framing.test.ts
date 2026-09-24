import * as THREE from 'three'
import { CLIPS } from './clips'
import { fitFraming, framingPreset } from './framing'
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

describe('fitFraming keeps the whole sampled box in frame', () => {
  const boxes = {
    standing: { min: new THREE.Vector3(-0.35, 0.02, -0.25), max: new THREE.Vector3(0.95, 1.8, 0.4) },
    seated: { min: new THREE.Vector3(-0.35, 0.45, -0.2), max: new THREE.Vector3(0.35, 1.4, 0.5) },
  }
  for (const [kind, box] of Object.entries(boxes)) {
    for (const camera of ['front', 'side'] as const) {
      for (const aspect of [0.8, 1.6]) {
        test(`${kind} · ${camera} · aspect ${aspect}`, () => {
          const { eye, look } = fitFraming(box, camera, 'left', aspect, 34, kind === 'seated' ? 22 : 6)
          const cam = new THREE.PerspectiveCamera(34, aspect, 0.05, 50)
          cam.position.copy(eye)
          cam.lookAt(look)
          cam.updateMatrixWorld(true)
          let edge = 0
          for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
            const ndc = new THREE.Vector3(x, y, z).project(cam)
            expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1)
            expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1)
            edge = Math.max(edge, Math.abs(ndc.x), Math.abs(ndc.y))
          }
          expect(edge).toBeGreaterThan(0.8) // tight: the figure fills the frame, not a speck
        })
      }
    }
  }
})

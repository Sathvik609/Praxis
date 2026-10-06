/** The real `praxis_avatar.glb` through three's own GLTFLoader, SkeletonUtils clone and
 *  AnimationMixer, on the CPU (no WebGL in jsdom): what the stage will draw, checked without a GPU. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as THREE from 'three'
import { GLB_ACTIONS, pacedActionTime } from './glbActions'
import { AvatarInstance, loadAvatarAsset, parseAvatarGlb, resetAvatarAssetForTests, type AvatarAsset } from './glbAsset'

const DIR = resolve(__dirname, '../../public/avatar')
const bytes = readFileSync(resolve(DIR, 'praxis_avatar.glb'))
const metaJson = JSON.parse(readFileSync(resolve(DIR, 'praxis_avatar.meta.json'), 'utf8'))
// a fresh ArrayBuffer from this realm (GLTFLoader checks `instanceof ArrayBuffer`; Buffer's pool is Node's)
const buffer = () => {
  const ab = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(ab).set(bytes)
  return ab
}

let asset: AvatarAsset
beforeAll(async () => {
  asset = await parseAvatarGlb(buffer(), metaJson)
})

const pos = (inst: AvatarInstance, name: string) => inst.worldPosition(name, new THREE.Vector3())
const visibleProps = (inst: AvatarInstance) => inst.propNames().filter((n) => inst.node(n)!.visible).sort()

test('the GLB parses with all eight actions and the sidecar', () => {
  expect(asset.animations.map((a) => a.name).sort()).toEqual([...GLB_ACTIONS].sort())
  expect(Object.keys(asset.meta.actions).sort()).toEqual([...GLB_ACTIONS].sort())
})

test('a GLB missing an action is rejected, so the panel falls back to the procedural figure', async () => {
  const meta = { ...metaJson, actions: { ...metaJson.actions, extra_move: metaJson.actions.idle } }
  await expect(parseAvatarGlb(buffer(), meta)).rejects.toThrow(/extra_move/)
  await expect(parseAvatarGlb(new ArrayBuffer(8), metaJson)).rejects.toBeTruthy()
})

test('props are visible exactly per meta.props for every action', () => {
  const inst = new AvatarInstance(asset)
  const pegs = Array.from({ length: 9 }, (_, i) => `prop_peg_${i + 1}`)
  const expected: Record<string, string[]> = {
    idle: [],
    pendulum: [],
    // the "Sit tall" exercises are shown seated on the chair
    flexion: ['prop_chair'],
    abduction: ['prop_chair'],
    external_rotation: ['prop_chair'],
    internal_rotation: ['prop_chair'],
    waiter_cup: ['prop_chair', 'prop_cup', 'prop_sheet', 'prop_table'],
    nhpt: ['prop_chair', 'prop_pegboard', ...pegs, 'prop_table'].sort(),
  }
  for (const a of GLB_ACTIONS) {
    inst.setAction(a)
    expect(visibleProps(inst), a).toEqual(expected[a])
  }
  inst.dispose()
})

test('the mixer poses the figure at the paced time: flexion lifts the elbow, lowering brings it back', () => {
  const inst = new AvatarInstance(asset)
  const m = inst.setAction('flexion')
  inst.setTime(pacedActionTime(m, 0))
  const low = pos(inst, 'forearm_L').y
  const peakT = m.steps.find((s) => s.step === 2)!.t
  inst.setTime(peakT)
  const high = pos(inst, 'forearm_L').y
  expect(high - low).toBeGreaterThan(0.15)
  inst.setTime(pacedActionTime(m, 1))
  expect(Math.abs(pos(inst, 'forearm_L').y - low)).toBeLessThan(0.05)
  inst.dispose()
})

test('switching actions stops the previous one (only one action drives the rig)', () => {
  const inst = new AvatarInstance(asset)
  inst.setAction('nhpt')
  inst.setAction('abduction')
  expect(inst.runningActions()).toEqual(['abduction'])
  inst.dispose()
})

test('the right side mirrors the model: the practising arm moves to the figure-right (−x)', () => {
  const inst = new AvatarInstance(asset)
  inst.setAction('idle')
  inst.setTime(0)
  expect(pos(inst, 'upper_arm_L').x).toBeGreaterThan(0.1)
  inst.setSide('right')
  inst.setTime(0)
  expect(pos(inst, 'upper_arm_L').x).toBeLessThan(-0.1)
  inst.dispose()
})

test('seated actions put the figure at the table; the sheet anchors are on the table top', () => {
  const inst = new AvatarInstance(asset)
  const m = inst.setAction('waiter_cup')
  inst.setTime(m.rep[0])
  const sheet = pos(inst, 'prop_sheet')
  expect(sheet.y).toBeGreaterThan(0.6)
  expect(sheet.y).toBeLessThan(0.9)
  expect(pos(inst, 'anchor_dot_3').y).toBeCloseTo(sheet.y, 2)
  expect(pos(inst, 'hips').y).toBeLessThan(0.8) // sitting, not standing at 1.0
  inst.dispose()
})

test('loadAvatarAsset caches one load and forgets a failed one so a later mount can retry', async () => {
  resetAvatarAssetForTests()
  const fail = vi.fn(() => Promise.reject(new Error('offline')))
  await expect(loadAvatarAsset(fail)).rejects.toThrow('offline')
  const ok = vi.fn(() => Promise.resolve(asset))
  const a = await loadAvatarAsset(ok)
  const b = await loadAvatarAsset(ok)
  expect(a).toBe(asset)
  expect(b).toBe(asset)
  expect(ok).toHaveBeenCalledTimes(1)
  resetAvatarAssetForTests()
})

const matNamed = (inst: AvatarInstance, name: string) => {
  let found: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial | null = null
  inst.root.traverse((o) => {
    const m = (o as THREE.Mesh).material
    for (const x of Array.isArray(m) ? m : m ? [m] : []) if (x.name === name) found = x as THREE.MeshStandardMaterial
  })
  if (!found) throw new Error(`no material ${name}`)
  return found as THREE.MeshStandardMaterial
}

test('design v2 look: the figure is white in the light theme and cool blue-white in the dark theme (runtime override, no rebake)', async () => {
  const own = await parseAvatarGlb(buffer(), metaJson) // fresh materials, not shared with the other tests
  delete document.documentElement.dataset.theme
  const light = new AvatarInstance(own)
  expect(matNamed(light, 'mannequin_shell').color.getHex()).toBe(new THREE.Color(0xffffff).getHex())
  expect(matNamed(light, 'mannequin_joint').color.getHex()).toBe(new THREE.Color(0xf6f6f4).getHex())
  document.documentElement.dataset.theme = 'dark'
  try {
    const dark = new AvatarInstance(own)
    expect(matNamed(dark, 'mannequin_shell').color.getHex()).toBe(new THREE.Color(0xdce6f8).getHex())
    expect(matNamed(dark, 'mannequin_shell').emissive.getHex()).toBe(new THREE.Color(0x0a1a40).getHex())
    expect(matNamed(dark, 'mannequin_joint').color.getHex()).toBe(new THREE.Color(0xb9ccf2).getHex())
  } finally {
    delete document.documentElement.dataset.theme
  }
})

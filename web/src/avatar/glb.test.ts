/** Contract test for the Blender-built avatar (`web/blender/build_avatar.py` → `public/avatar/praxis_avatar.glb`).
 *  CI has no Blender, so this parses the committed GLB by hand (12-byte header, then the JSON chunk)
 *  and checks what the app and the animation step rely on: bone and prop node names, the skin,
 *  size budgets, the rig.ts coordinate contract (metres, y up, faces +z, figure's left = +x) and the
 *  metric sheet / pegboard anchors from board_spec.py. */
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const GLB_PATH = resolve(__dirname, '../../public/avatar/praxis_avatar.glb')

type Node = {
  name?: string
  children?: number[]
  mesh?: number
  skin?: number
  translation?: [number, number, number]
  rotation?: [number, number, number, number]
  scale?: [number, number, number]
}
type Gltf = {
  nodes: Node[]
  meshes: { name?: string; primitives: { indices?: number; mode?: number; attributes: Record<string, number> }[] }[]
  skins: { joints: number[] }[]
  accessors: { count: number; min?: number[]; max?: number[] }[]
  scenes: { nodes: number[] }[]
}

function readGltfJson(path: string): Gltf {
  const buf = readFileSync(path)
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB (magic)')
  if (buf.readUInt32LE(4) !== 2) throw new Error('not glTF 2.0')
  if (buf.readUInt32LE(8) !== buf.length) throw new Error('GLB length mismatch')
  const chunkLength = buf.readUInt32LE(12)
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error('first chunk is not JSON')
  return JSON.parse(buf.subarray(20, 20 + chunkLength).toString('utf8')) as Gltf
}

type V3 = [number, number, number]
type M4 = number[] // column-major 4x4

function compose(n: Node): M4 {
  const [tx, ty, tz] = n.translation ?? [0, 0, 0]
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = n.scale ?? [1, 1, 1]
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ]
}
function mul(a: M4, b: M4): M4 {
  const r = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) r[c * 4 + row] += a[k * 4 + row] * b[c * 4 + k]
  return r
}

/** World-space position of every named node in the default scene (rest pose). */
function worldPositions(g: Gltf): Map<string, V3> {
  const out = new Map<string, V3>()
  const walk = (i: number, parent: M4) => {
    const m = mul(parent, compose(g.nodes[i]))
    if (g.nodes[i].name) out.set(g.nodes[i].name!, [m[12], m[13], m[14]])
    for (const c of g.nodes[i].children ?? []) walk(c, m)
  }
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  for (const r of g.scenes[0].nodes) walk(r, identity)
  return out
}

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

const SIDES = ['L', 'R'] as const
const BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head',
  ...SIDES.flatMap((s) =>
    ['clavicle', 'upper_arm', 'forearm', 'hand', 'thumb', 'thumb_2', 'thumb_3', ...['index', 'middle', 'ring', 'little'].flatMap((f) => [f, `${f}_2`, `${f}_3`]), 'thigh', 'shin', 'foot'].map((b) => `${b}_${s}`),
  ),
]
const PROPS = ['prop_chair', 'prop_table', 'prop_cup', 'prop_sheet', 'prop_pegboard', ...Array.from({ length: 9 }, (_, i) => `prop_peg_${i + 1}`)]

const gltf = readGltfJson(GLB_PATH)
const names = gltf.nodes.map((n) => n.name ?? '')
const world = worldPositions(gltf)
const at = (name: string): V3 => {
  const p = world.get(name)
  if (!p) throw new Error(`missing node ${name}`)
  return p
}

test('GLB stays under 2 MB', () => {
  expect(statSync(GLB_PATH).size).toBeLessThan(2 * 1024 * 1024)
})

test('every required bone is a node and a joint of the body skin', () => {
  const body = gltf.nodes.find((n) => n.name === 'body')
  expect(body?.mesh).toBeDefined()
  expect(body?.skin).toBeDefined()
  const joints = new Set(gltf.skins[body!.skin!].joints.map((j) => gltf.nodes[j].name))
  for (const b of BONES) {
    expect(names, b).toContain(b)
    expect(joints.has(b), `${b} in skin`).toBe(true)
  }
})

test('bone and prop names survive GLTFLoader sanitising and are unique', () => {
  for (const n of [...BONES, ...PROPS]) expect(n).toMatch(/^[A-Za-z0-9_]+$/)
  const named = names.filter(Boolean)
  expect(new Set(named).size).toBe(named.length)
})

test('all prop nodes exist', () => {
  for (const p of PROPS) expect(names, p).toContain(p)
})

test('body mesh is under 30k triangles', () => {
  const body = gltf.nodes.find((n) => n.name === 'body')!
  const tris = gltf.meshes[body.mesh!].primitives.reduce((sum, p) => {
    expect(p.mode ?? 4).toBe(4)
    const count = p.indices !== undefined ? gltf.accessors[p.indices].count : gltf.accessors[p.attributes.POSITION].count
    return sum + count / 3
  }, 0)
  expect(tris).toBeGreaterThan(5000)
  expect(tris).toBeLessThan(30000)
})

test('body geometry stays inside a standing adult (catches runaway or misplaced pieces)', () => {
  const body = gltf.nodes.find((n) => n.name === 'body')!
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const p of gltf.meshes[body.mesh!].primitives) {
    const { min, max } = gltf.accessors[p.attributes.POSITION]
    expect(min && max).toBeTruthy()
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], min![i])
      hi[i] = Math.max(hi[i], max![i])
    }
  }
  // bind-pose vertices in metres, over the whole body: |x| within the arms at rest, feet on the
  // floor, head top between 1.65 and 1.85 m, nothing far in front of or behind the figure
  expect(Math.max(Math.abs(lo[0]), Math.abs(hi[0]))).toBeLessThan(0.35)
  expect(lo[1]).toBeGreaterThan(-0.02)
  expect(hi[1]).toBeLessThan(1.85)
  expect(hi[1]).toBeGreaterThan(1.65)
  expect(Math.max(Math.abs(lo[2]), Math.abs(hi[2]))).toBeLessThan(0.25)
})

test('body has a shell and a joint material, both ceramic (no metal)', () => {
  const g = gltf as unknown as { materials: { name?: string; pbrMetallicRoughness?: { metallicFactor?: number } }[] }
  const body = gltf.nodes.find((n) => n.name === 'body')!
  const mats = gltf.meshes[body.mesh!].primitives.map((p) => g.materials[(p as { material?: number }).material!])
  expect(mats.map((m) => m.name).sort()).toEqual(['mannequin_joint', 'mannequin_shell'])
  for (const m of mats) expect(m.pbrMetallicRoughness?.metallicFactor ?? 1).toBe(0)
})

test('rest pose matches the rig.ts contract: metres, y up, left = +x, arms at the sides', () => {
  const near = (name: string, want: V3, tol = 0.02) => expect(dist(at(name), want), name).toBeLessThan(tol)
  near('hips', [0, 1.0, 0])
  for (const [s, x] of [['L', 1], ['R', -1]] as const) {
    near(`upper_arm_${s}`, [0.225 * x, 1.41, 0])
    near(`forearm_${s}`, [0.25 * x, 1.14, 0])
    near(`hand_${s}`, [0.25 * x, 0.89, 0])
  }
  expect(at('upper_arm_L')[0]).toBeGreaterThan(0)
  expect(at('head')[1]).toBeGreaterThan(1.55)
})

test('the figure faces +z: thumbs point forward of the wrists at rest', () => {
  expect(at('thumb_L')[2]).toBeGreaterThan(at('hand_L')[2] + 0.01)
  expect(at('thumb_R')[2]).toBeGreaterThan(at('hand_R')[2] + 0.01)
})

test('table is in front of the figure and the chair behind the table', () => {
  expect(at('prop_table')[2]).toBeGreaterThan(0.15)
  expect(at('prop_chair')[2]).toBeLessThan(at('prop_table')[2])
})

test('cup sheet dots reproduce board_spec: 250 mm arc, ±26°, dot 1 on the patient-left (+x)', () => {
  const dots = [1, 2, 3, 4, 5].map((k) => at(`anchor_dot_${k}`))
  const rad = (d: number) => (d * Math.PI) / 180
  expect(dist(dots[0], dots[4])).toBeCloseTo(2 * 0.25 * Math.sin(rad(26)), 3)
  for (let k = 0; k < 4; k++) expect(dist(dots[k], dots[k + 1])).toBeCloseTo(2 * 0.25 * Math.sin(rad(6.5)), 3)
  expect(dots[0][0]).toBeGreaterThan(dots[4][0])
  expect(dots[2][2]).toBeGreaterThan(dots[0][2])
  for (const d of dots) expect(d[1]).toBeCloseTo(dots[0][1], 4)
})

test('pegboard holes sit on a 3 × 3 grid at 32 mm pitch', () => {
  const h = Array.from({ length: 9 }, (_, i) => at(`anchor_hole_${i + 1}`))
  for (const [a, b] of [[0, 1], [1, 2], [0, 3], [3, 6], [4, 5], [4, 7]]) expect(dist(h[a], h[b])).toBeCloseTo(0.032, 4)
  expect(dist(h[0], h[8])).toBeCloseTo(0.032 * 2 * Math.SQRT2, 4)
})

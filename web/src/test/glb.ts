/** Minimal glTF 2.0 binary reader for tests: parses a GLB, samples its animations and runs forward
 *  kinematics over the node tree, so the avatar's animation contract can be checked in CI without
 *  Blender or a WebGL context. Only what `praxis_avatar.glb` uses: float accessors, LINEAR / STEP
 *  samplers, translation / rotation / scale channels. */
import { readFileSync } from 'node:fs'

export type V3 = [number, number, number]
type Q = [number, number, number, number]
type M4 = number[] // column-major

export type GltfNode = { name?: string; children?: number[]; mesh?: number; skin?: number; translation?: V3; rotation?: Q; scale?: V3 }
type Accessor = { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }
type Sampler = { input: number; output: number; interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE' }
type Channel = { sampler: number; target: { node: number; path: 'translation' | 'rotation' | 'scale' | 'weights' } }
export type Gltf = {
  nodes: GltfNode[]
  scenes: { nodes: number[] }[]
  accessors: Accessor[]
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[]
  animations?: { name?: string; samplers: Sampler[]; channels: Channel[] }[]
  meshes: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[]
  materials?: { name?: string; pbrMetallicRoughness?: { metallicFactor?: number } }[]
  skins: { joints: number[] }[]
}

const WIDTH: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

export class Glb {
  readonly json: Gltf
  private bin: Buffer
  private byName = new Map<string, number>()

  constructor(path: string) {
    const buf = readFileSync(path)
    if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')
    const jsonLen = buf.readUInt32LE(12)
    this.json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as Gltf
    const binStart = 20 + jsonLen
    const binLen = buf.readUInt32LE(binStart)
    this.bin = buf.subarray(binStart + 8, binStart + 8 + binLen)
    this.json.nodes.forEach((n, i) => n.name && this.byName.set(n.name, i))
  }

  node(name: string): number {
    const i = this.byName.get(name)
    if (i === undefined) throw new Error(`no node ${name}`)
    return i
  }

  /** Float accessor as an array of tuples. */
  read(index: number): number[][] {
    const a = this.json.accessors[index]
    if (a.componentType !== 5126) throw new Error(`accessor ${index}: only float supported`)
    const view = this.json.bufferViews[a.bufferView!]
    const w = WIDTH[a.type]
    const stride = view.byteStride ?? w * 4
    const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0)
    const out: number[][] = []
    for (let i = 0; i < a.count; i++) {
      const row: number[] = []
      for (let c = 0; c < w; c++) row.push(this.bin.readFloatLE(base + i * stride + c * 4))
      out.push(row)
    }
    return out
  }

  animation(name: string) {
    const a = this.json.animations?.find((x) => x.name === name)
    if (!a) throw new Error(`no animation ${name}`)
    return a
  }

  duration(name: string): number {
    const a = this.animation(name)
    return Math.max(...a.samplers.map((s) => this.json.accessors[s.input].max?.[0] ?? 0))
  }

  /** Local TRS overrides of every animated node at time t (clamped to the sampler's range). */
  sample(name: string, t: number): Map<number, Partial<Pick<GltfNode, 'translation' | 'rotation' | 'scale'>>> {
    const out = new Map<number, Partial<Pick<GltfNode, 'translation' | 'rotation' | 'scale'>>>()
    for (const ch of this.animation(name).channels) {
      if (ch.target.path === 'weights') continue
      const s = this.animation(name).samplers[ch.sampler]
      const times = this.read(s.input).map((r) => r[0])
      const vals = this.read(s.output)
      let i = 0
      while (i < times.length - 1 && times[i + 1] <= t) i++
      let v: number[]
      if (s.interpolation === 'STEP' || i === times.length - 1 || t <= times[0]) {
        v = vals[t <= times[0] ? 0 : i]
      } else {
        const f = (t - times[i]) / (times[i + 1] - times[i])
        const a = vals[i]
        let b = vals[i + 1]
        if (ch.target.path === 'rotation' && a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0) b = b.map((x) => -x)
        v = a.map((x, k) => x + (b[k] - x) * f)
        if (ch.target.path === 'rotation') {
          const n = Math.hypot(...v)
          v = v.map((x) => x / n)
        }
      }
      const o = out.get(ch.target.node) ?? {}
      ;(o as Record<string, number[]>)[ch.target.path] = v
      out.set(ch.target.node, o)
    }
    return out
  }

  /** World position of every named node, at rest or at time t of an animation. */
  world(anim?: string, t = 0): Map<string, V3> {
    const over = anim ? this.sample(anim, t) : new Map()
    const out = new Map<string, V3>()
    const walk = (i: number, parent: M4) => {
      const m = mul(parent, compose({ ...this.json.nodes[i], ...(over.get(i) ?? {}) }))
      const nm = this.json.nodes[i].name
      if (nm) out.set(nm, [m[12], m[13], m[14]])
      for (const c of this.json.nodes[i].children ?? []) walk(c, m)
    }
    for (const r of this.json.scenes[0].nodes) walk(r, IDENTITY)
    return out
  }
}

const IDENTITY: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function compose(n: Pick<GltfNode, 'translation' | 'rotation' | 'scale'>): M4 {
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

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2])
export const unit = (a: V3): V3 => {
  const l = len(a)
  return [a[0] / l, a[1] / l, a[2] / l]
}
export const angleDeg = (a: V3, b: V3) => {
  const u = unit(a)
  const v = unit(b)
  return (Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) * 180) / Math.PI
}

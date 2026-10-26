import * as THREE from 'three'
import { MINT, makeBodyMaterial } from './stage'

/** Geometry builders for the ceramic mannequin. Everything is generated from primitives in
 *  code: a lathe-turned torso–neck–head shell, spherical deltoid caps,
 *  tapered limb cylinders, ball joints and mitt hands. Units are metres; y is relative to the
 *  hips joint for the torso; limbs are built along −y and oriented by the scene each frame. */

let shared: THREE.MeshPhysicalMaterial | null = null
function bodyMaterial() {
  shared ??= makeBodyMaterial()
  return shared
}

/** 17 control points (x = radius, y = height above the hips joint) from the pelvis bottom to the
 *  crown. The profile is smoothed by corner-cutting before it is turned, so these are the
 *  silhouette's "intent" points: pelvis → waist → chest → shoulder line → trapezius → neck →
 *  egg-shaped head. */
export function torsoProfile(): THREE.Vector2[] {
  return [
    new THREE.Vector2(0.0, -0.05), // pelvis bottom (centre)
    new THREE.Vector2(0.155, -0.048), // pelvis bottom (edge)
    new THREE.Vector2(0.19, -0.01), // pelvis
    new THREE.Vector2(0.18, 0.08),
    new THREE.Vector2(0.155, 0.19), // waist
    new THREE.Vector2(0.19, 0.3), // lower chest
    new THREE.Vector2(0.22, 0.39), // chest
    new THREE.Vector2(0.24, 0.445), // shoulder line
    new THREE.Vector2(0.185, 0.495), // trapezius slope
    new THREE.Vector2(0.072, 0.52), // neck base
    new THREE.Vector2(0.066, 0.585), // neck top
    new THREE.Vector2(0.088, 0.605), // jaw
    new THREE.Vector2(0.106, 0.65), // cheek
    new THREE.Vector2(0.11, 0.7), // head, widest
    new THREE.Vector2(0.088, 0.758), // brow
    new THREE.Vector2(0.048, 0.792), // crown edge
    new THREE.Vector2(0.0, 0.8), // crown
  ]
}

/** Chaikin corner cutting; the first and last points are kept fixed. */
function chaikin(points: THREE.Vector2[], passes: number): THREE.Vector2[] {
  let pts = points
  for (let p = 0; p < passes; p++) {
    const out: THREE.Vector2[] = [pts[0].clone()]
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      out.push(new THREE.Vector2(a.x * 0.75 + b.x * 0.25, a.y * 0.75 + b.y * 0.25))
      out.push(new THREE.Vector2(a.x * 0.25 + b.x * 0.75, a.y * 0.25 + b.y * 0.75))
    }
    out.push(pts[pts.length - 1].clone())
    pts = out
  }
  return pts
}

let smoothProfile: THREE.Vector2[] | null = null
function profile(): THREE.Vector2[] {
  smoothProfile ??= chaikin(torsoProfile(), 3)
  return smoothProfile
}

/** Radius of the turned torso at a given height above the hips (0 outside the profile). */
export function torsoRadiusAt(y: number): number {
  const p = profile()
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i]
    const b = p[i + 1]
    if (y >= a.y && y <= b.y) {
      const u = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y)
      return a.x + (b.x - a.x) * u
    }
  }
  return 0
}

/** Front-to-back flattening: a chest is shallower than it is wide, a head is round. */
export function depthScaleAt(y: number): number {
  const u = Math.min(1, Math.max(0, (y - 0.5) / 0.1))
  const s = u * u * (3 - 2 * u)
  return 0.64 + (1 - 0.64) * s
}

/** One seamless torso–neck–head shell turned from the smoothed profile, then flattened in z. */
export function makeTorso(material: THREE.Material = bodyMaterial()): THREE.Mesh {
  const geo = new THREE.LatheGeometry(profile(), 72)
  flatten(geo)
  const mesh = new THREE.Mesh(geo, material)
  mesh.castShadow = true
  mesh.receiveShadow = false
  return mesh
}

function flatten(geo: THREE.BufferGeometry) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) * depthScaleAt(pos.getY(i)))
  pos.needsUpdate = true
  geo.computeVertexNormals()
}

/** Height of the dark display base under the bust, measured down from the hips joint. */
export const PLINTH_DEPTH = 0.22

/** The dark base the bust stands in (wireframe p.6): a flattened truncated cone from just under
 *  the pelvis down to the stage floor. */
export function makePlinth(): THREE.Mesh {
  const pts = [
    new THREE.Vector2(0.0, -PLINTH_DEPTH),
    new THREE.Vector2(0.165, -PLINTH_DEPTH),
    new THREE.Vector2(0.175, -PLINTH_DEPTH + 0.02),
    new THREE.Vector2(0.19, -0.06),
    new THREE.Vector2(0.192, -0.03),
    new THREE.Vector2(0.0, -0.03),
  ]
  const geo = new THREE.LatheGeometry(pts, 72)
  flatten(geo)
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x0c1f23, roughness: 0.85, metalness: 0.05 }))
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.decor = true
  return mesh
}

export function makeShoulderCap(material: THREE.Material = bodyMaterial()): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.076, 32, 24), material)
  m.castShadow = true
  return m
}

/** Tapered cylinder of the given length, centred on the origin along y (top = +y). */
function limb(rTop: number, rBottom: number, len: number, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, len, 32, 1, false), material)
  m.castShadow = true
  return m
}
export function makeUpperArm(len: number, material: THREE.Material = bodyMaterial()): THREE.Mesh {
  return limb(0.065, 0.055, len, material)
}
export function makeForearm(len: number, material: THREE.Material = bodyMaterial()): THREE.Mesh {
  return limb(0.055, 0.04, len, material)
}
export function makeJoint(r: number, material: THREE.Material = bodyMaterial()): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), material)
  m.castShadow = true
  return m
}

export type Hand = {
  group: THREE.Group
  mitt: THREE.Mesh
  thumb: THREE.Mesh
  /** 0 = open mitt, 1 = closed pinch (fingers shorten, thumb folds in). */
  setPinch: (pinch: number) => void
}

/** Mitt hand: a flattened egg for the fingers and a capsule thumb on the inner side. The group's
 *  origin is the wrist; −y runs along the forearm axis toward the fingertips. */
export function makeHand(side: 'left' | 'right' = 'left', material: THREE.Material = bodyMaterial()): Hand {
  const group = new THREE.Group()
  const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.05, 32, 24), material)
  mitt.scale.set(1, 1.35, 0.55)
  mitt.position.set(0, -0.062, 0)
  mitt.castShadow = true
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.035, 8, 16), material)
  const sx = side === 'left' ? -1 : 1
  thumb.position.set(sx * 0.038, -0.03, 0.018)
  thumb.rotation.z = sx * -(35 * Math.PI) / 180
  thumb.castShadow = true
  group.add(mitt, thumb)
  const setPinch = (pinch: number) => {
    const p = Math.min(1, Math.max(0, pinch))
    mitt.scale.y = 1.35 + (0.9 - 1.35) * p
    mitt.position.y = -0.062 + 0.012 * p
    thumb.rotation.z = sx * -((35 + 45 * p) * Math.PI) / 180
    thumb.position.x = sx * (0.038 - 0.012 * p)
    thumb.position.z = 0.018 + 0.012 * p
  }
  return { group, mitt, thumb, setPinch }
}

/** Faint etched contours on the front of the torso (pectoral edges, abdomen, centre line). */
export function makeContourLines(): THREE.Group {
  const group = new THREE.Group()
  const material = new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false })
  const onSurface = (x: number, y: number) => {
    const r = torsoRadiusAt(y)
    const zr = r * depthScaleAt(y)
    const zx = Math.max(0, 1 - (x * x) / (r * r || 1))
    return new THREE.Vector3(x, y, zr * Math.sqrt(zx) + 0.004)
  }
  const line = (pts: [number, number][]) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => onSurface(x, y)))
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.0035, 6, false), material)
    group.add(mesh)
  }
  line([[-0.165, 0.37], [-0.12, 0.335], [-0.06, 0.325], [-0.02, 0.35]]) // right pectoral (viewer's left)
  line([[0.165, 0.37], [0.12, 0.335], [0.06, 0.325], [0.02, 0.35]]) // left pectoral
  line([[-0.055, 0.255], [0, 0.245], [0.055, 0.255]]) // upper abdomen
  line([[-0.05, 0.185], [0, 0.175], [0.05, 0.185]]) // lower abdomen
  line([[0, 0.34], [0, 0.26], [0, 0.14]]) // centre line
  return group
}

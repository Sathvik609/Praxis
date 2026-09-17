import * as THREE from 'three'
import { makeTorso } from './body'
import type { ArcCue } from './clips'
import type { FigurePose } from './figure'
import { BONES, JOINTS, REST, forwardKinematicsFull, type Joint, type Mat3, type Vec3 } from './rig'
import { AMBER, AQUA, MINT } from './stage'

/** Skeleton rendering of the same rig: rounded joint spheres, mint bone tubes with a soft
 *  additive glow, a faint translucent body silhouette (the lathe torso at 12 % opacity, unlit) so
 *  front/back and left/right still read, and the angle cue: a dashed amber arc to the clip's
 *  target angle with a mint arc to the figure's current angle. Same visual language as the live
 *  pose overlay (`session/OverlayCanvas.tsx`: mint bones, white joints, dashed amber guide). The
 *  figure is a pacing reference; the arcs measure the reference figure, never the patient. */

export type SkeletonFigure = {
  group: THREE.Group
  joints: Record<Joint, THREE.Mesh>
  bones: THREE.Mesh[]
  silhouette: THREE.Mesh
  arcGroup: THREE.Group
  /** Place every part from the rig's forward kinematics; `time` drives the focus pulse. */
  update: (pose: FigurePose, opts?: { focus?: Joint | null; arc?: ArcCue | null; time?: number }) => void
  /** Current angle (degrees) along the arc, as last drawn; null when there is no arc. */
  currentDeg: () => number | null
  dispose: () => void
}

const UP = new THREE.Vector3(0, 1, 0)
const WHITE = 0xeaf4f0
const JOINT_R: Partial<Record<Joint, number>> = { hips: 0.03, spine: 0.026, neck: 0.024, head: 0.05, lShoulder: 0.03, rShoulder: 0.03, lHand: 0.026, rHand: 0.026 }
const BONE_R = 0.012
const GLOW_R = 0.03
const DASH_DEG = 5
const GAP_DEG = 3.5
const ARC_RADIUS: Record<ArcCue['kind'], number> = { elevation: 0.17, rotation: 0.13 }
const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const tmpFrom = new THREE.Vector3()
const tmpTo = new THREE.Vector3()
const tmpM = new THREE.Matrix4()

function v(a: Vec3, out = new THREE.Vector3()) {
  return out.set(a[0], a[1], a[2])
}
function quatFromMat3(m: Mat3, out: THREE.Quaternion) {
  tmpM.set(m[0][0], m[0][1], m[0][2], 0, m[1][0], m[1][1], m[1][2], 0, m[2][0], m[2][1], m[2][2], 0, 0, 0, 0, 1)
  return out.setFromRotationMatrix(tmpM)
}

/** Place a unit-length y cylinder between two points, scaled to their distance. */
function placeBone(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3) {
  mesh.position.copy(from).add(to).multiplyScalar(0.5)
  tmpA.copy(to).sub(from)
  const len = tmpA.length()
  mesh.scale.set(1, Math.max(1e-4, len), 1)
  mesh.quaternion.setFromUnitVectors(UP, tmpA.normalize())
}

/** Points along an arc about `centre` in the plane (e0, e1), from `fromDeg` to `toDeg`. */
function arcPoints(centre: THREE.Vector3, e0: THREE.Vector3, e1: THREE.Vector3, r: number, fromDeg: number, toDeg: number, segs: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= segs; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / segs) * Math.PI) / 180
    pts.push(new THREE.Vector3().copy(centre).addScaledVector(e0, r * Math.cos(a)).addScaledVector(e1, r * Math.sin(a)))
  }
  return pts
}

function tube(pts: THREE.Vector3[], radius: number, material: THREE.Material): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(2, pts.length * 2), radius, 8, false), material)
}

/** Basis (centre, e0, e1) of an arc cue for the current pose: elevation arcs hang from the torso's
 *  down axis toward the peak direction; rotation arcs start at the forearm's start direction. */
export function arcBasis(arc: ArcCue, pos: Record<Joint, Vec3>, rot: Record<Joint, Mat3>): { centre: THREE.Vector3; e0: THREE.Vector3; e1: THREE.Vector3 } {
  const centre = v(pos[arc.joint])
  const spine = new THREE.Quaternion()
  quatFromMat3(rot.spine, spine)
  const e0 = v(arc.startDir).applyQuaternion(spine).normalize()
  const peak = v(arc.peakDir).applyQuaternion(spine)
  const e1 = peak.sub(e0.clone().multiplyScalar(peak.dot(e0)))
  if (e1.lengthSq() < 1e-8) e1.set(0, 0, 1).sub(e0.clone().multiplyScalar(e0.z))
  e1.normalize()
  return { centre, e0, e1 }
}

/** Signed angle (degrees) of the bone `joint → child` in the arc's plane, 0 at `e0`. */
export function arcAngle(arc: ArcCue, pos: Record<Joint, Vec3>, e0: THREE.Vector3, e1: THREE.Vector3): number {
  const d = v(pos[arc.child]).sub(v(pos[arc.joint], tmpB))
  return (Math.atan2(d.dot(e1), d.dot(e0)) * 180) / Math.PI
}

export function makeSkeletonFigure(): SkeletonFigure {
  const group = new THREE.Group()
  const jointMat = new THREE.MeshBasicMaterial({ color: WHITE })
  const jointGlowMat = new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false })
  const boneMat = new THREE.MeshBasicMaterial({ color: MINT })
  const glowMat = new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })
  const silhouetteMat = new THREE.MeshBasicMaterial({ color: AQUA, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide })
  const focusMat = new THREE.MeshBasicMaterial({ color: 0x4fa3f7, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
  const amberMat = new THREE.MeshBasicMaterial({ color: AMBER })
  const amberGlowMat = new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false })
  const mintArcMat = new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.95, depthWrite: false })
  const mintArcGlowMat = new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false })

  const silhouette = makeTorso(silhouetteMat)
  silhouette.castShadow = false
  silhouette.renderOrder = -1
  group.add(silhouette)

  const joints = {} as Record<Joint, THREE.Mesh>
  for (const j of JOINTS) {
    const r = JOINT_R[j] ?? 0.022
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), jointMat)
    const halo = new THREE.Mesh(new THREE.SphereGeometry(r * 1.9, 16, 12), jointGlowMat)
    m.add(halo)
    group.add(m)
    joints[j] = m
  }
  const bones: THREE.Mesh[] = []
  const glows: THREE.Mesh[] = []
  for (let i = 0; i < BONES.length; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(BONE_R, BONE_R, 1, 12, 1, true), boneMat)
    const g = new THREE.Mesh(new THREE.CylinderGeometry(GLOW_R, GLOW_R, 1, 12, 1, true), glowMat)
    group.add(b, g)
    bones.push(b)
    glows.push(g)
  }
  const focus = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 14), focusMat)
  focus.visible = false
  group.add(focus)

  const arcGroup = new THREE.Group()
  group.add(arcGroup)
  let dashed: THREE.Group | null = null
  let dashedKey = ''
  let mintArc: THREE.Group | null = null
  let mintDeg = NaN
  let lastDeg: number | null = null
  const disposeGroup = (g: THREE.Group) => {
    g.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
    arcGroup.remove(g)
  }

  const update: SkeletonFigure['update'] = ({ angles, breath }, opts = {}) => {
    const { pos, rot } = forwardKinematicsFull(angles)
    v(pos.hips, silhouette.position)
    quatFromMat3(rot.spine, silhouette.quaternion)
    const b = 1 + 0.012 * breath
    silhouette.scale.set(b, 1, b)
    for (const j of JOINTS) v(pos[j], joints[j].position)
    BONES.forEach(([a, c], i) => {
      v(pos[a], tmpFrom)
      v(pos[c], tmpTo)
      placeBone(bones[i], tmpFrom, tmpTo)
      placeBone(glows[i], tmpFrom, tmpTo)
    })
    const f = opts.focus ?? null
    focus.visible = !!f
    if (f) {
      v(pos[f], focus.position)
      const pulse = 0.5 + 0.5 * Math.sin((opts.time ?? 0) * 2 * Math.PI * 0.8)
      focus.scale.setScalar(0.85 + 0.3 * pulse)
      focusMat.opacity = 0.22 + 0.2 * pulse
    }

    const arc = opts.arc ?? null
    arcGroup.visible = !!arc
    if (!arc) {
      lastDeg = null
      return
    }
    const { centre, e0, e1 } = arcBasis(arc, pos, rot)
    const r = ARC_RADIUS[arc.kind]
    const key = `${arc.kind}:${arc.joint}:${arc.targetDeg}`
    if (key !== dashedKey) {
      dashedKey = key
      if (dashed) disposeGroup(dashed)
      dashed = new THREE.Group()
      for (let a = 0; a < arc.targetDeg; a += DASH_DEG + GAP_DEG) {
        const to = Math.min(arc.targetDeg, a + DASH_DEG)
        const pts = arcPoints(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), r, a, to, 4)
        dashed.add(tube(pts, 0.005, amberMat), tube(pts, 0.014, amberGlowMat))
      }
      // target end: a small ring where the arm should arrive
      const end = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.004, 8, 24), amberMat)
      const a = (arc.targetDeg * Math.PI) / 180
      end.position.set(r * Math.cos(a), r * Math.sin(a), 0)
      end.userData.end = true
      dashed.add(end)
      arcGroup.add(dashed)
    }
    // the dashed arc is built in its local (e0, e1) plane and posed here every frame
    if (dashed) {
      tmpM.makeBasis(e0, e1, new THREE.Vector3().crossVectors(e0, e1))
      dashed.quaternion.setFromRotationMatrix(tmpM)
      dashed.position.copy(centre)
    }
    const deg = arcAngle(arc, pos, e0, e1)
    lastDeg = deg
    const shown = Math.max(0, Math.min(arc.targetDeg + 15, deg))
    if (!mintArc || Math.abs(shown - mintDeg) > 1.5) {
      mintDeg = shown
      if (mintArc) disposeGroup(mintArc)
      mintArc = new THREE.Group()
      if (shown > 2) {
        const pts = arcPoints(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), r - 0.012, 0, shown, Math.max(4, Math.round(shown / 4)))
        mintArc.add(tube(pts, 0.007, mintArcMat), tube(pts, 0.018, mintArcGlowMat))
      }
      arcGroup.add(mintArc)
    }
    if (mintArc) {
      mintArc.quaternion.copy(dashed!.quaternion)
      mintArc.position.copy(centre)
    }
  }

  const dispose = () => {
    group.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
    for (const m of [jointMat, jointGlowMat, boneMat, glowMat, silhouetteMat, focusMat, amberMat, amberGlowMat, mintArcMat, mintArcGlowMat]) m.dispose()
  }

  return { group, joints, bones, silhouette, arcGroup, update, currentDeg: () => lastDeg, dispose }
}

/** Rest-pose upper-arm length, for tests and camera framing. */
export const UPPER_ARM_LENGTH = Math.hypot(...REST.lElbow.offset)

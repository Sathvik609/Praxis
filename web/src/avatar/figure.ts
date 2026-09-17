import * as THREE from 'three'
import { type Hand, makeContourLines, makeForearm, makeHand, makeJoint, makePlinth, makeShoulderCap, makeTorso, makeUpperArm } from './body'
import { type Angles, type Joint, type Mat3, REST, type Vec3, forwardKinematicsFull } from './rig'
import { makeBodyMaterial } from './stage'

export type FigurePose = { angles: Angles; pinch: number; breath: number }

type Arm = {
  cap: THREE.Mesh
  upper: THREE.Mesh
  elbow: THREE.Mesh
  forearm: THREE.Mesh
  wrist: THREE.Mesh
  hand: Hand
}

export type Figure = {
  group: THREE.Group
  torso: THREE.Mesh
  left: Arm
  right: Arm
  material: THREE.MeshPhysicalMaterial
  /** Place every part from the rig's forward kinematics. */
  update: (pose: FigurePose) => void
  dispose: () => void
}

const UP = new THREE.Vector3(0, 1, 0)
const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const tmpM = new THREE.Matrix4()

function v(a: Vec3, out: THREE.Vector3) {
  return out.set(a[0], a[1], a[2])
}
function quatFromMat3(m: Mat3, out: THREE.Quaternion) {
  tmpM.set(m[0][0], m[0][1], m[0][2], 0, m[1][0], m[1][1], m[1][2], 0, m[2][0], m[2][1], m[2][2], 0, 0, 0, 0, 1)
  return out.setFromRotationMatrix(tmpM)
}

/** Assemble the mannequin from the body builders. The torso is one seamless shell pivoting at
 *  the hips; each arm is deltoid cap → upper arm → elbow → forearm → wrist → mitt hand. */
export function makeFigure(material: THREE.MeshPhysicalMaterial = makeBodyMaterial()): Figure {
  const group = new THREE.Group()
  const torso = makeTorso(material)
  const contours = makeContourLines()
  contours.traverse((o) => {
    o.userData.decor = true
  })
  torso.add(contours)
  group.add(torso)
  const plinth = makePlinth()
  group.add(plinth)

  const arm = (side: 'left' | 'right'): Arm => {
    const s = side === 'left' ? 'l' : 'r'
    const upperLen = Math.hypot(...REST[`${s}Elbow` as Joint].offset)
    const foreLen = Math.hypot(...REST[`${s}Wrist` as Joint].offset)
    const a: Arm = {
      cap: makeShoulderCap(material),
      upper: makeUpperArm(upperLen, material),
      elbow: makeJoint(0.058, material),
      forearm: makeForearm(foreLen, material),
      wrist: makeJoint(0.046, material),
      hand: makeHand(side, material),
    }
    group.add(a.cap, a.upper, a.elbow, a.forearm, a.wrist, a.hand.group)
    return a
  }
  const left = arm('left')
  const right = arm('right')

  const placeLimb = (mesh: THREE.Mesh, from: Vec3, to: Vec3) => {
    v(from, tmpA)
    v(to, tmpB)
    mesh.position.copy(tmpA).add(tmpB).multiplyScalar(0.5)
    tmpA.sub(tmpB).normalize() // points from the far joint back to the near joint = the cylinder's +y (wider end)
    mesh.quaternion.setFromUnitVectors(UP, tmpA)
  }

  const update = ({ angles, pinch, breath }: FigurePose) => {
    const { pos, rot } = forwardKinematicsFull(angles)
    v(pos.hips, torso.position)
    v(pos.hips, plinth.position)
    quatFromMat3(rot.spine, torso.quaternion)
    const b = 1 + 0.012 * breath
    torso.scale.set(b, 1, b)
    for (const [a, s] of [[left, 'l'], [right, 'r']] as const) {
      const sh = pos[`${s}Shoulder`]
      const el = pos[`${s}Elbow`]
      const wr = pos[`${s}Wrist`]
      v(sh, a.cap.position)
      a.cap.position.y += 0.004 * breath
      placeLimb(a.upper, sh, el)
      v(el, a.elbow.position)
      placeLimb(a.forearm, el, wr)
      v(wr, a.wrist.position)
      v(wr, a.hand.group.position)
      quatFromMat3(rot[`${s}Wrist`], a.hand.group.quaternion)
      a.hand.setPinch(pinch)
    }
  }

  const dispose = () => {
    group.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.geometry.dispose()
        if (m.material !== material) (m.material as THREE.Material).dispose()
      }
    })
    material.dispose()
  }

  return { group, torso, left, right, material, update, dispose }
}

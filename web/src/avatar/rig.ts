/** Procedural mannequin rig: a joint tree with a rest pose and forward kinematics.
 *  Units are metres; y up; +z toward the viewer in the front view; the figure's left is +x. */
export const JOINTS = [
  'hips', 'spine', 'neck', 'head',
  'lShoulder', 'lElbow', 'lWrist', 'lHand',
  'rShoulder', 'rElbow', 'rWrist', 'rHand',
] as const
export type Joint = (typeof JOINTS)[number]
export type Vec3 = [number, number, number]
export type Angles = Record<Joint, Vec3>

/** Radius of the mitt hand; the hand joint sits 9 cm past the wrist along the forearm axis. */
export const HAND_RADIUS = 0.05
export const HAND_OFFSET = 0.09

/** offset: bone vector from the parent joint to this joint in the parent's frame (rest). */
export const REST: Record<Joint, { parent: Joint | null; offset: Vec3; radius: number }> = {
  hips: { parent: null, offset: [0, 1.0, 0], radius: 0.16 },
  spine: { parent: 'hips', offset: [0, 0.26, 0], radius: 0.17 },
  neck: { parent: 'spine', offset: [0, 0.24, 0], radius: 0.06 },
  head: { parent: 'neck', offset: [0, 0.14, 0], radius: 0.11 },
  lShoulder: { parent: 'neck', offset: [0.225, -0.09, 0], radius: 0.07 },
  lElbow: { parent: 'lShoulder', offset: [0.025, -0.27, 0], radius: 0.055 },
  lWrist: { parent: 'lElbow', offset: [0, -0.25, 0], radius: 0.045 },
  lHand: { parent: 'lWrist', offset: [0, -HAND_OFFSET, 0], radius: HAND_RADIUS },
  rShoulder: { parent: 'neck', offset: [-0.225, -0.09, 0], radius: 0.07 },
  rElbow: { parent: 'rShoulder', offset: [-0.025, -0.27, 0], radius: 0.055 },
  rWrist: { parent: 'rElbow', offset: [0, -0.25, 0], radius: 0.045 },
  rHand: { parent: 'rWrist', offset: [0, -HAND_OFFSET, 0], radius: HAND_RADIUS },
}

export function restAngles(): Angles {
  return Object.fromEntries(JOINTS.map((j) => [j, [0, 0, 0]])) as Angles
}

export type Mat3 = [Vec3, Vec3, Vec3]
function mul(a: Mat3, b: Mat3): Mat3 {
  const r: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]
  return r
}
function apply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ]
}
/** Euler XYZ rotation matrix (radians). */
export function euler(e: Vec3): Mat3 {
  const [x, y, z] = e
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z)
  const Rx: Mat3 = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
  const Ry: Mat3 = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
  const Rz: Mat3 = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]
  return mul(mul(Rx, Ry), Rz)
}

/** World position and world rotation (parent chain × own Euler) of every joint. */
export function forwardKinematicsFull(angles: Angles): { pos: Record<Joint, Vec3>; rot: Record<Joint, Mat3> } {
  const pos = {} as Record<Joint, Vec3>
  const rot = {} as Record<Joint, Mat3>
  for (const j of JOINTS) {
    const { parent, offset } = REST[j]
    if (parent === null) {
      pos[j] = [...offset] as Vec3
      rot[j] = euler(angles[j])
    } else {
      const d = apply(rot[parent], offset)
      pos[j] = [pos[parent][0] + d[0], pos[parent][1] + d[1], pos[parent][2] + d[2]]
      rot[j] = mul(rot[parent], euler(angles[j]))
    }
  }
  return { pos, rot }
}

/** World positions of every joint for the given joint angles (rotation applied at each joint to its subtree). */
export function forwardKinematics(angles: Angles): Record<Joint, Vec3> {
  return forwardKinematicsFull(angles).pos
}

/** Bone segments to draw: [from, to] joint pairs. */
export const BONES: [Joint, Joint][] = [
  ['hips', 'spine'], ['spine', 'neck'], ['neck', 'head'],
  ['neck', 'lShoulder'], ['lShoulder', 'lElbow'], ['lElbow', 'lWrist'], ['lWrist', 'lHand'],
  ['neck', 'rShoulder'], ['rShoulder', 'rElbow'], ['rElbow', 'rWrist'], ['rWrist', 'rHand'],
]

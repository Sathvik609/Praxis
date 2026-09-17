import { type Angles, type Joint, type Vec3, forwardKinematics } from './rig'

/** Two-bone arm IK on the rig's own forward kinematics: damped least squares over shoulder
 *  pitch/yaw/roll and elbow flexion, so clip authors give the sampler *targets* (a dot, a hole,
 *  the dish) and the mitt really lands there. Runs once per key at clip definition time. */
type Side = 'left' | 'right'
const D = Math.PI / 180

// [min, max] per parameter: shoulder pitch, yaw, roll, elbow flexion.
function limits(side: Side): [number, number][] {
  const s = side === 'left' ? 1 : -1
  return [
    [-130 * D, 35 * D],
    s === 1 ? [-100 * D, 100 * D] : [-100 * D, 100 * D],
    s === 1 ? [-35 * D, 80 * D] : [-80 * D, 35 * D],
    [-150 * D, 0],
  ]
}

function apply(base: Angles, side: Side, p: number[]): Angles {
  const a = { ...base } as Angles
  const sh = (side === 'left' ? 'lShoulder' : 'rShoulder') as Joint
  const el = (side === 'left' ? 'lElbow' : 'rElbow') as Joint
  a[sh] = [p[0], p[1], p[2]]
  a[el] = [p[3], 0, 0]
  return a
}

function handOf(base: Angles, side: Side, p: number[]): { hand: Vec3; elbow: Vec3; shoulder: Vec3 } {
  const pos = forwardKinematics(apply(base, side, p))
  return side === 'left'
    ? { hand: pos.lHand, elbow: pos.lElbow, shoulder: pos.lShoulder }
    : { hand: pos.rHand, elbow: pos.rElbow, shoulder: pos.rShoulder }
}

/** Solve for the hand joint reaching `target`; the rest of `base` (torso, other arm) is kept.
 *  A soft preference keeps the elbow below the shoulder so table reaches look natural. */
export function solveArm(base: Angles, side: Side, target: Vec3, initial?: number[]): Angles {
  const s = side === 'left' ? 1 : -1
  const lim = limits(side)
  let p = initial ? [...initial] : [-40 * D, s * 10 * D, s * 8 * D, -60 * D]
  const clamp = (q: number[]) => q.map((v, i) => Math.min(lim[i][1], Math.max(lim[i][0], v)))
  p = clamp(p)
  const residual = (q: number[]): number[] => {
    const { hand, elbow, shoulder } = handOf(base, side, q)
    // soft residuals: the elbow stays below the shoulder on a table reach, and outside the torso's
    // cross-section (an ellipse a little wider than the chest) so a cross-body reach bends forward
    const lift = Math.max(0, elbow[1] - (shoulder[1] - 0.12))
    const inside = Math.max(0, 1.15 - ((elbow[0] / 0.26) ** 2 + (elbow[2] / 0.17) ** 2))
    return [target[0] - hand[0], target[1] - hand[1], target[2] - hand[2], -0.6 * lift, -0.08 * inside]
  }
  const eps = 1e-4
  let lambda = 0.02
  let r = residual(p)
  let err = r.reduce((a, b) => a + b * b, 0)
  for (let it = 0; it < 120 && err > 1e-8; it++) {
    // numeric Jacobian (residuals × 4 params), J = −∂r/∂p
    const R = r.length
    const J: number[][] = Array.from({ length: R }, () => [])
    for (let k = 0; k < 4; k++) {
      const q = [...p]
      q[k] += eps
      const rk = residual(q)
      for (let i = 0; i < R; i++) J[i][k] = (r[i] - rk[i]) / eps
    }
    // Levenberg–Marquardt step: (JᵀJ + λI) Δ = Jᵀ r
    const A: number[][] = [[], [], [], []]
    const g: number[] = [0, 0, 0, 0]
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let v = 0
        for (let k = 0; k < R; k++) v += J[k][i] * J[k][j]
        A[i][j] = v + (i === j ? lambda : 0)
      }
      for (let k = 0; k < R; k++) g[i] += J[k][i] * r[k]
    }
    const delta = solve4(A, g)
    const next = clamp(p.map((v, i) => v + delta[i]))
    const rn = residual(next)
    const en = rn.reduce((a, b) => a + b * b, 0)
    if (en < err) {
      p = next
      r = rn
      err = en
      lambda = Math.max(1e-5, lambda * 0.5)
    } else {
      lambda = Math.min(10, lambda * 4)
    }
  }
  return apply(base, side, p)
}

/** Gaussian elimination for a 4×4 system. */
function solve4(A: number[][], b: number[]): number[] {
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < 4; c++) {
    let piv = c
    for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    ;[M[c], M[piv]] = [M[piv], M[c]]
    const d = M[c][c] || 1e-12
    for (let r = 0; r < 4; r++) {
      if (r === c) continue
      const f = M[r][c] / d
      for (let k = c; k < 5; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[4] / (row[i] || 1e-12))
}

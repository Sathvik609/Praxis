import * as THREE from 'three'
import type { Side } from './layout'

/** What the camera framing depends on, for either figure (procedural clip or GLB action). */
export type Framing = {
  camera: 'front' | 'side'
  closeUp: boolean
  compact: boolean
  /** Practising side: the side camera stands on it. */
  side: Side
  /** A table task: look down a little so the sheet reads. */
  hasTable: boolean
  /** Arm-elevation clips reach overhead: frame a little taller and further back. */
  tall: boolean
  /** Vertical offset of the whole framing (the GLB's table sits lower than the procedural bust's). */
  yShift?: number
}

/** Camera presets (plan B5): front 2.6 m / target 1.30 (Home compact 2.2 m / 1.36), side from
 *  the practising side, close-up 1.5 m on the hand. Table clips look down a little so the sheet reads. */
export function framingPreset(f: Framing, hand: THREE.Vector3): { eye: THREE.Vector3; look: THREE.Vector3 } {
  const { camera, closeUp, compact, hasTable, tall } = f
  const sx = f.side === 'right' ? -1 : 1
  if (closeUp) {
    const look = hand.clone()
    const eye = camera === 'side' ? new THREE.Vector3(sx * 1.5, look.y + 0.3, look.z + 0.2) : new THREE.Vector3(look.x * 0.5, look.y + 0.45, look.z + 1.35)
    return { eye, look }
  }
  const dist = (compact ? 2.25 : 2.3) + (tall ? 0.25 : 0)
  const y = (hasTable ? (compact ? 1.26 : 1.22) : compact ? 1.36 : 1.3) + (tall ? 0.1 : 0) + (f.yShift ?? 0)
  if (camera === 'side') return { eye: new THREE.Vector3(sx * dist, y + 0.12, 0.2), look: new THREE.Vector3(0, y, 0.16) }
  return { eye: new THREE.Vector3(0.08, y + (hasTable ? 0.5 : 0.12), dist), look: new THREE.Vector3(0, y - (hasTable ? 0.02 : 0), 0.05) }
}

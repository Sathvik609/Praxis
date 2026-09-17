import * as THREE from 'three'
import type { CueTarget } from './clips'
import { CEILING_LENGTH, CUP, CUP_SHEET, NHPT_BOARD, NHPT_DISH, PEG, TABLE, TABLE_Y, cupDots, nhptDish, nhptHoles, type Side } from './layout'
import { REST } from './rig'
import { AMBER } from './stage'

/** Stage props, all primitives: the table, the printed cup sheet with its five dots, the cup,
 *  the NHPT board with holes and pegs, the peg dish, and the 90° ceiling line. Positions come
 *  from `layout.ts`, the same numbers the clips reach for. */

const TEAL = 0x1f5f5b
const PAPER = 0xe6ece8
const INK = 0x0b1d21

export function makeTable(): THREE.Group {
  const g = new THREE.Group()
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE.width, TABLE.thickness, TABLE.depth),
    new THREE.MeshStandardMaterial({ color: 0x10262b, roughness: 0.85, metalness: 0.05 }),
  )
  slab.position.set(0, TABLE_Y - TABLE.thickness / 2, TABLE.nearZ + TABLE.depth / 2)
  slab.receiveShadow = true
  slab.castShadow = true
  g.add(slab)
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE.width, 0.004, 0.006),
    new THREE.MeshBasicMaterial({ color: 0x2fa985, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  edge.position.set(0, TABLE_Y + 0.001, TABLE.nearZ + TABLE.depth)
  g.add(edge)
  return g
}

/** Printed A4 sheet with the four ArUco corner squares suggested and five dots. */
function makeSheet(width: number, height: number, cx: number, cz: number): THREE.Group {
  const g = new THREE.Group()
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.9, transparent: true, opacity: 0.92 }))
  paper.rotation.x = -Math.PI / 2
  paper.position.set(cx, TABLE_Y + 0.0015, cz)
  paper.receiveShadow = true
  g.add(paper)
  const mk = new THREE.MeshBasicMaterial({ color: INK })
  const inner = new THREE.MeshBasicMaterial({ color: PAPER })
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.028, 0.028), mk)
      m.rotation.x = -Math.PI / 2
      m.position.set(cx + sx * (width / 2 - 0.03), TABLE_Y + 0.002, cz + sz * (height / 2 - 0.03))
      g.add(m)
      const i = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.012), inner)
      i.rotation.x = -Math.PI / 2
      i.position.set(m.position.x, TABLE_Y + 0.0025, m.position.z)
      g.add(i)
    }
  }
  return g
}

export type CupSheet = { group: THREE.Group; dots: THREE.Mesh[]; setTargetDot: (k: number | null) => void }

export function makeCupSheet(side: Side): CupSheet {
  const group = makeSheet(CUP_SHEET.width, CUP_SHEET.height, CUP_SHEET.centreX, CUP_SHEET.centreZ)
  const dots = cupDots(side).map(([x, y, z], i) => {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.004, 32), new THREE.MeshStandardMaterial({ color: TEAL, roughness: 0.7 }))
    d.position.set(x, y + 0.003, z)
    d.name = `dot-${i}`
    group.add(d)
    return d
  })
  const setTargetDot = (k: number | null) => {
    dots.forEach((d, i) => (d.material as THREE.MeshStandardMaterial).color.set(i === k ? AMBER : TEAL))
  }
  return { group, dots, setTargetDot }
}

export type Cup = { mesh: THREE.Mesh; placeOnTable: (x: number, z: number) => void; holdAt: (hand: THREE.Vector3) => void }

/** Aqua-grey cup; held from above by the rim so the mitt closes around its body. */
export function makeCup(): Cup {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(CUP.rRim, CUP.rBase, CUP.height, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xa9c4be, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide }),
  )
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(CUP.rBase, 32), mesh.material)
  bottom.rotation.x = Math.PI / 2
  bottom.position.y = -CUP.height / 2 + 0.001
  mesh.add(bottom)
  mesh.castShadow = true
  return {
    mesh,
    placeOnTable: (x, z) => mesh.position.set(x, TABLE_Y + CUP.height / 2, z),
    holdAt: (hand) => mesh.position.set(hand.x, hand.y - 0.05 + CUP.height / 2, hand.z),
  }
}

export type Board = {
  group: THREE.Group
  holes: THREE.Mesh[]
  holeRings: THREE.Mesh[]
  pegs: THREE.Mesh[]
  setTargetHole: (k: number | null) => void
  setSeated: (n: number) => void
}

const pegMaterial = () => new THREE.MeshStandardMaterial({ color: 0xd9b98f, roughness: 0.6 })

export function makeNhptBoard(side: Side): Board {
  const group = new THREE.Group()
  const plate = new THREE.Mesh(new THREE.BoxGeometry(NHPT_BOARD.size, 0.012, NHPT_BOARD.size), new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.85 }))
  plate.position.set(NHPT_BOARD.centreX, TABLE_Y + 0.006, NHPT_BOARD.centreZ)
  plate.receiveShadow = true
  plate.castShadow = true
  group.add(plate)
  const holes: THREE.Mesh[] = []
  const holeRings: THREE.Mesh[] = []
  const pegs: THREE.Mesh[] = []
  nhptHoles(side).forEach(([x, , z], i) => {
    const h = new THREE.Mesh(new THREE.CircleGeometry(0.006, 24), new THREE.MeshBasicMaterial({ color: INK }))
    h.rotation.x = -Math.PI / 2
    h.position.set(x, TABLE_Y + 0.0125, z)
    h.name = `hole-${i}`
    group.add(h)
    holes.push(h)
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.009, 0.013, 32), new THREE.MeshBasicMaterial({ color: AMBER, side: THREE.DoubleSide }))
    ring.rotation.x = -Math.PI / 2
    ring.position.set(x, TABLE_Y + 0.0126, z)
    ring.visible = false
    group.add(ring)
    holeRings.push(ring)
    const peg = new THREE.Mesh(new THREE.CylinderGeometry(PEG.radius, PEG.radius, PEG.length, 12), pegMaterial())
    peg.position.set(x, TABLE_Y + 0.012 + PEG.length / 2 - 0.008, z)
    peg.visible = false
    peg.castShadow = true
    group.add(peg)
    pegs.push(peg)
  })
  return {
    group,
    holes,
    holeRings,
    pegs,
    setTargetHole: (k) => holeRings.forEach((r, i) => (r.visible = i === k)),
    setSeated: (n) => pegs.forEach((p, i) => (p.visible = i < n)),
  }
}

export type Dish = { group: THREE.Group; peg: THREE.Mesh; holdPegAt: (hand: THREE.Vector3) => void; setCarried: (carried: boolean) => void }

/** Shallow dish of pegs on the practising side; one loose peg is the one the hand carries. */
export function makeDish(side: Side): Dish {
  const group = new THREE.Group()
  const [x, , z] = nhptDish(side)
  const dish = new THREE.Mesh(
    new THREE.CylinderGeometry(NHPT_DISH.radius, NHPT_DISH.radius * 0.9, 0.014, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xc9d3cf, roughness: 0.6, side: THREE.DoubleSide }),
  )
  dish.position.set(x, TABLE_Y + 0.007, z)
  dish.castShadow = true
  group.add(dish)
  const floor = new THREE.Mesh(new THREE.CircleGeometry(NHPT_DISH.radius * 0.9, 40), new THREE.MeshStandardMaterial({ color: 0xb8c4c0, roughness: 0.8 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.set(x, TABLE_Y + 0.001, z)
  group.add(floor)
  for (let i = 0; i < 5; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(PEG.radius, PEG.radius, PEG.length, 12), pegMaterial())
    const a = (i / 5) * Math.PI * 2
    p.position.set(x + 0.018 * Math.cos(a), TABLE_Y + 0.006, z + 0.018 * Math.sin(a))
    p.rotation.set(Math.PI / 2, 0, a)
    group.add(p)
  }
  const peg = new THREE.Mesh(new THREE.CylinderGeometry(PEG.radius, PEG.radius, PEG.length, 12), pegMaterial())
  peg.castShadow = true
  peg.visible = false
  group.add(peg)
  return {
    group,
    peg,
    holdPegAt: (hand) => peg.position.set(hand.x, hand.y - 0.012, hand.z),
    setCarried: (c) => (peg.visible = c),
  }
}

/** Dashed amber line from the practising shoulder straight forward: the 90° ceiling. */
export function makeCeilingLine(side: Side): THREE.Line {
  const sx = side === 'left' ? 1 : -1
  const sh = shoulderAt(side)
  const pts = [new THREE.Vector3(sh.x, sh.y, 0.02), new THREE.Vector3(sh.x, sh.y, CEILING_LENGTH)]
  const geo = new THREE.BufferGeometry().setFromPoints(pts)
  const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: AMBER, dashSize: 0.03, gapSize: 0.02, transparent: true, opacity: 0.9 }))
  line.computeLineDistances()
  line.userData.sx = sx
  return line
}

function shoulderAt(side: Side): THREE.Vector3 {
  const s = side === 'left' ? REST.lShoulder.offset : REST.rShoulder.offset
  return new THREE.Vector3(s[0], REST.hips.offset[1] + REST.spine.offset[1] + REST.neck.offset[1] + s[1], 0)
}

/** World position of a cue target, or null when the ring should stay hidden. */
export function targetPosition(target: CueTarget, side: Side): THREE.Vector3 | null {
  switch (target.kind) {
    case 'dot': {
      const [x, y, z] = cupDots(side)[target.index]
      return new THREE.Vector3(x, y + 0.006, z)
    }
    case 'hole': {
      const [x, y, z] = nhptHoles(side)[target.index]
      return new THREE.Vector3(x, y + 0.014, z)
    }
    case 'ceiling': {
      const sh = shoulderAt(side)
      return new THREE.Vector3(sh.x, sh.y, CEILING_LENGTH)
    }
    default:
      return null
  }
}

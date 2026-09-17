import * as THREE from 'three'
import { cupDots, cupDotsMm, nhptHoles } from './layout'
import { makeCeilingLine, makeCup, makeCupSheet, makeDish, makeNhptBoard, makeTable, targetPosition } from './props'

test('cup sheet dots match board_spec: five dots on a 250 mm arc, 13° apart, symmetric', () => {
  const mm = cupDotsMm()
  expect(mm).toHaveLength(5)
  const cx = 148.5
  const cy = 92.5 + 250
  for (const [x, y] of mm) expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(250, 6)
  const angles = mm.map(([x, y]) => (Math.atan2(x - cx, cy - y) * 180) / Math.PI)
  for (let i = 1; i < 5; i++) expect(angles[i] - angles[i - 1]).toBeCloseTo(13, 6)
  expect(mm[2][0]).toBeCloseTo(cx, 6)
  // world order starts on the practising side
  expect(cupDots('left')[0][0]).toBeGreaterThan(0)
  expect(cupDots('right')[0][0]).toBeLessThan(0)
})

test('every prop builder returns a group with children', () => {
  expect(makeTable().children.length).toBeGreaterThan(0)
  expect(makeDish('left').group.children.length).toBeGreaterThan(0)
  expect(makeCup().mesh).toBeInstanceOf(THREE.Mesh)
})

test('cup sheet has five dots and swaps the target dot to amber', () => {
  const sheet = makeCupSheet('left')
  expect(sheet.dots).toHaveLength(5)
  const teal = (sheet.dots[0].material as THREE.MeshStandardMaterial).color.getHex()
  sheet.setTargetDot(2)
  expect((sheet.dots[2].material as THREE.MeshStandardMaterial).color.getHex()).not.toBe(teal)
  expect((sheet.dots[0].material as THREE.MeshStandardMaterial).color.getHex()).toBe(teal)
  sheet.setTargetDot(null)
  expect((sheet.dots[2].material as THREE.MeshStandardMaterial).color.getHex()).toBe(teal)
})

test('NHPT board has nine holes, shows seated pegs and highlights the target hole', () => {
  const board = makeNhptBoard('left')
  expect(board.holes).toHaveLength(9)
  board.setSeated(0)
  expect(board.pegs.filter((p) => p.visible)).toHaveLength(0)
  board.setSeated(4)
  expect(board.pegs.filter((p) => p.visible)).toHaveLength(4)
  board.setTargetHole(5)
  expect(board.holeRings[5].visible).toBe(true)
  expect(board.holeRings[4].visible).toBe(false)
  const h = nhptHoles('left')[5]
  const w = new THREE.Vector3()
  board.group.updateMatrixWorld(true)
  board.holes[5].getWorldPosition(w)
  expect(w.x).toBeCloseTo(h[0], 6)
  expect(w.z).toBeCloseTo(h[2], 6)
})

test('ceiling line is dashed amber from the shoulder straight forward, and targets resolve to stage positions', () => {
  const line = makeCeilingLine('left')
  expect(line.material).toBeInstanceOf(THREE.LineDashedMaterial)
  const dot = targetPosition({ kind: 'dot', index: 4 }, 'left')!
  expect(dot.x).toBeCloseTo(cupDots('left')[4][0], 6)
  const ceil = targetPosition({ kind: 'ceiling', index: 0 }, 'right')!
  expect(ceil.x).toBeLessThan(0)
  expect(ceil.z).toBeGreaterThan(0.5)
  expect(targetPosition({ kind: 'dish', index: 0 }, 'left')).toBeNull()
})

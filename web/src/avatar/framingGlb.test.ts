/** Framing of the Blender figure, checked on the shipped GLB (sampled by the independent reader in
 *  `src/test/glb.ts`, projected through the same three.js camera the stage builds):
 *  - Home: the whole standing figure, head to feet, sits inside the safe rect (clear of the view
 *    line, the caption bar and the label gutter) with room above the head; zoom still zooms.
 *  - Table tasks (cup, NHPT): head to table top, the sheet / board large enough to read (≥ 1.3×
 *    wider than the old head-to-feet framing); the close-up looks down more steeply and a little
 *    closer (sheet / board area ≥ 1.3× the wide view) and keeps the face and both shoulders; the
 *    wide view keeps the whole head. Every target anchor (the amber ring) is in view in both.
 *  - Joint pills sit in their gutter and never cover a body point, in every frame of the action. */
import { resolve } from 'node:path'
import * as THREE from 'three'
import { Glb, type V3 } from '../test/glb'
import { type Insets, actionBox, actionFrame, fitFraming, fitPoints, setSafeView, zoomAbout } from './framing'
import { glbFrames, glbPropPoints, isBodyNode, pitchFor } from './glbFraming'
import { bandRows, chooseGutter, gutterSide, placeLabels, stageInsets } from './labels'
import type { Side } from './layout'

const glb = new Glb(resolve(__dirname, '../../public/avatar/praxis_avatar.glb'))
const DUR: Record<string, number> = { idle: 8, abduction: 2.7, waiter_cup: 16, nhpt: 20.6 }

/** Every node's world position at 25 times across the action, mirrored in x for the right side. */
function sampled(action: string, side: Side) {
  const out: Map<string, V3>[] = []
  for (let i = 0; i <= 24; i++) {
    const w = glb.world(action, (DUR[action] * i) / 24)
    out.push(new Map([...w].map(([k, p]) => [k, side === 'right' ? ([-p[0], p[1], p[2]] as V3) : p])))
  }
  return out
}

function camFor(action: string, side: Side, view: 'front' | 'side', w: number, h: number, ins: Insets, o: { closeUp?: boolean; zoom?: number } = {}) {
  const frames = sampled(action, side)
  const table = action === 'waiter_cup' || action === 'nhpt'
  const props = table ? glbPropPoints(frames[0], action === 'nhpt' ? 'pegboard' : 'sheet') : []
  const frame = actionFrame({ frames: glbFrames(frames), propPoints: props, tableTop: table ? frames[0].get('prop_sheet')![1] : null, closeUp: o.closeUp })
  const cam = new THREE.PerspectiveCamera(34, 1, 0.05, 50)
  const aspect = setSafeView(cam, w, h, ins)
  const edge = ins.right > ins.left + 1 ? 1 : ins.left > ins.right + 1 ? -1 : 0
  const { eye, look } = zoomAbout(fitPoints(frame, view, side, aspect, cam.fov, pitchFor(table, !!o.closeUp)), frame.box, o.zoom ?? 1, edge)
  cam.position.copy(eye)
  cam.lookAt(look)
  cam.updateMatrixWorld(true)
  const px = (p: V3) => {
    const v = new THREE.Vector3(...p).project(cam)
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h }
  }
  return { cam, frames, px }
}

const HOME = { w: 420, h: 525 }
const homeInsets = (gutter: 'left' | 'right'): Insets => ({ top: 64, bottom: 48, left: gutter === 'left' ? 200 : 8, right: gutter === 'right' ? 200 : 8 })
const BODY = /^(head_leaf|foot_[LR]_leaf|foot_[LR]|hand_[LR]|middle_3_[LR]_leaf|upper_arm_[LR]|hips)$/

describe('Home frames the whole standing figure inside the safe rect', () => {
  for (const view of ['front', 'side'] as const) {
    for (const side of ['left', 'right'] as const) {
      test(`${view} · ${side}`, () => {
        const ins = homeInsets(gutterSide(view, side))
        const { frames, px } = camFor('idle', side, view, HOME.w, HOME.h, ins)
        let top = Infinity
        let bottom = -Infinity
        for (const f of frames) {
          for (const [name, p] of f) {
            if (!BODY.test(name)) continue
            const q = px(p)
            expect(q.x, name).toBeGreaterThanOrEqual(ins.left)
            expect(q.x, name).toBeLessThanOrEqual(HOME.w - ins.right)
            expect(q.y, name).toBeGreaterThanOrEqual(ins.top)
            expect(q.y, name).toBeLessThanOrEqual(HOME.h - ins.bottom)
            top = Math.min(top, q.y)
            bottom = Math.max(bottom, q.y)
          }
        }
        expect(top - ins.top).toBeGreaterThan(4) // a little room above the head
        expect(bottom - top).toBeGreaterThan(0.75 * (HOME.h - ins.top - ins.bottom)) // fills the height: not a speck
      })
    }
  }

  test('zoom 1.5 still zooms: the head stays in, the figure is bigger, the feet may leave', () => {
    const ins = homeInsets('left')
    const a = camFor('idle', 'left', 'front', HOME.w, HOME.h, ins)
    const b = camFor('idle', 'left', 'front', HOME.w, HOME.h, ins, { zoom: 1.5 })
    const span = (c: typeof a) => c.px(c.frames[0].get('hips')!).y - c.px(c.frames[0].get('head_leaf')!).y
    expect(span(b)).toBeGreaterThan(1.3 * span(a))
    expect(b.px(b.frames[0].get('head_leaf')!).y).toBeGreaterThan(ins.top)
    expect(b.px(b.frames[0].get('hand_L')!).y).toBeLessThan(HOME.h - ins.bottom)
  })
})

describe('table tasks: head to table top, the sheet / board readable; close-up steeper and tighter, face kept', () => {
  const DEMO = { w: 616, h: 385 }
  const ins: Insets = { top: 8, bottom: 56, left: 200, right: 8 }
  for (const action of ['waiter_cup', 'nhpt'] as const) {
    test(action, () => {
      const wide = camFor(action, 'left', 'front', DEMO.w, DEMO.h, ins)
      const close = camFor(action, 'left', 'front', DEMO.w, DEMO.h, ins, { closeUp: true })
      const prop = action === 'nhpt' ? 'prop_pegboard' : 'prop_sheet'
      for (const [c, keep] of [[wide, 'head_leaf'], [close, 'head']] as const) {
        for (const f of c.frames) {
          for (const n of [keep, 'hand_L', 'middle_3_L_leaf', 'upper_arm_L', 'upper_arm_R']) {
            const q = c.px(f.get(n)!)
            expect(q.y, `${action} ${n}`).toBeGreaterThanOrEqual(ins.top - 2)
            expect(q.y, `${action} ${n}`).toBeLessThanOrEqual(DEMO.h - ins.bottom)
            expect(q.x, `${action} ${n}`).toBeGreaterThanOrEqual(ins.left - 2)
            expect(q.x, `${action} ${n}`).toBeLessThanOrEqual(DEMO.w - ins.right + 2)
          }
        }
        // every target anchor (dot / hole: where the amber ring sits) is in the safe rect
        for (const [n, p] of c.frames[0]) {
          if (!n.startsWith('anchor_')) continue
          const q = c.px(p)
          expect(q.x, n).toBeGreaterThan(ins.left)
          expect(q.x, n).toBeLessThan(DEMO.w - ins.right)
          expect(q.y, n).toBeGreaterThan(ins.top)
          expect(q.y, n).toBeLessThan(DEMO.h - ins.bottom)
        }
      }
      // the sheet / board reads: its 14–30 cm width spans a real part of the stage
      const width = (c: typeof wide) => {
        const p = c.frames[0].get(prop)!
        return Math.abs(c.px([p[0] + 0.07, p[1], p[2]]).x - c.px([p[0] - 0.07, p[1], p[2]]).x)
      }
      // before 28 Sep: the whole action head to feet, box-fitted, full canvas, 24° pitch
      const frames = sampled(action, 'left')
      const before = new THREE.PerspectiveCamera(34, DEMO.w / DEMO.h, 0.05, 50)
      const old = fitFraming(actionBox({ frames: glbFrames(frames) }), 'front', 'left', DEMO.w / DEMO.h, 34, 24)
      before.position.copy(old.eye)
      before.lookAt(old.look)
      before.updateMatrixWorld(true)
      const p = frames[0].get(prop)!
      const oldWidth = Math.abs(new THREE.Vector3(p[0] + 0.07, p[1], p[2]).project(before).x - new THREE.Vector3(p[0] - 0.07, p[1], p[2]).project(before).x) * (DEMO.w / 2)
      const area = (c: typeof wide) => {
        const q = c.frames[0].get(prop)!
        return width(c) * Math.abs(c.px([q[0], q[1], q[2] + 0.07]).y - c.px([q[0], q[1], q[2] - 0.07]).y)
      }
      expect(width(wide)).toBeGreaterThan(1.3 * oldWidth)
      expect(area(close)).toBeGreaterThan(1.3 * area(wide))
      expect(width(close)).toBeGreaterThanOrEqual(width(wide))
    })
  }
})

describe('joint pills never cover the figure: the practising arm, hand and head stay visible', () => {
  const PILLS = { lShoulder: 'upper_arm_L', lElbow: 'forearm_L', lWrist: 'hand_L' } as const
  type J = keyof typeof PILLS
  const home: J[] = ['lShoulder', 'lElbow', 'lWrist']
  const cases: { name: string; action: string; view: 'front' | 'side'; w: number; h: number; captionH: number; overlayTop: number; joints: J[]; zoom?: number }[] = [
    { name: 'Home front', action: 'idle', view: 'front', w: 420, h: 525, captionH: 48, overlayTop: 64, joints: home },
    { name: 'Home side', action: 'idle', view: 'side', w: 420, h: 525, captionH: 48, overlayTop: 64, joints: home },
    { name: 'Home front zoom 1.5', action: 'idle', view: 'front', w: 420, h: 525, captionH: 48, overlayTop: 64, joints: home, zoom: 1.5 },
    { name: 'Home side zoom 1.5', action: 'idle', view: 'side', w: 420, h: 525, captionH: 48, overlayTop: 64, joints: home, zoom: 1.5 },
    { name: 'Demo abduction', action: 'abduction', view: 'front', w: 616, h: 385, captionH: 72, overlayTop: 0, joints: ['lShoulder'] },
    { name: 'Demo cup', action: 'waiter_cup', view: 'front', w: 616, h: 385, captionH: 72, overlayTop: 0, joints: ['lWrist'] },
    { name: 'Live abduction (narrow)', action: 'abduction', view: 'front', w: 288, h: 360, captionH: 48, overlayTop: 0, joints: ['lShoulder'] },
    { name: 'Live NHPT (narrow)', action: 'nhpt', view: 'front', w: 288, h: 360, captionH: 48, overlayTop: 0, joints: ['lWrist'] },
  ]
  for (const c of cases) {
    for (const side of ['left', 'right'] as const) {
      test(`${c.name} · ${side}`, () => {
        const chipW = 190
        const gutter = chooseGutter(c.w, chipW, gutterSide(c.view, side))
        const widths: Record<string, number> = Object.fromEntries(c.joints.map((j) => [j, chipW]))
        const rows = gutter === 'top' ? bandRows(Object.values(widths), c.w) : 1
        const ins = stageInsets({ gutter, chipW, captionH: c.captionH, overlayTop: c.overlayTop, rows })
        const { frames, px } = camFor(c.action, side, c.view, c.w, c.h, ins, { zoom: c.zoom })
        for (const f of frames) {
          const anchors = c.joints.map((j) => ({ id: j, ...px(f.get(PILLS[j])!) }))
          const pills = placeLabels(anchors, widths, { w: c.w, h: c.h, gutter, insets: ins, captionH: c.captionH, overlayTop: c.overlayTop })
          for (const p of pills) {
            expect(p.x).toBeGreaterThanOrEqual(0)
            expect(p.x + p.w).toBeLessThanOrEqual(c.w)
            expect(p.y + p.h).toBeLessThanOrEqual(c.h - c.captionH)
            for (const [n, q] of f) {
              if (!isBodyNode(n)) continue
              const s = px(q)
              const inside = s.x > p.x - 4 && s.x < p.x + p.w + 4 && s.y > p.y - 4 && s.y < p.y + p.h + 4
              expect(inside, `${n} under the ${p.id} pill`).toBe(false)
            }
          }
          if (c.view === 'front' && c.action !== 'waiter_cup' && c.action !== 'nhpt') {
            // leader lines stay on the arm's side of the body: none crosses the torso's midline
            const mid = px(f.get('chest')!).x
            for (const p of pills) expect(Math.sign(p.x1 - mid), `${p.id} leader crosses the torso`).toBe(Math.sign(p.x2 - mid))
          }
          for (let i = 0; i < pills.length; i++)
            for (let k = i + 1; k < pills.length; k++) {
              const a = pills[i]
              const b = pills[k]
              expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true)
            }
        }
      })
    }
  }
})

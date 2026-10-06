import * as THREE from 'three'
import { type Frame, type Insets, NO_INSETS, actionFrame, fitPoints, framingPreset, setSafeView, zoomAbout } from './framing'
import { type GlbAction, type StageJoint, JOINT_BONE, advanceGlbClock, boneFor, stepAt, targetAt } from './glbActions'
import { AvatarInstance, type AvatarAsset } from './glbAsset'
import { glbPropPoints, isBodyNode, pitchFor } from './glbFraming'
import { TABLE_Y, type Side } from './layout'
import { MARKER_STYLE, type Marker } from './markers'
import type { Clock, Projection, Tick } from './scene'
import { type Script, advanceScriptClock, scriptAt, scriptCaption, stepAtActionTime } from './script'
import { AMBER, MINT, makeRenderer, makeStage } from './stage'

export type GlbStageProps = {
  asset: AvatarAsset
  action: GlbAction
  side: Side
  clock: { current: Clock }
  camera: 'front' | 'side'
  closeUp: boolean
  compact: boolean
  showCues: boolean
  markers: Marker[]
  /** Demonstration script (step text + time warp) for this action, if it has one. */
  script?: Script | null
  /** Stage pixels the figure is kept clear of (view line, caption bar, label gutter). */
  insets?: Insets
  /** Home zoom (1 = the whole figure). */
  zoom?: number
  onTick?: (t: Tick) => void
  onProject?: (p: Projection) => void
  onContextLost?: () => void
  /** Further joints (rig joints, sheet dots `dot1..dot5`, `cup`) to project for the host's
   *  overlays (hotspots, theater angle readouts, session cup reference). */
  extraJoints?: readonly string[]
}

type P3 = readonly [number, number, number]
/** Nodes that place a table task's sheet, board, cup, pegs and target anchors in view. */
const TABLE_PROP_NODES = [
  'prop_sheet',
  'prop_pegboard',
  'prop_cup',
  ...[1, 2, 3, 4, 5].map((i) => `anchor_dot_${i}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((i) => [`anchor_hole_${i}`, `prop_peg_${i}`]),
]

/** Ring radius scale per target kind (the torus is 6 cm; a sheet dot is ~2.5 cm, a hole ~1 cm). */
const RING_SCALE = { dot: 0.45, hole: 0.3 }
/** The GLB's feet stand on y = 0 (the procedural bust stands on a plinth at the hips). */
const GLB_FLOOR_Y = 0

/** Imperative owner of the WebGL scene for the Blender-built avatar: one renderer, one cloned
 *  avatar with one AnimationMixer, one render loop. The panel's clock owns time; each frame the
 *  stage advances it (free-running × speed through the action's demonstration script when it has
 *  one, or eased toward the patient's rep progress) and sets the action time. Cues: the amber ring
 *  sits on the anchor of the dot / hole being reached (meta.targets), joint dots and halos follow
 *  the marker bones. The camera frames the space the action uses inside the stage's safe rect
 *  (clear of the labels and captions). Nothing here scores anyone. */
export class GlbStage {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private cam = new THREE.PerspectiveCamera(34, 1, 0.05, 20)
  private stage
  private inst: AvatarInstance
  private side: Side | null = null
  private tableTop: number
  private cues = new THREE.Group()
  private ring: THREE.Mesh
  private dots = new Map<string, { dot: THREE.Mesh; halo: THREE.Mesh }>()
  private raf = 0
  private frames = 0
  private last = 0
  private lastTick = 0
  private lost = false
  private ro: ResizeObserver
  private look = new THREE.Vector3(0, 1.3, 0)
  private tmp = new THREE.Vector3()
  private hand = new THREE.Vector3()
  private framedFor = ''
  private fittedFor = ''
  private frame: Frame | null = null
  private fit = { eye: new THREE.Vector3(0, 1.3, 2.5), look: new THREE.Vector3(0, 1, 0) }
  input: GlbStageProps

  constructor(private el: HTMLElement, input: GlbStageProps) {
    this.input = input
    this.renderer = makeRenderer()
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.addEventListener('webglcontextlost', this.onLost, false)
    el.appendChild(this.renderer.domElement)
    this.stage = makeStage(this.scene, this.renderer, GLB_FLOOR_Y)
    this.inst = new AvatarInstance(input.asset)
    this.scene.add(this.inst.root)
    this.inst.setTime(0)
    this.tableTop = this.inst.worldPosition('prop_sheet', this.tmp).y || TABLE_Y
    this.scene.add(this.cues)
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.006, 16, 48), new THREE.MeshBasicMaterial({ color: AMBER }))
    this.ring.add(
      new THREE.Mesh(
        new THREE.TorusGeometry(0.06, 0.016, 16, 48),
        new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }),
      ),
    )
    this.ring.rotation.set(-Math.PI / 2, 0, 0)
    this.ring.visible = false
    this.cues.add(this.ring)
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(el)
    this.resize()
    this.raf = requestAnimationFrame(this.render)
  }

  private onLost = (e: Event) => {
    e.preventDefault()
    this.lost = true
    cancelAnimationFrame(this.raf)
    this.input.onContextLost?.()
  }

  private resize() {
    const w = this.el.clientWidth || 300
    const h = this.el.clientHeight || 300
    this.renderer.setSize(w, h, true)
    this.fittedFor = '' // re-fit the camera to the new safe rect
  }

  /** What the camera frames for this action (`actionFrame`): the rig's joints and bone tips
   *  sampled across the whole action, plus a table task's sheet / board, cup, pegs and target
   *  anchors. Sampled once per action, side and close-up, so the view stays still while it plays. */
  private sampleFrame(meta: { duration: number; props: string[] }, closeUp: boolean, restoreTime: number): Frame {
    const nodes: THREE.Object3D[] = []
    this.inst.root.traverse((o) => {
      // joints plus the exported bone tips (`*_leaf`: top of the head, fingertips, toes)
      if (((o as THREE.Bone).isBone || o.name.endsWith('_leaf')) && isBodyNode(o.name)) nodes.push(o)
    })
    const v = new THREE.Vector3()
    const frames: Map<string, P3>[] = []
    for (let i = 0; i <= 24; i++) {
      this.inst.setTime((meta.duration * i) / 24)
      this.inst.root.updateMatrixWorld(true)
      frames.push(new Map(nodes.map((b) => (b.getWorldPosition(v), [b.name, [v.x, v.y, v.z] as P3]))))
    }
    this.inst.setTime(0)
    const table = meta.props.includes('table')
    let propPoints: P3[] = []
    if (table) {
      const at = new Map(TABLE_PROP_NODES.filter((n) => this.inst.node(n)).map((n) => (this.inst.worldPosition(n, v), [n, [v.x, v.y, v.z] as P3])))
      propPoints = glbPropPoints(at, meta.props.includes('pegboard') ? 'pegboard' : 'sheet')
    }
    this.inst.setTime(restoreTime)
    return actionFrame({ frames, propPoints, tableTop: table ? this.tableTop : null, closeUp })
  }

  /** Dot + halo for a marker joint, created on first use; drawn over the figure (no depth test). */
  private dotFor(joint: string) {
    let d = this.dots.get(joint)
    if (!d) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.022, 20, 14), new THREE.MeshBasicMaterial({ color: MINT, depthTest: false }))
      dot.renderOrder = 10
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 20, 14),
        new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.3, depthTest: false, depthWrite: false }),
      )
      halo.renderOrder = 9
      dot.add(halo)
      this.cues.add(dot)
      d = { dot, halo }
      this.dots.set(joint, d)
    }
    return d
  }

  private render = (now: number) => {
    if (this.lost) return
    const p = this.input
    const dt = this.frames === 0 ? 0 : Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    if (p.side !== this.side) {
      this.side = p.side
      this.inst.setSide(p.side)
    }
    const meta = this.inst.setAction(p.action)
    const clock = p.clock.current
    const script = p.script ?? null
    const { ended } = script ? advanceScriptClock(clock, dt, script, meta) : advanceGlbClock(clock, dt, meta)
    this.inst.setTime(clock.time)

    // cue layer: amber ring on the target being reached; marker dots on their bones
    this.cues.visible = p.showCues
    const target = targetAt(meta.targets, clock.time)
    this.ring.visible = !!target
    if (target) {
      this.inst.worldPosition(`anchor_${target.kind}_${target.index}`, this.ring.position)
      this.ring.position.y += 0.004
      this.ring.scale.setScalar(RING_SCALE[target.kind])
    }
    const shown = new Set<string>()
    for (const m of p.markers) {
      const d = this.dotFor(m.joint)
      shown.add(m.joint)
      d.dot.visible = true
      this.inst.worldPosition(boneFor(m.joint, p.side), d.dot.position)
      const c = MARKER_STYLE[m.status].color
      ;(d.dot.material as THREE.MeshBasicMaterial).color.set(c)
      ;(d.halo.material as THREE.MeshBasicMaterial).color.set(c)
    }
    for (const [j, d] of this.dots) if (!shown.has(j)) d.dot.visible = false

    // camera: fit the space the action uses into the safe rect (clear of the labels and the
    // caption bar). A table close-up frames its own tighter set; an exercise close-up follows the
    // hand. Frame-rate independent ease between framings.
    const hasTable = meta.props.includes('table')
    const w = this.el.clientWidth || 300
    const h = this.el.clientHeight || 300
    const ins = p.insets ?? NO_INSETS
    const tableClose = hasTable && p.closeUp
    const frameKey = `${p.action}|${p.side}|${tableClose}`
    if (frameKey !== this.framedFor) {
      this.framedFor = frameKey
      this.frame = this.sampleFrame(meta, tableClose, clock.time)
      this.fittedFor = ''
    }
    const zoom = p.zoom ?? 1
    const fitKey = `${frameKey}|${p.camera}|${w}x${h}|${ins.top},${ins.right},${ins.bottom},${ins.left}|${zoom}`
    if (fitKey !== this.fittedFor) {
      this.fittedFor = fitKey
      const aspect = setSafeView(this.cam, w, h, ins)
      const f = fitPoints(this.frame!, p.camera, p.side, aspect, this.cam.fov, pitchFor(hasTable, tableClose))
      // zoom grows the figure away from the label gutter (the wider inset), never under it
      const edge = ins.right > ins.left + 1 ? 1 : ins.left > ins.right + 1 ? -1 : 0
      this.fit = tableClose ? f : zoomAbout(f, this.frame!.box, zoom, edge)
    }
    let { eye, look } = this.fit
    if (p.closeUp && !hasTable) {
      this.inst.worldPosition(boneFor(p.side === 'right' ? 'rHand' : 'lHand', p.side), this.hand)
      ;({ eye, look } = framingPreset({ camera: p.camera, closeUp: true, compact: p.compact, side: p.side, hasTable, tall: false }, this.hand))
    }
    const k = this.frames === 0 ? 1 : 1 - Math.pow(0.001, dt)
    this.cam.position.lerp(eye, k)
    this.look.lerp(look, k)
    this.cam.lookAt(this.look)
    this.renderer.render(this.scene, this.cam)
    this.frames += 1

    if (p.onProject) {
      const out: Projection = {}
      const project = (name: string, bone: string) => {
        this.inst.worldPosition(bone, this.tmp).project(this.cam)
        out[name] = { x: ((this.tmp.x + 1) / 2) * w, y: ((1 - this.tmp.y) / 2) * h }
      }
      for (const m of p.markers) project(m.joint, boneFor(m.joint, p.side))
      for (const j of p.extraJoints ?? []) if (!out[j] && j in JOINT_BONE) project(j, boneFor(j as StageJoint, p.side))
      project('centre', 'chest')
      p.onProject(out)
    }
    if (p.onTick && (ended || now - this.lastTick > 100)) {
      this.lastTick = now
      if (script) {
        const step = clock.target != null ? stepAtActionTime(script, clock.time) : scriptAt(script, clock.warp ?? 0).step
        p.onTick({ caption: scriptCaption(script, step), step, ended, t: clock.time, angleDeg: null })
      } else {
        const s = stepAt(meta.steps, clock.time)
        p.onTick({ caption: s.caption, step: s.step, ended, t: clock.time, angleDeg: null })
      }
    }
    this.raf = requestAnimationFrame(this.render)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onLost)
    this.cues.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
    })
    this.inst.dispose()
    this.stage.dispose()
    this.renderer.dispose()
    if (this.renderer.domElement.parentNode === this.el) this.el.removeChild(this.renderer.domElement)
  }
}

import * as THREE from 'three'
import { type Box, fitFraming, framingPreset } from './framing'
import { type GlbAction, advanceGlbClock, boneFor, stepAt, targetAt } from './glbActions'
import { AvatarInstance, type AvatarAsset } from './glbAsset'
import { TABLE_Y, type Side } from './layout'
import { MARKER_STYLE, type Marker } from './markers'
import type { Clock, Projection, Tick } from './scene'
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
  onTick?: (t: Tick) => void
  onProject?: (p: Projection) => void
  onContextLost?: () => void
}

/** Ring radius scale per target kind (the torus is 6 cm; a sheet dot is ~2.5 cm, a hole ~1 cm). */
const RING_SCALE = { dot: 0.45, hole: 0.3 }
/** The GLB's feet stand on y = 0 (the procedural bust stands on a plinth at the hips). */
const GLB_FLOOR_Y = 0

/** Imperative owner of the WebGL scene for the Blender-built avatar: one renderer, one cloned
 *  avatar with one AnimationMixer, one render loop. The panel's clock owns time; each frame the
 *  stage advances it (free-running × speed, or eased toward the patient's rep progress) and sets
 *  the action time. Cues: the amber ring sits on the anchor of the dot / hole being reached
 *  (meta.targets), joint dots and halos follow the marker bones. Nothing here scores anyone. */
export class GlbStage {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private cam = new THREE.PerspectiveCamera(34, 1, 0.1, 20)
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
  private box: Box = { min: new THREE.Vector3(-0.5, 0, -0.3), max: new THREE.Vector3(0.5, 1.85, 0.5) }
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
    this.cam.aspect = w / h
    this.cam.updateProjectionMatrix()
  }

  /** The space an action uses: every bone sampled across the action (plus the sheet or pegboard
   *  for a table task), padded for the body's thickness. The camera frames this box, so each
   *  exercise fills the panel and the view stays still while it plays. */
  private sampleBox(meta: { duration: number; props: string[] }, restoreTime: number): Box {
    const box = new THREE.Box3()
    const bones: THREE.Object3D[] = []
    this.inst.root.traverse((o) => {
      // joints plus the exported bone tips (`*_leaf`: top of the head, fingertips, toes)
      if ((o as THREE.Bone).isBone || o.name.endsWith('_leaf')) bones.push(o)
    })
    const v = new THREE.Vector3()
    for (let i = 0; i <= 24; i++) {
      this.inst.setTime((meta.duration * i) / 24)
      this.inst.root.updateMatrixWorld(true)
      for (const b of bones) box.expandByPoint(b.getWorldPosition(v))
    }
    for (const [prop, node] of [['sheet', 'prop_sheet'], ['pegboard', 'prop_pegboard']] as const) {
      if (!meta.props.includes(prop)) continue
      this.inst.worldPosition(node, v)
      box.expandByPoint(v.clone().add(new THREE.Vector3(0.14, 0, 0.1)))
      box.expandByPoint(v.clone().add(new THREE.Vector3(-0.14, 0, -0.1)))
    }
    this.inst.setTime(restoreTime)
    box.expandByScalar(0.07)
    return { min: box.min, max: box.max }
  }

  /** Dot + additive halo for a marker joint, created on first use. */
  private dotFor(joint: string) {
    let d = this.dots.get(joint)
    if (!d) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), new THREE.MeshBasicMaterial({ color: MINT }))
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.034, 16, 12),
        new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }),
      )
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
    const { ended } = advanceGlbClock(clock, dt, meta)
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

    // camera: frame the space the action uses (sampled once per action and side); the hand
    // close-up keeps its preset. Frame-rate independent ease between framings.
    const hasTable = meta.props.includes('table')
    const key = `${p.action}|${p.side}`
    if (key !== this.framedFor) {
      this.framedFor = key
      this.box = this.sampleBox(meta, clock.time)
      // Home's body map is about the arm and hand: frame the upper body (hands included), not the feet
      if (p.compact && p.action === 'idle') this.box.min.y = Math.max(this.box.min.y, 0.62)
    }
    this.inst.worldPosition(boneFor(p.side === 'right' ? 'rHand' : 'lHand', p.side), this.hand)
    const { eye, look } = p.closeUp
      ? framingPreset(
          { camera: p.camera, closeUp: true, compact: p.compact, side: p.side, hasTable, tall: false, yShift: hasTable ? this.tableTop - TABLE_Y : 0 },
          this.hand,
        )
      : fitFraming(this.box, p.camera, p.side, this.cam.aspect, this.cam.fov, hasTable ? 24 : 6)
    const k = this.frames === 0 ? 1 : 1 - Math.pow(0.001, dt)
    this.cam.position.lerp(eye, k)
    this.look.lerp(look, k)
    this.cam.lookAt(this.look)
    this.renderer.render(this.scene, this.cam)
    this.frames += 1

    if (p.onProject) {
      const out: Projection = {}
      const w = this.el.clientWidth || 300
      const h = this.el.clientHeight || 300
      const project = (name: string, bone: string) => {
        this.inst.worldPosition(bone, this.tmp).project(this.cam)
        out[name] = { x: ((this.tmp.x + 1) / 2) * w, y: ((1 - this.tmp.y) / 2) * h }
      }
      for (const m of p.markers) project(m.joint, boneFor(m.joint, p.side))
      project('centre', 'chest')
      p.onProject(out)
    }
    if (p.onTick && (ended || now - this.lastTick > 100)) {
      this.lastTick = now
      const s = stepAt(meta.steps, clock.time)
      p.onTick({ caption: s.caption, step: s.step, ended, t: clock.time, angleDeg: null })
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

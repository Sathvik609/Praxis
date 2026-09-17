import * as THREE from 'three'
import { PLINTH_DEPTH } from './body'
import type { Clip } from './clips'
import { makeFigure } from './figure'
import { MARKER_STYLE, type Marker } from './markers'
import { makeCeilingLine, makeCup, makeCupSheet, makeDish, makeNhptBoard, makeTable, targetPosition, type Board, type Cup, type CupSheet, type Dish } from './props'
import { JOINTS, REST, forwardKinematics, type Joint, type Vec3 } from './rig'
import { sample, type Sample } from './sampler'
import { makeSkeletonFigure } from './skeleton'
import { AMBER, MINT, makeRenderer, makeStage } from './stage'

export type Projection = Record<string, { x: number; y: number }>

/** Mutable playback state owned by the panel and advanced by the stage's loop. */
export type Clock = { time: number; playing: boolean; speed: number }
export type Tick = { caption: string; step: number; ended: boolean; t: number; angleDeg: number | null }
/** How the rig is drawn: the ceramic mannequin or the glowing skeleton with the angle arcs. */
export type FigureMode = 'body' | 'skeleton'

export type StageProps = {
  clip: Clip
  clock: { current: Clock }
  camera: 'front' | 'side'
  closeUp: boolean
  compact: boolean
  showCues: boolean
  markers: Marker[]
  figure?: FigureMode
  onTick?: (t: Tick) => void
  onProject?: (p: Projection) => void
  onContextLost?: () => void
}

/** Camera presets (plan B5): front 2.6 m / target 1.30 (Home compact 2.2 m / 1.36), side from
 *  the practising side, close-up 1.5 m on the hand. Table clips look down a little so the sheet reads. */
export function cameraPreset(input: Pick<StageProps, 'clip' | 'camera' | 'closeUp' | 'compact'>, hand: THREE.Vector3): { eye: THREE.Vector3; look: THREE.Vector3 } {
  const { clip, camera, closeUp, compact } = input
  const sx = clip.side === 'right' ? -1 : 1
  const hasTable = clip.props.includes('table')
  if (closeUp) {
    const look = hand.clone()
    const eye = camera === 'side' ? new THREE.Vector3(sx * 1.5, look.y + 0.3, look.z + 0.2) : new THREE.Vector3(look.x * 0.5, look.y + 0.45, look.z + 1.35)
    return { eye, look }
  }
  // arm-elevation clips reach overhead (hand at ~2.1 m): frame a little taller and further back
  const tall = !!clip.arc
  const dist = (compact ? 2.25 : 2.3) + (tall ? 0.25 : 0)
  const y = (hasTable ? (compact ? 1.26 : 1.22) : compact ? 1.36 : 1.3) + (tall ? 0.1 : 0)
  if (camera === 'side') return { eye: new THREE.Vector3(sx * dist, y + 0.12, 0.2), look: new THREE.Vector3(0, y, 0.16) }
  return { eye: new THREE.Vector3(0.08, y + (hasTable ? 0.5 : 0.12), dist), look: new THREE.Vector3(0, y - (hasTable ? 0.02 : 0), 0.05) }
}

/** The floor of the stage: the plinth bottom, a hair above the disc. */
export const FLOOR_Y = REST.hips.offset[1] - PLINTH_DEPTH - 0.004

function v(a: Vec3) {
  return new THREE.Vector3(a[0], a[1], a[2])
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh
    if (m.geometry) m.geometry.dispose()
    const mat = (m as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
    else mat?.dispose()
  })
}

type Props = {
  group: THREE.Group
  clip: Clip
  sheet?: CupSheet
  cup?: Cup
  board?: Board
  dish?: Dish
}

/** Imperative owner of the WebGL scene: one renderer, one figure, one render loop. React only
 *  mounts it and pushes props. The cue layer follows the sampler: the amber ring sits on the
 *  target being reached, the mint tube shows only the reach in progress, joint dots carry the
 *  marker colour. Nothing here scores anyone. */
export class AvatarStage {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private cam = new THREE.PerspectiveCamera(34, 1, 0.1, 20)
  private stage
  private figure: ReturnType<typeof makeFigure> | null = null
  private skeleton: ReturnType<typeof makeSkeletonFigure> | null = null
  private mode: FigureMode = 'body'
  private cues = new THREE.Group()
  private path: THREE.Group | null = null
  private pathKey = ''
  private ring: THREE.Mesh
  private ringGlow: THREE.Mesh
  private dots: Partial<Record<Joint, THREE.Mesh>> = {}
  private halos: Partial<Record<Joint, THREE.Mesh>> = {}
  private props: Props | null = null
  private raf = 0
  private frames = 0
  private last = 0
  private lastTick = 0
  private lost = false
  private ro: ResizeObserver
  private look = new THREE.Vector3(0, 1.3, 0)
  input: StageProps

  constructor(private el: HTMLElement, input: StageProps) {
    this.input = input
    this.renderer = makeRenderer()
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.addEventListener('webglcontextlost', this.onLost, false)
    el.appendChild(this.renderer.domElement)
    this.stage = makeStage(this.scene, this.renderer, FLOOR_Y)
    this.setFigure(input.figure ?? 'body')
    this.scene.add(this.cues)
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.006, 16, 48), new THREE.MeshBasicMaterial({ color: AMBER }))
    this.ringGlow = new THREE.Mesh(
      new THREE.TorusGeometry(0.06, 0.016, 16, 48),
      new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    this.ring.add(this.ringGlow)
    this.ring.visible = false
    this.cues.add(this.ring)
    for (const j of JOINTS) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), new THREE.MeshBasicMaterial({ color: MINT }))
      d.visible = false
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.034, 16, 12),
        new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }),
      )
      d.add(halo)
      this.cues.add(d)
      this.dots[j] = d
      this.halos[j] = halo
    }
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(el)
    this.resize()
    this.raf = requestAnimationFrame(this.render)
  }

  /** Build the requested figure (body or skeleton), disposing the other. */
  private setFigure(mode: FigureMode) {
    if (this.figure) {
      this.scene.remove(this.figure.group)
      this.figure.dispose()
      this.figure = null
    }
    if (this.skeleton) {
      this.scene.remove(this.skeleton.group)
      this.skeleton.dispose()
      this.skeleton = null
    }
    this.mode = mode
    if (mode === 'skeleton') {
      this.skeleton = makeSkeletonFigure()
      this.scene.add(this.skeleton.group)
    } else {
      this.figure = makeFigure()
      this.scene.add(this.figure.group)
    }
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

  /** Build the props a clip names (table, sheet, cup, board, dish, ceiling line) for its side. */
  private buildProps(clip: Clip) {
    if (this.props) {
      this.scene.remove(this.props.group)
      disposeTree(this.props.group)
    }
    const group = new THREE.Group()
    const out: Props = { group, clip }
    for (const p of clip.props) {
      if (p === 'table') group.add(makeTable())
      if (p === 'cupSheet') {
        out.sheet = makeCupSheet(clip.side)
        group.add(out.sheet.group)
      }
      if (p === 'cup') {
        out.cup = makeCup()
        group.add(out.cup.mesh)
      }
      if (p === 'nhptBoard') {
        out.board = makeNhptBoard(clip.side)
        group.add(out.board.group)
      }
      if (p === 'dish') {
        out.dish = makeDish(clip.side)
        group.add(out.dish.group)
      }
      if (p === 'ceiling') group.add(makeCeilingLine(clip.side))
    }
    this.scene.add(group)
    this.props = out
    this.pathKey = ''
  }

  /** Mint tube along the practising hand's path for the reach in progress (rebuilt on segment change). */
  private updatePath(clip: Clip, s: Sample) {
    const key = s.segment && clip.pathJoint ? `${clip.name}:${clip.side}:${s.segment[0]}` : ''
    if (key === this.pathKey) return
    this.pathKey = key
    if (this.path) {
      this.cues.remove(this.path)
      disposeTree(this.path)
      this.path = null
    }
    if (!key || !s.segment || !clip.pathJoint) return
    const [t0, t1] = s.segment
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 32; i++) pts.push(v(forwardKinematics(sample(clip, t0 + ((t1 - t0) * i) / 32).angles)[clip.pathJoint]))
    const curve = new THREE.CatmullRomCurve3(pts)
    const g = new THREE.Group()
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.008, 8, false), new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.9, depthWrite: false })))
    g.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, 64, 0.02, 8, false),
        new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }),
      ),
    )
    this.cues.add(g)
    this.path = g
  }

  private render = (now: number) => {
    if (this.lost) return
    const p = this.input
    const dt = this.frames === 0 ? 0 : Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    const clock = p.clock.current
    if (clock.playing) clock.time += dt
    let ended = false
    if (!p.clip.loop && clock.time * clock.speed >= p.clip.duration) {
      clock.time = p.clip.duration / clock.speed
      if (clock.playing) ended = true
      clock.playing = false
    }
    if (!this.props || this.props.clip !== p.clip) this.buildProps(p.clip)
    const wanted = p.figure ?? 'body'
    if (wanted !== this.mode) this.setFigure(wanted)
    const s = sample(p.clip, clock.time, clock.speed)
    let angleDeg: number | null = null
    if (this.skeleton) {
      const focus = p.markers.find((m) => m.status === 'focus')?.joint ?? p.clip.focusJoint ?? null
      this.skeleton.update({ angles: s.angles, pinch: s.pinch, breath: s.breath }, { focus, arc: p.showCues ? (p.clip.arc ?? null) : null, time: now / 1000 })
      angleDeg = this.skeleton.currentDeg()
    } else this.figure!.update({ angles: s.angles, pinch: s.pinch, breath: s.breath })
    const pos = forwardKinematics(s.angles)
    const handJoint: Joint = p.clip.side === 'left' ? 'lHand' : 'rHand'
    const hand = v(pos[handJoint])

    // props follow the sampler's carry / parked state
    const pr = this.props!
    if (pr.cup) {
      if (s.carry === 'cup') pr.cup.holdAt(hand)
      else {
        const d = pr.sheet?.dots[s.parked]
        if (d) pr.cup.placeOnTable(d.position.x, d.position.z)
      }
    }
    if (pr.board) {
      pr.board.setSeated(s.parked)
      pr.board.setTargetHole(s.target?.kind === 'hole' ? s.target.index : null)
    }
    if (pr.dish) {
      pr.dish.setCarried(s.carry === 'peg')
      if (s.carry === 'peg') pr.dish.holdPegAt(hand)
    }
    pr.sheet?.setTargetDot(s.target?.kind === 'dot' ? s.target.index : null)

    // cue layer
    this.cues.visible = p.showCues
    this.updatePath(p.clip, s)
    const tp = s.target ? targetPosition(s.target, p.clip.side) : null
    this.ring.visible = !!tp
    if (tp) {
      this.ring.position.copy(tp)
      if (s.target!.kind === 'ceiling') this.ring.lookAt(this.cam.position)
      else this.ring.rotation.set(-Math.PI / 2, 0, 0)
    }
    for (const j of JOINTS) {
      const mk = p.markers.find((m) => m.joint === j)
      const d = this.dots[j]!
      d.visible = !!mk
      if (mk) {
        d.position.copy(v(pos[j]))
        const c = MARKER_STYLE[mk.status].color
        ;(d.material as THREE.MeshBasicMaterial).color.set(c)
        ;(this.halos[j]!.material as THREE.MeshBasicMaterial).color.set(c)
      }
    }

    // camera: frame-rate independent ease toward the preset
    const { eye, look } = cameraPreset(p, hand)
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
      const tmp = new THREE.Vector3()
      const project = (name: string, x: number, y: number, z: number) => {
        tmp.set(x, y, z).project(this.cam)
        out[name] = { x: ((tmp.x + 1) / 2) * w, y: ((1 - tmp.y) / 2) * h }
      }
      for (const j of JOINTS) project(j, ...pos[j])
      project('centre', pos.spine[0], pos.spine[1], pos.spine[2])
      p.onProject(out)
    }
    if (p.onTick && (ended || now - this.lastTick > 100)) {
      this.lastTick = now
      p.onTick({ caption: s.caption, step: s.step, ended, t: s.t, angleDeg })
    }
    this.raf = requestAnimationFrame(this.render)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onLost)
    disposeTree(this.cues)
    if (this.props) disposeTree(this.props.group)
    this.figure?.dispose()
    this.skeleton?.dispose()
    this.stage.dispose()
    this.renderer.dispose()
    if (this.renderer.domElement.parentNode === this.el) this.el.removeChild(this.renderer.domElement)
  }
}

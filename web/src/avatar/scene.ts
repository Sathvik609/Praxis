import * as THREE from 'three'
import { PLINTH_DEPTH } from './body'
import type { Clip } from './clips'
import { makeFigure } from './figure'
import { MARKER_STYLE, type Marker } from './markers'
import { JOINTS, REST, forwardKinematics, type Joint, type Vec3 } from './rig'
import { sample } from './sampler'
import { AMBER, MINT, makeRenderer, makeStage } from './stage'

export type Projection = Record<string, { x: number; y: number }>

export type StageProps = {
  clip: Clip
  getTime: () => number
  speed: number
  camera: 'front' | 'side'
  closeUp: boolean
  showCues: boolean
  markers: Marker[]
  onProject?: (p: Projection) => void
}

/** The floor of the stage: the plinth bottom, a hair above the disc. */
export const FLOOR_Y = REST.hips.offset[1] - PLINTH_DEPTH - 0.004

function v(a: Vec3) {
  return new THREE.Vector3(a[0], a[1], a[2])
}

/** Imperative owner of the WebGL scene: one renderer, one figure, one render loop. React only
 *  mounts it and pushes props. */
export class AvatarStage {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private cam = new THREE.PerspectiveCamera(34, 1, 0.1, 20)
  private stage
  private figure
  private cues = new THREE.Group()
  private tube: THREE.Mesh | null = null
  private ring: THREE.Mesh
  private dots: Partial<Record<Joint, THREE.Mesh>> = {}
  private halos: Partial<Record<Joint, THREE.Mesh>> = {}
  private raf = 0
  private frames = 0
  private lastProject = 0
  private ro: ResizeObserver
  private tubeClip: Clip | null = null
  props: StageProps

  constructor(private el: HTMLElement, props: StageProps) {
    this.props = props
    this.renderer = makeRenderer()
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.domElement.style.display = 'block'
    el.appendChild(this.renderer.domElement)
    this.stage = makeStage(this.scene, this.renderer, FLOOR_Y)
    this.figure = makeFigure()
    this.scene.add(this.figure.group)
    this.scene.add(this.cues)
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.006, 16, 48), new THREE.MeshBasicMaterial({ color: AMBER }))
    this.cues.add(this.ring)
    for (const j of JOINTS) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), new THREE.MeshBasicMaterial({ color: MINT }))
      d.visible = false
      this.cues.add(d)
      this.dots[j] = d
    }
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(el)
    this.resize()
    this.raf = requestAnimationFrame(this.render)
  }

  private resize() {
    const w = this.el.clientWidth || 300
    const h = this.el.clientHeight || 300
    this.renderer.setSize(w, h, true)
    this.cam.aspect = w / h
    this.cam.updateProjectionMatrix()
  }

  private rebuildTube(clip: Clip) {
    if (this.tube) {
      this.cues.remove(this.tube)
      this.tube.geometry.dispose()
      ;(this.tube.material as THREE.Material).dispose()
      this.tube = null
    }
    this.tubeClip = clip
    if (!clip.pathJoint) return
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 48; i++) pts.push(v(forwardKinematics(sample(clip, (i / 48) * clip.duration).angles)[clip.pathJoint]))
    this.tube = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, 0.008, 8, false),
      new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.85 }),
    )
    this.cues.add(this.tube)
  }

  private render = () => {
    const p = this.props
    if (this.tubeClip !== p.clip) this.rebuildTube(p.clip)
    const s = sample(p.clip, p.getTime(), p.speed)
    this.figure.update({ angles: s.angles, pinch: 0, breath: 0 })
    const pos = forwardKinematics(s.angles)
    this.cues.visible = p.showCues
    this.ring.visible = !!p.clip.targetJoint
    if (p.clip.targetJoint) {
      this.ring.position.copy(v(pos[p.clip.targetJoint]))
      this.ring.lookAt(this.cam.position)
    }
    for (const j of JOINTS) {
      const mk = p.markers.find((m) => m.joint === j)
      const d = this.dots[j]!
      d.visible = !!mk
      const halo = this.halos[j]
      if (mk) {
        d.position.copy(v(pos[j]))
        ;(d.material as THREE.MeshBasicMaterial).color.set(MARKER_STYLE[mk.status].color)
        let h = halo
        if (!h) {
          h = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.045, 24), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, side: THREE.DoubleSide }))
          this.cues.add(h)
          this.halos[j] = h
        }
        h.visible = true
        ;(h.material as THREE.MeshBasicMaterial).color.set(MARKER_STYLE[mk.status].color)
        h.position.copy(v(pos[j]))
        h.lookAt(this.cam.position)
      } else if (halo) {
        halo.visible = false
      }
    }
    // camera
    const focus = p.closeUp && p.clip.targetJoint ? v(pos[p.clip.targetJoint]) : new THREE.Vector3(0, 1.3, 0)
    const dist = p.closeUp ? 1.5 : 2.6
    const target = p.camera === 'side' ? new THREE.Vector3(dist, focus.y + 0.05, 0.15) : new THREE.Vector3(0.1, focus.y + 0.08, dist)
    if (this.frames === 0) this.cam.position.copy(target)
    else this.cam.position.lerp(target, 0.12)
    this.cam.lookAt(focus)
    this.renderer.render(this.scene, this.cam)
    this.frames += 1
    const now = performance.now()
    if (p.onProject && now - this.lastProject > 100) {
      this.lastProject = now
      const out: Projection = {}
      const w = this.el.clientWidth || 300
      const h = this.el.clientHeight || 300
      const tmp = new THREE.Vector3()
      for (const j of JOINTS) {
        tmp.copy(v(pos[j])).project(this.cam)
        out[j] = { x: ((tmp.x + 1) / 2) * w, y: ((1 - tmp.y) / 2) * h }
      }
      p.onProject(out)
    }
    this.raf = requestAnimationFrame(this.render)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.cues.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
    })
    this.figure.dispose()
    this.stage.dispose()
    this.renderer.dispose()
    if (this.renderer.domElement.parentNode === this.el) this.el.removeChild(this.renderer.domElement)
  }
}

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { Clip } from './clips'
import { MARKER_STYLE, type Marker } from './markers'
import { BONES, JOINTS, REST, forwardKinematics, type Joint, type Vec3 } from './rig'
import { sample } from './sampler'
import { makeBodyMaterial, makeRenderer, makeStage } from './stage'

export type Projection = Record<string, { x: number; y: number }>

type Props = {
  clip: Clip
  getTime: () => number
  speed: number
  camera: 'front' | 'side'
  closeUp: boolean
  showCues: boolean
  markers?: Marker[]
  onProject?: (p: Projection) => void
}

const MINT = 0x2fa985
const AMBER = 0xc97f14

function v(a: Vec3) {
  return new THREE.Vector3(a[0], a[1], a[2])
}

/** WebGL mannequin: primitives only, no assets. All animation comes from the sampler. */
export function AvatarScene({ clip, getTime, speed, camera, closeUp, showCues, markers = [], onProject }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const propsRef = useRef({ clip, getTime, speed, camera, closeUp, showCues, markers, onProject })
  useEffect(() => {
    propsRef.current = { clip, getTime, speed, camera, closeUp, showCues, markers, onProject }
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = makeRenderer()
    } catch {
      el.textContent = 'Avatar needs WebGL; your browser has it turned off.'
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.domElement.style.display = 'block'
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 20)

    // stage: environment light, gradient backdrop, contact shadow, light rig
    const stage = makeStage(scene, renderer, REST.hips.offset[1] - 0.14)

    const body = makeBodyMaterial()
    const dark = new THREE.MeshStandardMaterial({ color: 0x0b1d20, roughness: 0.8 })
    const segs: Record<string, THREE.Mesh> = {}
    for (const [a, b] of BONES) {
      const len = Math.hypot(...REST[b].offset)
      const r = a === 'hips' || a === 'spine' ? 0.17 : a === 'neck' && b === 'head' ? 0.05 : b.endsWith('Elbow') ? 0.06 : b.endsWith('Wrist') ? 0.05 : 0.07
      const geo = new THREE.CapsuleGeometry(r, Math.max(0.01, len - (b === 'head' ? 0.08 : 0)), 6, 14)
      const m = new THREE.Mesh(geo, body)
      m.castShadow = true
      scene.add(m)
      segs[`${a}-${b}`] = m
    }
    const joints: Partial<Record<Joint, THREE.Mesh>> = {}
    for (const j of JOINTS) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(REST[j].radius, 18, 14), j === 'hips' ? dark : body)
      m.castShadow = true
      scene.add(m)
      joints[j] = m
    }
    const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.16, 0.24, 20), dark)
    pelvis.castShadow = true
    scene.add(pelvis)

    // cue layer
    const cueGroup = new THREE.Group()
    scene.add(cueGroup)
    let tube: THREE.Mesh | null = null
    if (clip.pathJoint) {
      const pts: THREE.Vector3[] = []
      for (let i = 0; i <= 48; i++) pts.push(v(forwardKinematics(sample(clip, (i / 48) * clip.duration).angles)[clip.pathJoint]))
      tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, 0.012, 8, false), new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.85 }))
      cueGroup.add(tube)
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 8, 32), new THREE.MeshBasicMaterial({ color: AMBER }))
    cueGroup.add(ring)
    const dots: Record<string, THREE.Mesh> = {}
    for (const j of JOINTS) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: MINT }))
      d.visible = false
      cueGroup.add(d)
      dots[j] = d
    }
    const markerMeshes: Record<string, THREE.Mesh> = {}

    const resize = () => {
      const w = el.clientWidth || 300
      const h = el.clientHeight || 300
      renderer.setSize(w, h, true)
      cam.aspect = w / h
      cam.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    let raf = 0
    let lastProject = 0
    let frames = 0
    const dbg = (window as unknown as { __avatarDebug?: Record<string, unknown> })
    const tmp = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    const render = () => {
      const p = propsRef.current
      const s = sample(p.clip, p.getTime(), p.speed)
      const pos = forwardKinematics(s.angles)
      for (const [a, b] of BONES) {
        const m = segs[`${a}-${b}`]
        const pa = v(pos[a])
        const pb = v(pos[b])
        m.position.copy(pa).add(pb).multiplyScalar(0.5)
        const dir = pb.clone().sub(pa).normalize()
        m.quaternion.setFromUnitVectors(up, dir)
      }
      for (const j of JOINTS) joints[j]!.position.copy(v(pos[j]))
      pelvis.position.copy(v(pos.hips)).add(new THREE.Vector3(0, -0.02, 0))
      cueGroup.visible = p.showCues
      if (p.clip.targetJoint) {
        ring.position.copy(v(pos[p.clip.targetJoint]))
        ring.lookAt(cam.position)
      }
      for (const j of JOINTS) {
        const mk = p.markers.find((m) => m.joint === j)
        const d = dots[j]
        d.visible = !!mk
        if (mk) {
          d.position.copy(v(pos[j]))
          ;(d.material as THREE.MeshBasicMaterial).color.set(MARKER_STYLE[mk.status].color)
          if (!markerMeshes[j]) {
            const halo = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.045, 24), new THREE.MeshBasicMaterial({ color: MARKER_STYLE[mk.status].color, transparent: true, opacity: 0.6, side: THREE.DoubleSide }))
            cueGroup.add(halo)
            markerMeshes[j] = halo
          }
          markerMeshes[j].position.copy(v(pos[j]))
          markerMeshes[j].lookAt(cam.position)
        } else if (markerMeshes[j]) {
          markerMeshes[j].visible = false
        }
      }
      // camera
      const focus = p.closeUp && p.clip.targetJoint ? v(pos[p.clip.targetJoint]) : new THREE.Vector3(0, 1.28, 0)
      const dist = p.closeUp ? 1.5 : 2.7
      const target = p.camera === 'side' ? new THREE.Vector3(dist, focus.y + 0.05, 0.15) : new THREE.Vector3(0.1, focus.y + 0.08, dist)
      if (frames === 0) cam.position.copy(target)
      else cam.position.lerp(target, 0.12)
      cam.lookAt(focus)
      renderer.render(scene, cam)
      frames += 1
      dbg.__avatarDebug = { frames, cam: cam.position.toArray(), target: target.toArray(), size: [el.clientWidth, el.clientHeight], aspect: cam.aspect }
      const now = performance.now()
      if (p.onProject && now - lastProject > 100) {
        lastProject = now
        const out: Projection = {}
        const w = el.clientWidth || 300
        const h = el.clientHeight || 300
        for (const j of JOINTS) {
          tmp.copy(v(pos[j])).project(cam)
          out[j] = { x: ((tmp.x + 1) / 2) * w, y: ((1 - tmp.y) / 2) * h }
        }
        p.onProject(out)
      }
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      stage.dispose()
      body.dispose()
      dark.dispose()
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
    // the clip decides the tube geometry; everything else is read from propsRef each frame
  }, [clip])

  return <div ref={ref} className="absolute inset-0 h-full w-full" />
}

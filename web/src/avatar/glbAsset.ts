import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { GLB_ACTIONS, type AvatarMeta, type GlbAction, type GlbActionMeta, isPropNode, parseAvatarMeta, propVisible } from './glbActions'
import type { Side } from './layout'
import { isDarkTheme } from './stage'

/** Loading and instancing the Blender-built avatar. The GLB (mannequin rig + props + eight
 *  actions) and its sidecar are fetched once per page and cached; each panel gets its own
 *  `SkeletonUtils.clone` and `AnimationMixer`, so several panels can mount at once. Nothing here
 *  needs WebGL, so it is tested on the CPU with the shipped file. */

const BASE = import.meta.env.BASE_URL ?? '/'
export const AVATAR_GLB_URL = `${BASE}avatar/praxis_avatar.glb`
export const AVATAR_META_URL = `${BASE}avatar/praxis_avatar.meta.json`

export type AvatarAsset = { scene: THREE.Object3D; animations: THREE.AnimationClip[]; meta: AvatarMeta }

/** Parse GLB bytes + sidecar JSON; rejects unless every action exists in both. */
export async function parseAvatarGlb(glb: ArrayBuffer, metaJson: unknown): Promise<AvatarAsset> {
  const meta = parseAvatarMeta(metaJson)
  const gltf = await new GLTFLoader().parseAsync(glb, '')
  const names = new Set(gltf.animations.map((a) => a.name))
  for (const a of GLB_ACTIONS) {
    if (!names.has(a)) throw new Error(`avatar GLB: no animation ${a}`)
    if (!meta.actions[a]) throw new Error(`avatar meta: no action ${a}`)
  }
  for (const a of Object.keys(meta.actions)) if (!names.has(a)) throw new Error(`avatar meta names ${a}, which the GLB does not have`)
  return { scene: gltf.scene, animations: gltf.animations, meta }
}

async function fetchAsset(): Promise<AvatarAsset> {
  const [glb, meta] = await Promise.all([
    fetch(AVATAR_GLB_URL).then((r) => {
      if (!r.ok) throw new Error(`avatar GLB: HTTP ${r.status}`)
      return r.arrayBuffer()
    }),
    fetch(AVATAR_META_URL).then((r) => {
      if (!r.ok) throw new Error(`avatar meta: HTTP ${r.status}`)
      return r.json() as Promise<unknown>
    }),
  ])
  return parseAvatarGlb(glb, meta)
}

let pending: Promise<AvatarAsset> | null = null
let ready: AvatarAsset | null = null

/** One load per page; a failed load is forgotten so the next mount can retry. */
export function loadAvatarAsset(load: () => Promise<AvatarAsset> = fetchAsset): Promise<AvatarAsset> {
  if (!pending) {
    pending = load().then(
      (a) => (ready = a),
      (e: unknown) => {
        pending = null
        throw e
      },
    )
  }
  return pending
}

/** The asset if it has already loaded (lets a remount skip the loading state). */
export function peekAvatarAsset(): AvatarAsset | null {
  return ready
}

/** Cheap probe before fetching 1.5 MB: no WebGL constructor (old browser, jsdom) ⇒ procedural
 *  path straight away. A context that still fails to create is caught by the stage. */
export function webglAvailable(): boolean {
  return typeof globalThis !== 'undefined' && ('WebGL2RenderingContext' in globalThis || 'WebGLRenderingContext' in globalThis)
}

export function resetAvatarAssetForTests() {
  pending = null
  ready = null
}

type Look = { color: number; roughness?: number; clearcoat?: number; emissive?: number }
/** Design v2 look (6 Oct): a white figure and cool grey furniture, applied at runtime by material
 *  name so the committed Blender GLB is not rebaked. The dark theme has its own table. */
export const DS_LOOK: Record<string, Look> = {
  mannequin_shell: { color: 0xffffff, roughness: 0.55, clearcoat: 0.15 },
  mannequin_joint: { color: 0xf6f6f4, roughness: 0.4, clearcoat: 0.25 },
  furniture: { color: 0x6b7380, roughness: 0.7 },
  table_top: { color: 0x858d99, roughness: 0.75 },
  wood: { color: 0x6b7380, roughness: 0.8 },
  peg: { color: 0x3d62e3, roughness: 0.4 },
  paper: { color: 0xffffff, roughness: 0.9 },
}
export const DS_LOOK_DARK: Record<string, Look> = {
  mannequin_shell: { color: 0xdce6f8, roughness: 0.45, clearcoat: 0.3, emissive: 0x0a1a40 },
  mannequin_joint: { color: 0xb9ccf2, roughness: 0.35, clearcoat: 0.35, emissive: 0x10306e },
  furniture: { color: 0x2a3448, roughness: 0.7 },
  table_top: { color: 0x323d54, roughness: 0.75 },
  wood: { color: 0x2a3448, roughness: 0.8 },
  peg: { color: 0x3a84ff, roughness: 0.4, emissive: 0x0b2a80 },
  paper: { color: 0xd8e0ee, roughness: 0.9 },
}

/** Re-colour the GLB's (shared) materials for the current theme, once per theme change. */
function applyDsLook(material: THREE.Material | THREE.Material[]) {
  const theme = isDarkTheme() ? 'd' : 'l'
  for (const mat of Array.isArray(material) ? material : [material]) {
    if (!mat || mat.userData.dsLook === theme) continue
    mat.userData.dsLook = theme
    const look = (theme === 'd' ? DS_LOOK_DARK[mat.name] : null) ?? DS_LOOK[mat.name]
    if (!look) continue
    const m = mat as THREE.MeshPhysicalMaterial
    m.color?.set(look.color)
    if (look.roughness != null && 'roughness' in m) m.roughness = look.roughness
    if ('clearcoat' in m) m.clearcoat = look.clearcoat ?? 0.15
    if ('sheen' in m) {
      m.sheen = 0.3
      m.sheenColor?.set(0xffffff)
    }
    m.emissive?.set(look.emissive ?? 0x000000)
    m.needsUpdate = true
  }
}

/** One panel's copy of the avatar: a wrapper group (mirrored in x for the right side), the cloned
 *  rig and props, one mixer and at most one running action. */
export class AvatarInstance {
  readonly root = new THREE.Group()
  private model: THREE.Object3D
  private mixer: THREE.AnimationMixer
  private clips: Map<string, THREE.AnimationClip>
  private nodes = new Map<string, THREE.Object3D>()
  private props: THREE.Object3D[] = []
  private action: THREE.AnimationAction | null = null
  private actionName: GlbAction | null = null
  private meta: AvatarMeta

  constructor(asset: AvatarAsset) {
    this.meta = asset.meta
    this.model = cloneSkinned(asset.scene)
    this.root.name = 'praxis_avatar'
    this.root.add(this.model)
    this.model.traverse((o) => {
      if (o.name && !this.nodes.has(o.name)) this.nodes.set(o.name, o)
      if (o.parent === this.model && isPropNode(o.name)) this.props.push(o)
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
        // skinned bounds are the bind pose; an arm raised overhead must not be culled
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false
        applyDsLook(mesh.material)
      }
    })
    this.mixer = new THREE.AnimationMixer(this.model)
    this.clips = new Map(asset.animations.map((c) => [c.name, c]))
  }

  node(name: string): THREE.Object3D | undefined {
    return this.nodes.get(name)
  }

  propNames(): string[] {
    return this.props.map((p) => p.name)
  }

  runningActions(): string[] {
    return this.actionName && this.action?.isRunning() ? [this.actionName] : []
  }

  /** Right side = the left-arm recording mirrored in x (three flips the face winding itself). */
  setSide(side: Side) {
    this.root.scale.x = side === 'right' ? -1 : 1
  }

  /** Stop whatever runs, play `name`, show exactly its props. Returns its sidecar entry. */
  setAction(name: GlbAction): GlbActionMeta {
    const meta = this.meta.actions[name]
    if (this.actionName !== name) {
      this.mixer.stopAllAction()
      const clip = this.clips.get(name)
      this.action = clip ? this.mixer.clipAction(clip) : null
      if (this.action) {
        this.action.setLoop(meta.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
        this.action.clampWhenFinished = true
        this.action.play()
      }
      this.actionName = name
      for (const p of this.props) p.visible = propVisible(p.name, meta.props)
    }
    return meta
  }

  /** Pose the rig at action time t (the panel's clock owns time; the mixer only evaluates). */
  setTime(t: number) {
    if (this.action) {
      this.action.time = t
      this.mixer.update(0)
    }
    this.root.updateMatrixWorld(true)
  }

  worldPosition(name: string, out: THREE.Vector3): THREE.Vector3 {
    const n = this.nodes.get(name)
    return n ? n.getWorldPosition(out) : out.set(0, 0, 0)
  }

  /** Stop the mixer and free this copy's GPU resources (geometry and materials are shared with
   *  the cached asset; three re-uploads them if another panel still draws them). */
  dispose() {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.model)
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.geometry?.dispose()
        const mat = mesh.material as THREE.Material | THREE.Material[]
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat?.dispose()
      }
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.dispose()
    })
    this.root.removeFromParent()
  }
}

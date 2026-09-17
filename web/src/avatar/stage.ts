import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/** Stage colours from the wireframe contract (§3): dark stage `#050E10 → #0F262B` in both themes. */
export const STAGE_EDGE = '#050E10'
export const STAGE_CENTRE = '#0F262B'
export const MINT = 0x2fa985
export const AMBER = 0xc97f14
export const RED = 0xb9382b
export const AQUA = 0x74c5ad

/** Renderer with filmic tone mapping and soft shadow maps. Throws when WebGL is unavailable. */
export function makeRenderer(canvas?: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.92
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap // PCFSoftShadowMap was removed in three r186; PCF + shadow.radius gives the soft edge
  return renderer
}

/** Radial gradient (`#0F262B` centre → `#050E10` edge) as a background texture; the centre sits
 *  a little above the middle so the figure is haloed at chest height. */
export function makeGradientTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(size * 0.5, size * 0.42, size * 0.02, size * 0.5, size * 0.42, size * 0.72)
    g.addColorStop(0, STAGE_CENTRE)
    g.addColorStop(1, STAGE_EDGE)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/** Seamless ceramic: satin base, light clearcoat, a touch of sheen, and a mint fresnel rim
 *  injected into the shader so edges glow softly against the dark stage. */
export function makeBodyMaterial(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: AQUA,
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.5,
    sheen: 0.4,
    sheenColor: new THREE.Color(0xbff5e6),
    envMapIntensity: 0.45,
  })
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        float fres = pow(1.0 - max(dot(normalize(normal), normalize(vViewPosition)), 0.0), 3.0);
        totalEmissiveRadiance += vec3(0.18, 0.66, 0.52) * 0.35 * fres;
      }`,
    )
  }
  return m
}

export type Stage = {
  group: THREE.Group
  disc: THREE.Mesh
  /** Everything created here, for disposal on unmount. */
  dispose: () => void
}

/** Environment light, gradient backdrop, contact-shadow disc with a faint mint rim, and the
 *  three-light rig (hemisphere + key with shadows + fill + rim). `floorY` is the disc height. */
export function makeStage(scene: THREE.Scene, renderer: THREE.WebGLRenderer, floorY: number): Stage {
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envScene = new RoomEnvironment()
  const env = pmrem.fromScene(envScene, 0.04)
  scene.environment = env.texture
  pmrem.dispose()

  const bg = makeGradientTexture()
  scene.background = bg

  const group = new THREE.Group()

  // A barely-there plinth so the disc reads as a surface even where no shadow falls.
  const plinth = new THREE.Mesh(
    new THREE.CircleGeometry(0.95, 64),
    new THREE.MeshStandardMaterial({ color: 0x0b1d21, roughness: 0.95, metalness: 0, transparent: true, opacity: 0.55 }),
  )
  plinth.rotation.x = -Math.PI / 2
  plinth.position.y = floorY - 0.002
  group.add(plinth)

  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.95, 64), new THREE.ShadowMaterial({ opacity: 0.45 }))
  disc.rotation.x = -Math.PI / 2
  disc.position.y = floorY
  disc.receiveShadow = true
  group.add(disc)

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.93, 0.97, 64),
    new THREE.MeshBasicMaterial({ color: MINT, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = floorY + 0.001
  group.add(ring)

  const hemi = new THREE.HemisphereLight(0x9fe2cf, 0x050e10, 0.45)
  group.add(hemi)
  const key = new THREE.DirectionalLight(0xfff4e6, 1.15)
  key.position.set(1.5, 3.5, 2.5)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.radius = 6
  key.shadow.bias = -0.0005
  key.shadow.normalBias = 0.01
  key.shadow.camera.left = -1.5
  key.shadow.camera.right = 1.5
  key.shadow.camera.top = 1.5
  key.shadow.camera.bottom = -1.5
  key.shadow.camera.near = 0.5
  key.shadow.camera.far = 8
  key.target.position.set(0, 1.2, 0)
  group.add(key)
  group.add(key.target)
  const fill = new THREE.DirectionalLight(0x7fb4ff, 0.35)
  fill.position.set(-2, 1.5, 2)
  group.add(fill)
  const rim = new THREE.DirectionalLight(0x2fa985, 1.2)
  rim.position.set(-1.5, 2.5, -2)
  group.add(rim)

  scene.add(group)
  const dispose = () => {
    env.dispose()
    bg.dispose()
    for (const m of [plinth, disc, ring]) {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    }
    key.shadow.dispose()
    scene.remove(group)
  }
  return { group, disc, dispose }
}

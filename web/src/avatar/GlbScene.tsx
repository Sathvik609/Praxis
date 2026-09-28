import { type RefObject, useEffect, useRef } from 'react'
import type { Insets } from './framing'
import type { GlbAction } from './glbActions'
import type { AvatarAsset } from './glbAsset'
import { GlbStage } from './glbStage'
import type { Side } from './layout'
import type { Marker } from './markers'
import type { Clock, Projection, Tick } from './scene'
import type { Script } from './script'

type Props = {
  asset: AvatarAsset
  action: GlbAction
  side: Side
  /** Mutable playback state shared with the stage's single loop (time = action seconds). */
  clock: RefObject<Clock>
  camera: 'front' | 'side'
  closeUp: boolean
  compact: boolean
  showCues: boolean
  markers?: Marker[]
  /** Demonstration script (step text + time warp), if the action has one. */
  script?: Script | null
  /** Stage pixels kept clear of the figure (labels, captions). */
  insets?: Insets
  /** Home zoom (1 = the whole figure). */
  zoom?: number
  onTick?: (t: Tick) => void
  onProject?: (p: Projection) => void
  /** WebGL unavailable or lost: the panel falls back to the procedural figure. */
  onContextLost?: () => void
}

/** The Blender-built avatar (GLB) on the dark stage. React mounts one `GlbStage` and pushes the
 *  latest props into it; the stage owns the loop and disposes everything on unmount. */
export function GlbScene({ asset, action, side, clock, camera, closeUp, compact, showCues, markers = [], script = null, insets, zoom = 1, onTick, onProject, onContextLost }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const stageRef = useRef<GlbStage | null>(null)
  const props = { asset, action, side, clock, camera, closeUp, compact, showCues, markers, script, insets, zoom, onTick, onProject, onContextLost }
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
    if (stageRef.current) stageRef.current.input = props
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let stage: GlbStage
    try {
      stage = new GlbStage(el, latest.current)
    } catch {
      latest.current.onContextLost?.()
      return
    }
    stageRef.current = stage
    return () => {
      stageRef.current = null
      stage.dispose()
    }
  }, [])

  return <div ref={ref} data-testid="glb-stage" className="absolute inset-0 h-full w-full" />
}

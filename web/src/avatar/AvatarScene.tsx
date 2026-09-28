import { type RefObject, useEffect, useRef } from 'react'
import type { Clip } from './clips'
import type { Insets } from './framing'
import type { Marker } from './markers'
import { AvatarStage, type Clock, type FigureMode, type Projection, type Tick } from './scene'

export type { Clock, FigureMode, Projection, Tick } from './scene'

type Props = {
  clip: Clip
  /** Mutable playback state shared with the stage's single loop. */
  clock: RefObject<Clock>
  camera: 'front' | 'side'
  closeUp: boolean
  compact: boolean
  showCues: boolean
  markers?: Marker[]
  /** Ceramic mannequin (default) or the glowing skeleton with angle arcs. */
  figure?: FigureMode
  /** Stage pixels kept clear of the figure (labels, captions). */
  insets?: Insets
  /** 10 Hz: caption / step / ended for React state. */
  onTick?: (t: Tick) => void
  /** Every frame: screen positions of the joints and the torso centre, for the label layer. */
  onProject?: (p: Projection) => void
  onContextLost?: () => void
}

/** WebGL mannequin: primitives only, no assets. All animation comes from the sampler. React
 *  mounts one `AvatarStage` and pushes the latest props into it; the stage owns the loop. */
export function AvatarScene({ clip, clock, camera, closeUp, compact, showCues, markers = [], figure = 'body', insets, onTick, onProject, onContextLost }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const stageRef = useRef<AvatarStage | null>(null)
  const props = { clip, clock, camera, closeUp, compact, showCues, markers, figure, insets, onTick, onProject, onContextLost }
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
    if (stageRef.current) stageRef.current.input = props
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let stage: AvatarStage
    try {
      stage = new AvatarStage(el, latest.current)
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

  return <div ref={ref} className="absolute inset-0 h-full w-full" />
}

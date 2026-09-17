import { useEffect, useRef } from 'react'
import type { Clip } from './clips'
import type { Marker } from './markers'
import { AvatarStage, type Projection } from './scene'

export type { Projection } from './scene'

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

/** WebGL mannequin: primitives only, no assets. All animation comes from the sampler. React
 *  mounts one `AvatarStage` and pushes the latest props into it; the stage owns the loop. */
export function AvatarScene({ clip, getTime, speed, camera, closeUp, showCues, markers = [], onProject }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const stageRef = useRef<AvatarStage | null>(null)
  const props = { clip, getTime, speed, camera, closeUp, showCues, markers, onProject }
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
      el.textContent = 'Avatar needs WebGL; your browser has it turned off.'
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

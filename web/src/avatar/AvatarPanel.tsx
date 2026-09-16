import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../design/Button'
import { AvatarScene, type Projection } from './AvatarScene'
import { CLIPS, type Clip } from './clips'
import { MARKER_STYLE, type Marker } from './markers'
import { sample } from './sampler'

type Props = {
  clip: keyof typeof CLIPS
  autoplay?: boolean
  camera?: 'front' | 'side'
  markers?: Marker[]
  onMarkerTap?: (m: Marker) => void
  compact?: boolean
  showCues?: boolean
  onStep?: (step: number) => void
  className?: string
}

const SPEEDS = [1, 0.5, 0.25]

/** The one avatar: a pacing reference on a dark stage. It never scores the patient. */
export function AvatarPanel({ clip: clipName, autoplay = true, camera, markers = [], onMarkerTap, compact = false, showCues = true, onStep, className = '' }: Props) {
  const clip: Clip = CLIPS[clipName]
  const [playing, setPlaying] = useState(autoplay)
  const [speedIdx, setSpeedIdx] = useState(0)
  const [closeUp, setCloseUp] = useState(false)
  const [captions, setCaptions] = useState(true)
  const [proj, setProj] = useState<Projection | null>(null)
  const timeRef = useRef(0)
  const [caption, setCaption] = useState(() => sample(clip, 0).caption)
  const [step, setStep] = useState(1)
  const [clipKey, setClipKey] = useState(clipName)
  const speed = SPEEDS[speedIdx]

  if (clipKey !== clipName) {
    // clip changed: reset during render (React's recommended pattern instead of an effect)
    setClipKey(clipName)
    setCaption(sample(clip, 0).caption)
    setStep(1)
  }
  useEffect(() => {
    timeRef.current = 0
  }, [clipName])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    let lastUi = 0
    const tick = (now: number) => {
      timeRef.current += (now - last) / 1000
      last = now
      if (!clip.loop && timeRef.current * speed >= clip.duration) {
        timeRef.current = clip.duration / speed
        setPlaying(false)
      }
      if (now - lastUi > 120) {
        lastUi = now
        const s = sample(clip, timeRef.current, speed)
        setCaption(s.caption)
        setStep((prev) => {
          if (prev !== s.step) onStep?.(s.step)
          return s.step
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, clip, speed, onStep])

  const getTime = useCallback(() => timeRef.current, [])
  const replay = () => {
    timeRef.current = 0
    setCaption(sample(clip, 0).caption)
    setStep(1)
    setPlaying(true)
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-[var(--stage-a)]">
        <AvatarScene clip={clip} getTime={getTime} speed={speed} camera={camera ?? clip.camera} closeUp={closeUp} showCues={showCues} markers={markers} onProject={markers.length ? setProj : undefined} />
        {markers.map((m, i) => {
          const p = proj?.[m.joint]
          const style = p ? { left: p.x, top: p.y } : { right: 12, top: 12 + i * 44 }
          return (
            <button
              key={m.joint}
              type="button"
              onClick={() => onMarkerTap?.(m)}
              style={style}
              className={`absolute flex min-h-9 -translate-y-1/2 items-center gap-2 rounded-full px-3 text-sm font-bold ${MARKER_STYLE[m.status].chip} ${p ? 'translate-x-3' : ''}`}
            >
              <span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ background: MARKER_STYLE[m.status].color }} />
              {m.label} · {MARKER_STYLE[m.status].word}
            </button>
          )
        })}
        {captions && (
          <div className="absolute inset-x-0 bottom-0 bg-black/45 px-4 py-2 text-white">
            {caption || `Step ${step} of ${clip.steps}`}
          </div>
        )}
        <div className="absolute left-3 top-2 text-xs text-white/60">{clip.camera === 'side' ? 'side view' : 'front view'} · {speed}× · same figure as Home</div>
      </div>
      {!compact && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="min-h-12 px-4 text-base" onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play'}</Button>
          <Button variant="secondary" className="min-h-12 px-4 text-base" onClick={replay}>Replay</Button>
          <Button variant="secondary" className="min-h-12 px-4 text-base" onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}>Slower</Button>
          <Button variant="secondary" className="min-h-12 px-4 text-base" aria-pressed={closeUp} onClick={() => setCloseUp((c) => !c)}>Close-up</Button>
          <Button variant="secondary" className="min-h-12 px-4 text-base" aria-pressed={captions} onClick={() => setCaptions((c) => !c)}>Captions</Button>
        </div>
      )}
      <p className="text-center text-sm text-muted">Reference only. Your reps are verified from the camera, not from matching the figure.</p>
    </div>
  )
}

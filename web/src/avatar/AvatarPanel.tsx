import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../design/Button'
import { AvatarScene, type Clock, type Projection, type Tick } from './AvatarScene'
import { CLIPS, type Clip, mirror } from './clips'
import { MARKER_STYLE, type Marker } from './markers'
import { sample } from './sampler'

type Props = {
  clip: keyof typeof CLIPS
  autoplay?: boolean
  camera?: 'front' | 'side'
  /** Practising side; the clip is mirrored for the right side and the side camera moves with it. */
  side?: 'left' | 'right'
  markers?: Marker[]
  onMarkerTap?: (m: Marker) => void
  compact?: boolean
  showCues?: boolean
  onStep?: (step: number) => void
  /** Stage box shape: 16/10 for Demonstration, 4/5 (height-capped) for Home and live panels. */
  aspect?: '3/4' | '16/10' | '4/5'
  className?: string
}

const SPEEDS = [1, 0.5, 0.25]
const ASPECT: Record<NonNullable<Props['aspect']>, string> = {
  '16/10': 'aspect-[16/10]',
  '4/5': 'aspect-[4/5] max-h-[400px]',
  '3/4': 'aspect-[3/4]',
}
const LABEL_OFFSET = 70
const LABEL_GAP = 44

/** The one avatar: a pacing reference on a dark stage. It never scores the patient. */
export function AvatarPanel({ clip: clipName, autoplay = true, camera, side = 'left', markers = [], onMarkerTap, compact = false, showCues = true, onStep, aspect, className = '' }: Props) {
  const clip: Clip = useMemo(() => (side === 'right' ? mirror(CLIPS[clipName]) : CLIPS[clipName]), [clipName, side])
  // one mutable clock, read only inside effects, handlers and the stage's loop, which advances `time`
  const clock = useRef<Clock>({ time: 0, playing: autoplay, speed: 1 })
  const [playing, setPlaying] = useState(autoplay)
  const [speedIdx, setSpeedIdx] = useState(0)
  const [closeUp, setCloseUp] = useState(false)
  const [captions, setCaptions] = useState(true)
  const [lost, setLost] = useState(false)
  const [caption, setCaption] = useState(() => sample(clip, 0).caption)
  const [step, setStep] = useState(1)
  const [clipKey, setClipKey] = useState(clip)
  const speed = SPEEDS[speedIdx]
  useEffect(() => {
    clock.current.speed = speed
    clock.current.playing = playing
  }, [speed, playing])

  if (clipKey !== clip) {
    // clip changed: reset during render (React's recommended pattern instead of an effect)
    setClipKey(clip)
    setCaption(sample(clip, 0).caption)
    setStep(1)
  }
  useEffect(() => {
    clock.current.time = 0
  }, [clip])

  const stepRef = useRef(1)
  const onTick = useCallback(
    (t: Tick) => {
      setCaption(t.caption)
      if (t.step !== stepRef.current) {
        stepRef.current = t.step
        setStep(t.step)
        onStep?.(t.step)
      }
      if (t.ended) setPlaying(false)
    },
    [onStep],
  )

  // Label layer: DOM nodes moved directly from the render loop (no React state per frame).
  const boxRef = useRef<HTMLDivElement>(null)
  const labelRefs = useRef(new Map<string, HTMLButtonElement>())
  const leaderRefs = useRef(new Map<string, SVGLineElement>())
  const onProject = useCallback(
    (proj: Projection) => {
      const box = boxRef.current
      if (!box) return
      const w = box.clientWidth
      const h = box.clientHeight
      const centre = proj.centre ?? { x: w / 2, y: h / 2 }
      const placed: { joint: string; x: number; y: number; left: boolean; px: number; py: number }[] = []
      for (const m of markers) {
        const p = proj[m.joint]
        if (!p) continue
        let dx = p.x - centre.x
        let dy = p.y - centre.y
        const len = Math.hypot(dx, dy) || 1
        dx /= len
        dy /= len
        if (Math.abs(dx) < 0.35) dx = dx < 0 ? -0.35 : 0.35
        const left = dx < 0
        const x = Math.min(w - 8, Math.max(8, p.x + dx * LABEL_OFFSET))
        const y = Math.min(h - 32, Math.max(32, p.y + dy * LABEL_OFFSET))
        placed.push({ joint: m.joint, x, y, left, px: p.x, py: p.y })
      }
      placed.sort((a, b) => a.y - b.y)
      for (let i = 1; i < placed.length; i++) {
        const a = placed[i - 1]
        const b = placed[i]
        if (a.left === b.left && b.y - a.y < LABEL_GAP) b.y = a.y + LABEL_GAP
      }
      for (const l of placed) {
        const el = labelRefs.current.get(l.joint)
        if (el) el.style.transform = `translate(${l.x}px, ${l.y}px) translate(${l.left ? '-100%' : '0'}, -50%)`
        const line = leaderRefs.current.get(l.joint)
        if (line) {
          line.setAttribute('x1', String(l.px))
          line.setAttribute('y1', String(l.py))
          line.setAttribute('x2', String(l.x))
          line.setAttribute('y2', String(l.y))
        }
      }
    },
    [markers],
  )

  const replay = () => {
    clock.current.time = 0
    setCaption(sample(clip, 0).caption)
    setStep(1)
    stepRef.current = 1
    setPlaying(true)
  }

  const view = camera ?? clip.camera
  const box = ASPECT[aspect ?? (compact ? '4/5' : '16/10')]

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div ref={boxRef} data-stage className={`relative w-full shrink-0 overflow-hidden rounded-2xl bg-[var(--stage-a)] ${box}`}>
        {lost ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_50%_40%,#0F262B,#050E10)] p-6 text-center text-lg text-white/80">
            Reference only. The 3D figure could not be drawn on this device; follow the written steps.
          </div>
        ) : (
          <AvatarScene
            clip={clip}
            clock={clock}
            camera={view}
            closeUp={closeUp}
            compact={compact}
            showCues={showCues}
            markers={markers}
            onTick={onTick}
            onProject={markers.length ? onProject : undefined}
            onContextLost={() => setLost(true)}
          />
        )}
        {markers.length > 0 && (
          <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full">
            {markers.map((m) => (
              <line
                key={m.joint}
                ref={(el) => {
                  if (el) leaderRefs.current.set(m.joint, el)
                  else leaderRefs.current.delete(m.joint)
                }}
                stroke={MARKER_STYLE[m.status].color}
                strokeWidth={1}
                opacity={0.8}
              />
            ))}
          </svg>
        )}
        {markers.map((m, i) => (
          <button
            key={m.joint}
            type="button"
            ref={(el) => {
              if (el) labelRefs.current.set(m.joint, el)
              else labelRefs.current.delete(m.joint)
            }}
            onClick={() => onMarkerTap?.(m)}
            style={{ transform: `translate(12px, ${16 + i * LABEL_GAP}px)` }}
            className={`absolute left-0 top-0 flex min-h-14 items-center gap-2 whitespace-nowrap rounded-full px-4 text-base font-bold shadow-md ${MARKER_STYLE[m.status].chip}`}
          >
            <span aria-hidden className="inline-block h-3.5 w-3.5 rounded-full" style={{ background: MARKER_STYLE[m.status].color }} />
            {m.label} · {MARKER_STYLE[m.status].word}
          </button>
        ))}
        {captions && (
          <div className="absolute inset-x-0 bottom-0 bg-black/50 px-4 py-2 text-lg text-white">
            {caption || `Step ${step} of ${clip.steps}`}
          </div>
        )}
        <div className="absolute left-3 top-2 text-base text-white/70">
          {view === 'side' ? 'side view' : 'front view'} · {speed}× · same figure as Home
        </div>
      </div>
      {!compact && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="px-4 text-lg" onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play'}</Button>
          <Button variant="secondary" className="px-4 text-lg" onClick={replay}>Replay</Button>
          <Button variant="secondary" className="px-4 text-lg" onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}>Slower</Button>
          <Button variant="secondary" className="px-4 text-lg" aria-pressed={closeUp} onClick={() => setCloseUp((c) => !c)}>Close-up</Button>
          <Button variant="secondary" className="px-4 text-lg" aria-pressed={captions} onClick={() => setCaptions((c) => !c)}>Captions</Button>
        </div>
      )}
      <p className="text-center text-base text-muted">Reference only. Your reps are verified from the camera, not from matching the figure.</p>
    </div>
  )
}

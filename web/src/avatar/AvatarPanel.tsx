import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../design/Button'
import { AvatarScene, type Clock, type FigureMode, type Projection, type Tick } from './AvatarScene'
import { CLIPS, type Clip, mirror } from './clips'
import { GlbScene } from './GlbScene'
import { actionFor, focusJointOf, pacedActionTime, sourceLabel, stepAt } from './glbActions'
import { type AvatarAsset, loadAvatarAsset, peekAvatarAsset, webglAvailable } from './glbAsset'
import { MARKER_STYLE, type Marker } from './markers'
import { LOOP_BRIDGE_S, REHAB_CLIPS, type RehabClipName, isRehabClip } from './rehabClips'
import { sample } from './sampler'

export type ClipName = keyof typeof CLIPS | RehabClipName

type Props = {
  clip: ClipName
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
  /** Ceramic mannequin or glowing skeleton with angle arcs; defaults to skeleton for the
   *  real-motion rehab clips and body for the three exercise clips and idle. */
  figure?: FigureMode
  /** Rep progress 0..1 from the camera (lift 0–0.4, hold 0.4–0.8, lower 0.8–1). When given, the
   *  figure is paced by the patient instead of looping on its own; null = free-running. The
   *  camera still does the scoring; this only decides where the reference figure is. */
  paced?: number | null
  className?: string
}

const SIDE_WORD = { left: 'Left', right: 'Right' }
const JOINT_WORD: Partial<Record<string, string>> = { lShoulder: 'shoulder', rShoulder: 'shoulder', lElbow: 'elbow', rElbow: 'elbow', lWrist: 'hand', rWrist: 'hand' }

function clipByName(name: ClipName): Clip {
  return isRehabClip(name) ? REHAB_CLIPS[name] : CLIPS[name]
}

const SPEEDS = [1, 0.5, 0.25]
const ASPECT: Record<NonNullable<Props['aspect']>, string> = {
  '16/10': 'aspect-[16/10]',
  '4/5': 'aspect-[4/5] max-h-[525px]',
  '3/4': 'aspect-[3/4]',
}
const LABEL_OFFSET = 70
const LABEL_GAP = 44
const CAPTION_H = 48 // caption bar height reserved at the bottom of the stage

/** The Blender GLB when it loads; null while loading or once it has failed (no WebGL, network,
 *  parse, lost context), in which case the procedural figure is drawn unchanged. */
function useGlbAsset(): { asset: AvatarAsset | null; loading: boolean; fail: () => void } {
  const [failed, setFailed] = useState(() => !webglAvailable())
  const [asset, setAsset] = useState<AvatarAsset | null>(() => peekAvatarAsset())
  useEffect(() => {
    if (failed || asset) return
    let live = true
    loadAvatarAsset().then(
      (a) => live && setAsset(a),
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
  }, [failed, asset])
  const fail = useCallback(() => setFailed(true), [])
  return { asset: failed ? null : asset, loading: !failed && !asset, fail }
}

/** The one avatar: a pacing reference on a dark stage. It never scores the patient. It plays the
 *  Blender-built GLB (one action per exercise, see `glbActions.ts`) and falls back to the
 *  procedural figure when the GLB or WebGL is unavailable. */
export function AvatarPanel({ clip: clipName, paced = null, autoplay = true, camera, side = 'left', markers: markersIn, onMarkerTap, compact = false, showCues = true, onStep, aspect, figure, className = '' }: Props) {
  const clip: Clip = useMemo(() => (side === 'right' ? mirror(clipByName(clipName)) : clipByName(clipName)), [clipName, side])
  const { asset: glb, loading: glbLoading, fail: glbFail } = useGlbAsset()
  const action = actionFor(clipName)
  const am = glb?.meta.actions[action] ?? null
  // the GLB brings its own materials and has no skeleton arcs, so it counts as the body figure
  const mode: FigureMode = am ? 'body' : (figure ?? (isRehabClip(clipName) ? 'skeleton' : 'body'))
  const focusJoint = am ? focusJointOf(am.focus_bone, side) : clip.focusJoint
  // a rehab clip always labels its focus joint (colour never carries the meaning alone)
  const markers = useMemo<Marker[]>(() => {
    if (markersIn?.length) return markersIn
    if (!focusJoint) return []
    return [{ joint: focusJoint, status: 'focus', label: `${SIDE_WORD[side]} ${JOINT_WORD[focusJoint] ?? focusJoint}` }]
  }, [markersIn, focusJoint, side])
  const firstCaption = am ? stepAt(am.steps, 0).caption : sample(clip, 0).caption
  const stepsTotal = am ? Math.max(1, am.steps.length) : clip.steps
  // what is playing (GLB action or procedural clip): a change resets the clock, caption and step
  const current: object = am ?? clip
  const [angle, setAngle] = useState<number | null>(null)
  // one mutable clock, read only inside effects, handlers and the stage's loop, which advances `time`
  const clock = useRef<Clock>({ time: 0, playing: autoplay, speed: 1 })
  const [playing, setPlaying] = useState(autoplay)
  const [speedIdx, setSpeedIdx] = useState(0)
  const [closeUp, setCloseUp] = useState(false)
  const [captions, setCaptions] = useState(true)
  const [lost, setLost] = useState(false)
  const [caption, setCaption] = useState(firstCaption)
  const [step, setStep] = useState(1)
  const [clipKey, setClipKey] = useState(current)
  const speed = SPEEDS[speedIdx]
  useEffect(() => {
    clock.current.speed = speed
    clock.current.playing = playing
  }, [speed, playing])

  if (clipKey !== current) {
    // clip (or figure) changed: reset during render (React's recommended pattern instead of an effect)
    setClipKey(current)
    setCaption(firstCaption)
    setStep(1)
  }
  useEffect(() => {
    clock.current.time = 0
  }, [current])
  useEffect(() => {
    if (am) {
      // GLB: rep progress p puts the figure at rep[0] + p·(rep[1] − rep[0]) of the action
      clock.current.target = paced == null ? null : pacedActionTime(am, paced)
      return
    }
    // Map rep progress onto the clip timeline (before the loop bridge at the end).
    const span = Math.max(0.1, clip.duration - (clip.loop ? LOOP_BRIDGE_S : 0))
    clock.current.target = paced == null ? null : Math.max(0, Math.min(1, paced)) * span
  }, [paced, clip, am])

  const stepRef = useRef(1)
  const onTick = useCallback(
    (t: Tick) => {
      setCaption(t.caption)
      setAngle(t.angleDeg === null ? null : Math.round(t.angleDeg))
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
        // Keep the whole chip inside the stage (it is anchored at its inner edge) and above
        // the caption bar, so labels are never cut off at the panel edge.
        const chipW = labelRefs.current.get(m.joint)?.offsetWidth ?? 120
        const minX = left ? 8 + chipW : 8
        const maxX = left ? w - 8 : w - 8 - chipW
        const x = Math.min(maxX, Math.max(minX, p.x + dx * LABEL_OFFSET))
        const y = Math.min(h - CAPTION_H - 28, Math.max(32, p.y + dy * LABEL_OFFSET))
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
    setCaption(firstCaption)
    setStep(1)
    stepRef.current = 1
    setPlaying(true)
  }

  const view = camera ?? am?.camera ?? clip.camera
  const box = ASPECT[aspect ?? (compact ? '4/5' : '16/10')]

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div ref={boxRef} data-stage className={`relative w-full shrink-0 overflow-hidden rounded-2xl bg-[var(--stage-a)] ${box}`}>
        {lost ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_50%_40%,#0F262B,#050E10)] p-6 text-center text-lg text-white/80">
            Reference only. The 3D figure could not be drawn on this device; follow the written steps.
          </div>
        ) : glb ? (
          <GlbScene
            asset={glb}
            action={action}
            side={side}
            clock={clock}
            camera={view}
            closeUp={closeUp}
            compact={compact}
            showCues={showCues}
            markers={markers}
            onTick={onTick}
            onProject={markers.length ? onProject : undefined}
            onContextLost={glbFail}
          />
        ) : glbLoading ? (
          <div role="status" className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_50%_40%,#0F262B,#050E10)] text-lg text-white/80">
            Loading the figure…
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
            figure={mode}
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
            {caption || `Step ${step} of ${stepsTotal}`}
          </div>
        )}
        <div className={`absolute left-3 top-2 text-base leading-snug text-white/70 ${compact ? 'right-[11.5rem]' : 'right-3'}`}>
          {view === 'side' ? 'side view' : 'front view'} · {speed}× · {am ? sourceLabel(am.source, am) : mode === 'skeleton' ? 'skeleton view' : 'same figure as Home'}
        </div>
        {mode === 'skeleton' && clip.arc && showCues && (
          <div data-testid="arc-readout" className={`absolute right-3 ${captions ? 'bottom-16' : 'bottom-3'} max-w-[70%] truncate rounded-full bg-black/45 px-3 py-1 text-base text-white`}>
            <span className="text-[#F2B457]">target {Math.round(clip.arc.targetDeg)}°</span>
            {angle !== null && <span className="text-[#7FE0C4]"> · figure {angle}°</span>}
            {clip.source && <span className="text-white/70"> · {clip.source}</span>}
          </div>
        )}
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

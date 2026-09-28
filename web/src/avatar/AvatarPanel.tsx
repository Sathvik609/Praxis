import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../design/Button'
import { AvatarScene, type Clock, type FigureMode, type Projection, type Tick } from './AvatarScene'
import { CLIPS, type Clip, mirror } from './clips'
import type { Insets } from './framing'
import { GlbScene } from './GlbScene'
import { actionFor, focusJointOf, pacedActionTime, sourceLabel, stepAt } from './glbActions'
import { type AvatarAsset, loadAvatarAsset, peekAvatarAsset, webglAvailable } from './glbAsset'
import { CHIP_H, EDGE, GAP, VIEW_H, type Gutter, bandRows, chooseGutter, gutterSide, placeLabels, stageInsets } from './labels'
import { MARKER_STYLE, type Marker } from './markers'
import { LOOP_BRIDGE_S, REHAB_CLIPS, type RehabClipName, isRehabClip } from './rehabClips'
import { sample } from './sampler'
import { buildScript, scriptCaption } from './script'

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
  /** Prescribed hold (s) for a lift-and-hold exercise: the demonstration holds this long at the
   *  top and its step text says so (default 3 s). */
  holdS?: number
  /** Camera zoom (Home body map): 1 = the whole figure; > 1 zooms in from the head down. */
  zoom?: number
  /** Height (px) of the host's own buttons over the top-right of the stage (Home zoom), which the
   *  figure and labels keep clear of. */
  overlayTop?: number
  className?: string
}

const SIDE_WORD = { left: 'Left', right: 'Right' }
const JOINT_WORD: Partial<Record<string, string>> = { lShoulder: 'shoulder', rShoulder: 'shoulder', lElbow: 'elbow', rElbow: 'elbow', lWrist: 'hand', rWrist: 'hand' }
const VIEW_WORD = { front: 'Front view', side: 'Side view' }

function clipByName(name: ClipName): Clip {
  return isRehabClip(name) ? REHAB_CLIPS[name] : CLIPS[name]
}

const SPEEDS = [1, 0.5, 0.25]
const ASPECT: Record<NonNullable<Props['aspect']>, string> = {
  '16/10': 'aspect-[16/10]',
  '4/5': 'aspect-[4/5] max-h-[525px]',
  '3/4': 'aspect-[3/4]',
}
/** Caption bar height reserved at the bottom of the stage: one line in a compact panel (the
 *  caption is truncated there), up to two lines otherwise. */
const CAPTION_H = { compact: 48, full: 72 }
const ZOOM_BUTTONS_W = 184 // Home's three 56 px zoom / rotate buttons at the top-right

const chipText = (m: Marker) => `${m.label} · ${MARKER_STYLE[m.status].word}`
/** Pill width before it can be measured (first render, jsdom): 16 px text, padding and dot. */
const estimateChipW = (m: Marker) => Math.round(60 + 8.5 * chipText(m).length)

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
 *  Blender-built GLB (one action per exercise, see `glbActions.ts`; the demonstration script and
 *  time warp for the three locked exercises in `script.ts`) and falls back to the procedural
 *  figure when the GLB or WebGL is unavailable.
 *
 *  Layout: the joint labels stack in a gutter on the side away from the practising arm (a band
 *  on top of a narrow stage, `labels.ts`) and the figure is framed in the rest of the stage, so a
 *  label never covers the arm, hand or head it describes. The top line tells the patient only the
 *  view and the speed; where the motion comes from (recording, scaling, procedural) is kept on the
 *  element's `title` and `data-provenance` for reviewers. */
export function AvatarPanel({ clip: clipName, paced = null, autoplay = true, camera, side = 'left', markers: markersIn, onMarkerTap, compact = false, showCues = true, onStep, aspect, figure, holdS, zoom = 1, overlayTop = 0, className = '' }: Props) {
  const clip: Clip = useMemo(() => (side === 'right' ? mirror(clipByName(clipName)) : clipByName(clipName)), [clipName, side])
  const { asset: glb, loading: glbLoading, fail: glbFail } = useGlbAsset()
  const action = actionFor(clipName)
  const am = glb?.meta.actions[action] ?? null
  const script = useMemo(() => (am ? buildScript(action, am, { holdS }) : null), [action, am, holdS])
  // the GLB brings its own materials and has no skeleton arcs, so it counts as the body figure
  const mode: FigureMode = am ? 'body' : (figure ?? (isRehabClip(clipName) ? 'skeleton' : 'body'))
  const focusJoint = am ? focusJointOf(am.focus_bone, side) : clip.focusJoint
  // a rehab clip always labels its focus joint (colour never carries the meaning alone)
  const markers = useMemo<Marker[]>(() => {
    if (markersIn?.length) return markersIn
    if (!focusJoint) return []
    return [{ joint: focusJoint, status: 'focus', label: `${SIDE_WORD[side]} ${JOINT_WORD[focusJoint] ?? focusJoint}` }]
  }, [markersIn, focusJoint, side])
  const firstCaption = script ? scriptCaption(script, 1) : am ? stepAt(am.steps, 0).caption : sample(clip, 0).caption
  const stepsTotal = script ? script.steps.length : am ? Math.max(1, am.steps.length) : clip.steps
  // what is playing (script, GLB action or procedural clip): a change resets the clock, caption and step
  const current: object = script ?? am ?? clip
  const [angle, setAngle] = useState<number | null>(null)
  // one mutable clock, read only inside effects, handlers and the stage's loop, which advances `time`
  const clock = useRef<Clock>({ time: 0, playing: autoplay, speed: 1, warp: 0 })
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
    clock.current.warp = 0
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

  // Stage size, pill widths, and from them the label gutter and the insets the figure keeps clear of.
  const boxRef = useRef<HTMLDivElement>(null)
  const labelRefs = useRef(new Map<string, HTMLButtonElement>())
  const leaderRefs = useRef(new Map<string, SVGLineElement>())
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    // the observer reports the first size as soon as it starts observing
    const read = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }))
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [chipWs, setChipWs] = useState<Record<string, number>>({})
  const measureChips = useCallback(() => {
    const next: Record<string, number> = {}
    for (const m of markers) next[m.joint] = labelRefs.current.get(m.joint)?.offsetWidth || estimateChipW(m)
    setChipWs((prev) => (Object.keys(next).length === Object.keys(prev).length && Object.entries(next).every(([k, v]) => Math.abs((prev[k] ?? 0) - v) < 1) ? prev : next))
  }, [markers])
  // (measured from the render loop in `onProject` once the pills are laid out and fonts load;
  // an estimate from the label length until then)

  const view = camera ?? am?.camera ?? clip.camera
  const captionH = captions ? CAPTION_H[compact ? 'compact' : 'full'] : 0
  const chipW = Math.max(0, ...markers.map((m) => chipWs[m.joint] ?? estimateChipW(m)))
  const w = size.w
  const gutter: Gutter | null = markers.length && w ? chooseGutter(w, chipW, gutterSide(view, side)) : null
  const rows = gutter === 'top' ? bandRows(markers.map((m) => chipWs[m.joint] ?? estimateChipW(m)), w) : 1
  const insets = useMemo<Insets>(
    () => (gutter ? stageInsets({ gutter, chipW, captionH, overlayTop, rows }) : { top: Math.max(EDGE, VIEW_H, overlayTop), bottom: captionH + 4, left: EDGE, right: EDGE }),
    [gutter, chipW, captionH, overlayTop, rows],
  )

  // Label layer: DOM nodes moved directly from the render loop (no React state per frame).
  const onProject = useCallback(
    (proj: Projection) => {
      const box = boxRef.current
      if (!box) return
      // the render loop also notices a size the observer has not reported yet
      if (box.clientWidth !== size.w || box.clientHeight !== size.h) setSize({ w: box.clientWidth, h: box.clientHeight })
      if (!gutter) return
      const anchors = markers.flatMap((m) => (proj[m.joint] ? [{ id: m.joint, x: proj[m.joint].x, y: proj[m.joint].y }] : []))
      const widths: Record<string, number> = {}
      for (const m of markers) widths[m.joint] = labelRefs.current.get(m.joint)?.offsetWidth || chipWs[m.joint] || estimateChipW(m)
      if (markers.some((m) => Math.abs(widths[m.joint] - (chipWs[m.joint] ?? 0)) >= 1)) measureChips() // fonts loaded, label changed
      const placed = placeLabels(anchors, widths, { w: box.clientWidth, h: box.clientHeight, gutter, insets, captionH, overlayTop })
      for (const l of placed) {
        const el = labelRefs.current.get(l.id)
        if (el) el.style.transform = `translate(${l.x}px, ${l.y}px)`
        const line = leaderRefs.current.get(l.id)
        if (line) {
          line.setAttribute('x1', String(l.x1))
          line.setAttribute('y1', String(l.y1))
          line.setAttribute('x2', String(l.x2))
          line.setAttribute('y2', String(l.y2))
        }
      }
    },
    [markers, gutter, insets, captionH, overlayTop, chipWs, measureChips, size],
  )

  const replay = () => {
    clock.current.time = 0
    clock.current.warp = 0
    setCaption(firstCaption)
    setStep(1)
    stepRef.current = 1
    setPlaying(true)
  }

  const box = ASPECT[aspect ?? (compact ? '4/5' : '16/10')]
  // Provenance is for reviewers, not the patient's view line: kept on title / data-provenance.
  const provenance = am
    ? `${sourceLabel(am.source, am)}${script && action === 'abduction' ? ' · paced to the prescription (raise 3 s, hold, lower 3 s)' : ''}`
    : mode === 'skeleton'
      ? `skeleton view${clip.source ? ` · ${clip.source}` : ''}`
      : 'procedural figure (same figure as Home)'
  const viewMaxW = w ? Math.min(gutter === 'left' ? insets.left - 2 * EDGE : Infinity, overlayTop ? w - ZOOM_BUTTONS_W - 2 * EDGE : w - 3 * EDGE) : undefined

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
            script={script}
            insets={insets}
            zoom={zoom}
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
            insets={insets}
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
                strokeWidth={1.5}
                opacity={0.85}
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
            style={{ transform: `translate(${EDGE}px, ${VIEW_H + i * (CHIP_H + GAP)}px)` }}
            className={`absolute left-0 top-0 flex min-h-14 items-center gap-2 whitespace-nowrap rounded-full px-4 text-base font-bold shadow-md ${MARKER_STYLE[m.status].chip}`}
          >
            <span aria-hidden className="inline-block h-3.5 w-3.5 rounded-full" style={{ background: MARKER_STYLE[m.status].color }} />
            {chipText(m)}
          </button>
        ))}
        {captions && (
          <div data-testid="avatar-caption" title={caption || undefined} className={`absolute inset-x-0 bottom-0 bg-black/50 px-4 py-2 text-lg text-white ${compact ? 'truncate' : 'line-clamp-2'}`}>
            {caption || `Step ${step} of ${stepsTotal}`}
          </div>
        )}
        <div data-testid="view-line" title={provenance} data-provenance={provenance} className="absolute left-3 top-2 truncate text-base leading-snug text-white/70" style={viewMaxW ? { maxWidth: viewMaxW } : undefined}>
          {VIEW_WORD[view]} · {speed}×
        </div>
        {mode === 'skeleton' && clip.arc && showCues && (
          <div data-testid="arc-readout" title={clip.source} className={`absolute right-3 ${captions ? 'bottom-16' : 'bottom-3'} max-w-[70%] truncate rounded-full bg-black/45 px-3 py-1 text-base text-white`}>
            <span className="text-[#F2B457]">target {Math.round(clip.arc.targetDeg)}°</span>
            {angle !== null && <span className="text-[#7FE0C4]"> · figure {angle}°</span>}
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

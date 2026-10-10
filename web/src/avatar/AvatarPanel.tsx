import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../design/Button'
import { Pause, Play, RotateCcw } from '../design/Icon'
import { AvatarScene, type Clock, type FigureMode, type Projection, type Tick } from './AvatarScene'
import { CLIPS, type Clip, mirror } from './clips'
import type { Insets } from './framing'
import { GlbScene } from './GlbScene'
import { type GlbActionMeta, actionFor, focusJointOf, pacedActionTime, sourceLabel, stepAt } from './glbActions'
import { type AvatarAsset, loadAvatarAsset, peekAvatarAsset, webglAvailable } from './glbAsset'
import { EDGE, VIEW_H } from './labels'
import type { Marker } from './markers'
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
  /** @deprecated design v2 draws no joint chips to tap; Home uses `hotspots` / `onHot`. */
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
   *  figure keeps clear of. */
  overlayTop?: number
  className?: string
  /** Demonstration theater: the dock (step, progress, Play/Pause, Replay, Slower) replaces
   *  the caption, view line and controls; for Arm out to the side the figure's own shoulder angle,
   *  the limit line and the trunk-lean tag are drawn over the stage. */
  theater?: boolean
  /** The stage alone (session reference): no caption, view line, controls or reference line. */
  bare?: boolean
  /** Theater: called once when the demonstrated rep ends. */
  onComplete?: () => void
  /** Imperative control of the reference figure for the host (Demonstration, session reference). */
  ctlRef?: MutableRefObject<AvatarCtl | null>
  /** Today's upper-arm limit (deg), e.g. 60 on a gentle day: the script holds there and the
   *  theater limit line shows it. */
  limitDeg?: number
  /** Home body map: tappable dots on the projected joints (GLB figure only). */
  hotspots?: Hotspot[] | null
  /** Joint of the active hotspot (`aria-pressed`). */
  hotActive?: string
  onHot?: (joint: string) => void
  /** Every projection of the joints (stage pixels), for the host's own overlays. */
  onJoints?: (pts: Projection, box?: HTMLElement) => void
  /** Further joints to project for `onJoints` (e.g. the cup sheet dots `dot1..dot5`, `cup`). */
  jointList?: string[]
  /** The patient's practising side when the figure is mirrored to face them (Demonstration): the
   *  focus marker names this side. */
  patientSide?: 'left' | 'right'
}

export type Hotspot = { key: string; joint: string; label: string; word: string; status: 'focus' | 'watch' | 'stable' }

/** What a host can do with the reference figure. `seek` pins the action time (s) until `replay`;
 *  `am` / `clock` are the GLB action and the shared clock, for hosts that pace the figure. */
export type AvatarCtl = {
  play(): void
  pause(): void
  replay(): void
  setRate(r: number): void
  seek(t: number): void
  readonly am: GlbActionMeta | null
  readonly clock: MutableRefObject<Clock>
}

const SIDE_WORD = { left: 'Left', right: 'Right' }
const JOINT_WORD: Partial<Record<string, string>> = { lShoulder: 'shoulder', rShoulder: 'shoulder', lElbow: 'elbow', rElbow: 'elbow', lWrist: 'hand', rWrist: 'hand' }
const VIEW_WORD = { front: 'Front view', side: 'Side view' }

function clipByName(name: ClipName): Clip {
  return isRehabClip(name) ? REHAB_CLIPS[name] : CLIPS[name]
}

const SPEEDS = [1, 0.5, 0.25]
/** Height of the theater dock, kept clear of the figure. */
const THEATER_DOCK_H = 200
const ASPECT: Record<NonNullable<Props['aspect']>, string> = {
  '16/10': 'aspect-[16/10]',
  '4/5': 'aspect-[4/5] max-h-[525px]',
  '3/4': 'aspect-[3/4]',
}
/** Caption bar height reserved at the bottom of the stage: one line in a compact panel (the
 *  caption is truncated there), up to two lines otherwise. */
const CAPTION_H = { compact: 48, full: 72 }
const ZOOM_BUTTONS_W = 184 // Home's three 56 px zoom / rotate buttons at the top-right

type Phase = { step: number; start: number; end: number }
type Timeline = { n: number; doneAt: number; phases: Phase[]; pos: (c: Clock) => number; seek: (c: Clock, v: number) => void }

const dtIcon = (d: React.ReactNode) => (
  <svg aria-hidden width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
)

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

/** The one avatar: a pacing reference (design v2, 6 Oct: white figure on a sky stage). It never
 *  scores the patient. It plays the Blender-built GLB (one action per exercise, see
 *  `glbActions.ts`; the demonstration script and time warp for the three locked exercises in
 *  `script.ts`) and falls back to the procedural figure when the GLB or WebGL is unavailable.
 *
 *  As the designers' artifact: no joint text chips or leader lines (the markers are drawn as joint
 *  dots on the figure); Home passes `hotspots` instead (status in each button's name), the
 *  Demonstration uses `theater`, the session reference `bare`. The top line tells the patient only
 *  the view and the speed; where the motion comes from (recording, scaling, procedural) is kept on
 *  the element's `title` and `data-provenance` for reviewers. Every number drawn here (the theater
 *  shoulder angle) is the figure's own, never the patient's. */
export function AvatarPanel({
  clip: clipName,
  paced = null,
  autoplay = true,
  camera,
  side = 'left',
  markers: markersIn,
  compact = false,
  showCues = true,
  onStep,
  aspect,
  figure,
  holdS,
  zoom = 1,
  overlayTop = 0,
  className = '',
  theater = false,
  bare = false,
  onComplete,
  ctlRef,
  limitDeg,
  hotspots = null,
  hotActive,
  onHot,
  onJoints,
  jointList,
  patientSide,
}: Props) {
  const clip: Clip = useMemo(() => (side === 'right' ? mirror(clipByName(clipName)) : clipByName(clipName)), [clipName, side])
  const { asset: glb, loading: glbLoading, fail: glbFail } = useGlbAsset()
  const action = actionFor(clipName)
  const am = glb?.meta.actions[action] ?? null
  const script = useMemo(() => (am ? buildScript(action, am, { holdS, limitDeg }) : null), [action, am, holdS, limitDeg])
  // the GLB brings its own materials and has no skeleton arcs, so it counts as the body figure
  const mode: FigureMode = am ? 'body' : (figure ?? (isRehabClip(clipName) ? 'skeleton' : 'body'))
  const focusJoint = am ? focusJointOf(am.focus_bone, side) : clip.focusJoint
  // the focus joint gets a dot unless the host passes its own list (an explicit [] means none)
  const markers = useMemo<Marker[]>(() => {
    if (markersIn) return markersIn
    if (!focusJoint) return []
    return [{ joint: focusJoint, status: 'focus', label: `${SIDE_WORD[patientSide ?? side]} ${JOINT_WORD[focusJoint] ?? focusJoint}` }]
  }, [markersIn, focusJoint, side, patientSide])
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

  const boxRef = useRef<HTMLDivElement>(null)

  // Theater readouts for a shoulder lift: the figure's own shoulder angle (from its projected
  // joints), the limit line and the trunk-lean tag, moved directly from the render loop.
  const angleOn = theater && (action === 'abduction' || action === 'flexion') && !!focusJoint && /Shoulder$/.test(focusJoint)
  const angleJoints = useMemo(() => {
    if (!angleOn || !focusJoint) return [] as string[]
    const p0 = focusJoint.charAt(0)
    const q = p0 === 'l' ? 'r' : 'l'
    return [`${p0}Shoulder`, `${p0}Elbow`, `${p0}Wrist`, `${q}Shoulder`]
  }, [angleOn, focusJoint])
  const angLimit = limitDeg ?? (typeof am?.ceiling_deg === 'number' ? am.ceiling_deg : 90)
  const angRefs = useRef<{ svg?: SVGSVGElement | null; limit?: SVGLineElement | null; arc?: SVGPathElement | null; limitTag?: HTMLDivElement | null; valTag?: HTMLDivElement | null; valNum?: HTMLElement | null; trunkTag?: HTMLDivElement | null }>({})
  const angDir = useRef(0)
  const peakDeg = am?.pace?.peak_deg
  const updateAngles = useCallback(
    (proj: Projection) => {
      const r = angRefs.current
      const [js, je, jw, jo] = angleJoints
      const S = proj[js]
      const E = proj[je]
      const W = proj[jw]
      const O = proj[jo]
      if (!S || !E || !r.svg || !r.limit || !r.arc || !r.limitTag || !r.valTag || !r.valNum || !r.trunkTag) return
      const vx = E.x - S.x
      const vy = E.y - S.y
      const up = Math.hypot(vx, vy) || 1
      const fore = W ? Math.hypot(W.x - E.x, W.y - E.y) : up
      const deg = Math.min(peakDeg ?? 180, (Math.acos(Math.max(-1, Math.min(1, vy / up))) * 180) / Math.PI)
      if (Math.abs(vx) > 4) angDir.current = Math.sign(vx)
      const dir = angDir.current || (O && O.x > S.x ? -1 : 1)
      const R = up + fore
      const L = (angLimit * Math.PI) / 180
      const lx = S.x + dir * R * Math.sin(L)
      const ly = S.y + R * Math.cos(L)
      r.limit.setAttribute('x1', String(S.x))
      r.limit.setAttribute('y1', String(S.y))
      r.limit.setAttribute('x2', String(lx))
      r.limit.setAttribute('y2', String(ly))
      const BW = r.svg.clientWidth || 0
      const BH = r.svg.clientHeight || 0
      const place = (el: HTMLElement, x: number, y: number, ax: number, ay: number) => {
        const w = el.offsetWidth
        const h = el.offsetHeight
        const left = Math.max(6, Math.min(BW - w - 6, x - ax * w))
        const top = Math.max(6, Math.min(BH - h - 6, y - ay * h))
        el.style.transform = `translate(${left}px, ${top}px)`
      }
      place(r.limitTag, lx, ly - 10, dir > 0 ? 1 : 0, 1)
      const a = (deg * Math.PI) / 180
      const rad = Math.max(26, Math.min(52, up * 0.45))
      const ex = S.x + dir * rad * Math.sin(a)
      const ey = S.y + rad * Math.cos(a)
      r.arc.setAttribute('d', deg < 3 ? '' : `M ${S.x} ${S.y + rad} A ${rad} ${rad} 0 0 ${dir > 0 ? 0 : 1} ${ex} ${ey}`)
      const m = a / 2
      const tr = rad + 34
      place(r.valTag, S.x + dir * tr * Math.sin(m), S.y + tr * Math.cos(m), 0.5, 0.5)
      r.valNum.textContent = `${Math.round(deg)}°`
      r.valTag.dataset.at = deg >= angLimit - 3 ? '1' : '0'
      if (O) place(r.trunkTag, O.x - dir * 34, O.y + 30, dir > 0 ? 1 : 0, 0.5)
    },
    [angleJoints, angLimit, peakDeg],
  )

  const hotRefs = useRef(new Map<string, HTMLButtonElement>())
  const hotJoints = useMemo(() => [...angleJoints, ...(hotspots ?? []).map((h) => h.joint), ...(jointList ?? [])], [angleJoints, hotspots, jointList])

  // Stage size (the view line's width limit).
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

  const view = camera ?? am?.camera ?? clip.camera
  const captionH = theater ? THEATER_DOCK_H : bare ? 0 : captions ? CAPTION_H[compact ? 'compact' : 'full'] : 0
  const w = size.w
  // design v2: no label gutter; the figure keeps clear of the view line / host buttons and the caption or dock
  const insets = useMemo<Insets>(() => ({ top: Math.max(EDGE, VIEW_H, overlayTop), bottom: captionH + 4, left: EDGE, right: EDGE }), [captionH, overlayTop])

  // Overlay layer: DOM nodes moved directly from the render loop (no React state per frame).
  const onProject = useCallback(
    (proj: Projection) => {
      const box = boxRef.current
      if (!box) return
      if (angleOn) updateAngles(proj)
      onJoints?.(proj, box)
      if (hotspots)
        for (const h of hotspots) {
          const el = hotRefs.current.get(h.joint)
          const pt = proj[h.joint]
          if (!el) continue
          if (!pt) {
            el.style.visibility = 'hidden'
            continue
          }
          el.style.visibility = 'visible'
          el.style.transform = `translate(${pt.x}px, ${pt.y}px) translate(-50%, -50%)`
        }
      // the render loop also notices a size the observer has not reported yet
      if (box.clientWidth !== size.w || box.clientHeight !== size.h) setSize({ w: box.clientWidth, h: box.clientHeight })
    },
    [angleOn, updateAngles, onJoints, hotspots, size],
  )
  const projectWanted = markers.length > 0 || !!hotspots?.length || !!onJoints || angleOn

  const replay = () => {
    clock.current.time = 0
    clock.current.warp = 0
    if (paced == null) clock.current.target = null
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
  const viewMaxW = w ? (overlayTop ? w - ZOOM_BUTTONS_W - 2 * EDGE : w - 3 * EDGE) : undefined

  // Theater dock: step text, hold countdown and a segmented progress bar from one rAF timeline.
  const [finished, setFinished] = useState(false)
  const segRefs = useRef<(HTMLDivElement | null)[]>([])
  const holdRef = useRef<HTMLSpanElement>(null)
  const doneRef = useRef(false)
  const prevPos = useRef(0)
  const timeline = useMemo<Timeline>(() => {
    if (script) {
      const n = script.steps.length
      let acc = 0
      let doneAt = 0
      const phases: Phase[] = []
      for (const sg of script.segments) {
        phases.push({ step: sg.step, start: acc, end: acc + sg.dur })
        acc += sg.dur
        if (sg.step === n) doneAt = acc
      }
      return {
        n,
        doneAt,
        phases: phases.filter((p) => p.end <= doneAt + 1e-6),
        pos: (c) => c.warp ?? 0,
        seek: (c, v) => {
          c.warp = v
        },
      }
    }
    if (am) {
      const st = am.steps.length ? am.steps : [{ t: 0, step: 1, caption: '' }]
      const doneAt = am.rep?.[1] ?? am.duration
      const phases = st.map((x, i) => ({ step: i + 1, start: x.t, end: i + 1 < st.length ? st[i + 1].t : doneAt }))
      return {
        n: st.length,
        doneAt,
        phases,
        pos: (c) => c.time,
        seek: (c, v) => {
          c.time = v
        },
      }
    }
    const n = Math.max(1, clip.steps || 1)
    const doneAt = Math.max(0.1, clip.duration - (clip.loop ? LOOP_BRIDGE_S : 0))
    const phases = Array.from({ length: n }, (_, i) => ({ step: i + 1, start: (i * doneAt) / n, end: ((i + 1) * doneAt) / n }))
    return {
      n,
      doneAt,
      phases,
      pos: (c) => c.time,
      seek: (c, v) => {
        c.time = v
      },
    }
  }, [script, am, clip])
  useEffect(() => {
    if (!theater) return
    let raf = 0
    const loop = () => {
      const c = clock.current
      const tl = timeline
      let p = tl.pos(c)
      const prev = prevPos.current
      // the rep ends when the timeline passes its last step (or wraps past it between frames)
      if (!doneRef.current && c.playing && ((prev < tl.doneAt && p >= tl.doneAt - 1e-3) || p + tl.doneAt * 0.5 < prev)) {
        doneRef.current = true
        tl.seek(c, tl.doneAt - 2e-3)
        c.playing = false
        p = tl.doneAt
        setPlaying(false)
        setFinished(true)
        onComplete?.()
      }
      prevPos.current = p
      const fills = new Array<number>(tl.n).fill(0)
      const lens = new Array<number>(tl.n).fill(0)
      let holdLeft: number | null = null
      for (const ph of tl.phases) {
        const k = ph.step - 1
        if (k < 0 || k >= tl.n) continue
        const len = Math.max(1e-6, ph.end - ph.start)
        lens[k] += len
        fills[k] += doneRef.current ? len : Math.max(0, Math.min(len, p - ph.start))
        if (!doneRef.current && p >= ph.start && p < ph.end && /^hold/i.test(script?.steps[k] ?? '')) holdLeft = (ph.end - p) / (c.speed || 1)
      }
      segRefs.current.forEach((el, k) => {
        if (el) el.style.width = `${Math.round((100 * fills[k]) / (lens[k] || 1))}%`
      })
      const h = holdRef.current
      if (h) {
        h.style.display = holdLeft == null ? 'none' : 'inline-flex'
        if (holdLeft != null) h.textContent = `${Math.max(1, Math.ceil(holdLeft))} s`
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [theater, timeline, onComplete, script])
  const stepText = (caption || '').replace(/^Step \d+ of \d+\s*·\s*/, '')
  const stepLabel = stepText ? stepText.charAt(0).toUpperCase() + stepText.slice(1) : ''
  const theaterReplay = () => {
    doneRef.current = false
    prevPos.current = 0
    setFinished(false)
    replay()
  }

  // the host's handle on the figure (latest closures every render)
  const replayRef = useRef(theaterReplay)
  useEffect(() => {
    replayRef.current = theaterReplay
  })
  useEffect(() => {
    if (!ctlRef) return
    ctlRef.current = {
      play: () => {
        clock.current.playing = true
        setPlaying(true)
      },
      pause: () => {
        clock.current.playing = false
        setPlaying(false)
      },
      replay: () => replayRef.current(),
      setRate: (r: number) => {
        if (r > 0) clock.current.speed = r
      },
      seek: (t: number) => {
        clock.current.target = t
        clock.current.time = t
      },
      am,
      clock,
    }
  }, [ctlRef, am])

  return (
    <div className={theater || bare ? `dth-panel ${className}` : `flex flex-col gap-3 ${className}`}>
      <div ref={boxRef} data-stage className={theater || bare ? 'dth-stage' : `relative w-full shrink-0 overflow-hidden rounded-2xl bg-[var(--stage-a)] ${box}`}>
        {lost ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_50%_40%,#161B22,#0B0E12)] p-6 text-center text-lg text-white/80">
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
            onProject={projectWanted ? onProject : undefined}
            extraJoints={hotJoints}
            onContextLost={glbFail}
          />
        ) : glbLoading ? (
          <div role="status" className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_50%_40%,#161B22,#0B0E12)] text-lg text-white/80">
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
        {hotspots &&
          glb &&
          hotspots.map((h) => (
            <button
              key={h.joint}
              type="button"
              ref={(el) => {
                if (el) hotRefs.current.set(h.joint, el)
                else hotRefs.current.delete(h.joint)
              }}
              className={`hp-hot hp-hot-${h.status}${h.joint === hotActive ? ' hp-hot-on' : ''}`}
              style={{ visibility: 'hidden' }}
              aria-label={`${h.label} — ${h.word}`}
              aria-pressed={h.joint === hotActive}
              onClick={() => onHot?.(h.joint)}
            >
              <span className="hp-hot-dot" aria-hidden />
            </button>
          ))}
        {angleOn && glb && (
          <>
            <svg
              aria-hidden
              ref={(el) => {
                angRefs.current.svg = el
              }}
              className="dth-ang-svg"
            >
              <line
                ref={(el) => {
                  angRefs.current.limit = el
                }}
                className="dth-ang-limit"
              />
              <path
                ref={(el) => {
                  angRefs.current.arc = el
                }}
                className="dth-ang-arc"
              />
            </svg>
            <div
              ref={(el) => {
                angRefs.current.limitTag = el
              }}
              className="dth-ang-ltag"
            >
              {`${angLimit}° limit`}
            </div>
            <div
              ref={(el) => {
                angRefs.current.valTag = el
              }}
              className="dth-ang-tag"
            >
              <b
                ref={(el) => {
                  angRefs.current.valNum = el
                }}
              >
                0°
              </b>
              <span>shoulder</span>
            </div>
            <div
              ref={(el) => {
                angRefs.current.trunkTag = el
              }}
              className="dth-ang-tag"
            >
              <b>0°</b>
              <span>trunk lean</span>
            </div>
          </>
        )}
        {captions && !theater && !bare && (
          <div data-testid="avatar-caption" title={caption || undefined} className={`absolute inset-x-0 bottom-0 bg-black/50 px-4 py-2 text-lg text-white ${compact ? 'truncate' : 'line-clamp-2'}`}>
            {caption || `Step ${step} of ${stepsTotal}`}
          </div>
        )}
        {!theater && !bare && (
          <div data-testid="view-line" title={provenance} data-provenance={provenance} className="absolute left-3 top-2 truncate text-base leading-snug text-white/70" style={viewMaxW ? { maxWidth: viewMaxW } : undefined}>
            {VIEW_WORD[view]} · {speed}×
          </div>
        )}
        {mode === 'skeleton' && clip.arc && showCues && (
          <div data-testid="arc-readout" title={clip.source} className={`absolute right-3 ${captions ? 'bottom-16' : 'bottom-3'} max-w-[70%] truncate rounded-full bg-black/45 px-3 py-1 text-base text-white`}>
            <span className="text-[#E7A447]">target {Math.round(clip.arc.targetDeg)}°</span>
            {angle !== null && <span className="text-[#8DB5FF]"> · figure {angle}°</span>}
          </div>
        )}
      </div>
      {bare ? null : theater ? (
        <div className="dth-dock">
          <div className="dth-caption" data-testid="avatar-caption" aria-live="polite">
            <div className="dth-steplabel">{`Step ${step} of ${stepsTotal}`}</div>
            <div className="dth-steptext">
              <span>{stepLabel || `Step ${step}`}</span>
              <span ref={holdRef} className="dth-hold" style={{ display: 'none' }} />
            </div>
          </div>
          <div className="dth-progress" aria-hidden>
            {Array.from({ length: timeline.n }, (_, k) => (
              <div key={k} className="dth-seg">
                <div
                  className="dth-fill"
                  ref={(el) => {
                    segRefs.current[k] = el
                  }}
                />
              </div>
            ))}
          </div>
          <div className="dth-controls">
            <div className="dth-group">
              <button type="button" className="dth-btn" disabled={finished} onClick={() => setPlaying((p) => !p)}>
                {playing ? <Pause aria-hidden size={18} /> : <Play aria-hidden size={18} />}
                {playing ? 'Pause' : 'Play'}
              </button>
              <button type="button" className="dth-btn" onClick={theaterReplay}>
                <RotateCcw aria-hidden size={18} />
                Replay
              </button>
              <button type="button" className="dth-btn" aria-pressed={speed !== 1} onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}>
                {dtIcon([<circle key="c" cx={12} cy={13} r={8} />, <path key="p" d="M12 9v4l2 2M10 2h4" />])}
                {speed === 1 ? 'Slower' : `Slower · ${speed}×`}
              </button>
            </div>
          </div>
        </div>
      ) : (
        !compact && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="px-4 text-lg" onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play'}</Button>
            <Button variant="secondary" className="px-4 text-lg" onClick={replay}>Replay</Button>
            <Button variant="secondary" className="px-4 text-lg" onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}>Slower</Button>
            <Button variant="secondary" className="px-4 text-lg" aria-pressed={closeUp} onClick={() => setCloseUp((c) => !c)}>Close-up</Button>
            <Button variant="secondary" className="px-4 text-lg" aria-pressed={captions} onClick={() => setCaptions((c) => !c)}>Captions</Button>
          </div>
        )
      )}
      {!theater && !bare && <p className="text-center text-base text-muted">Reference only. Your reps are verified from the camera, not from matching the figure.</p>}
    </div>
  )
}

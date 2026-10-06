import { useEffect, useMemo, useRef, useState } from 'react'
import type { PraxisEvent } from '../lib/events'
import { prefersReducedMotion } from '../lib/motion'
import { AvatarPanel, type AvatarCtl, type ClipName } from './AvatarPanel'
import { pacedActionTime } from './glbActions'
import type { Projection } from './scene'

/** Reference figure of the live Arm out to the side screen (07c), as the designers' 6 Oct artifact
 *  draws it: a metronome, never a mirror of the patient and never a scorer. It lifts for 3 s,
 *  holds for the prescribed hold (from the service frame) and lowers for 3 s, with a dashed 90°
 *  arc, a cue line on the moving arm and a hold ring at the wrist; the footer shows the tempo
 *  chips and the figure's own "Reference reps" ticks (its own loops, not the patient's reps).
 *
 *  Wiring (design v2 port, D-AVATAR): the mode comes from real events through `refMode`, and the
 *  first demonstration waits for a coach event that carries `ui.avatar_clip` (`demoRequested`),
 *  so the figure's playback always traces to an event. Later requests (the coach's "lift started"
 *  cue) re-sync the figure's cycle to the patient's lift. */

export type RefMode = 'idle' | 'dim-lost' | 'dim-cue' | 'run'

/** Seconds a posture cue (`compensation_lean`) or a coach correction dims the figure. */
export const REF_DIM_S = 4
/** Seconds the figure rests at the bottom between its own reps. */
const AV_REST_S = 1
/** Lift and lower tempo (s). Not in the prescription or frame; the copy says "Lift for 3 / Lower for 3". */
export const REF_LIFT_S = 3
export const REF_LOWER_S = 3

type FrameLike = { t: number } | null

/** The figure's mode from the event stream: idle while a hold (rest / pause) is open or both sets
 *  are done; dimmed while tracking is lost, and for `REF_DIM_S` after a posture cue or a coach
 *  correction; otherwise it runs. `now` is the newest event time (s). */
export function refMode(events: PraxisEvent[], _frame: FrameLike, hold: { open: boolean }, now: number): RefMode {
  if (hold.open) return 'idle'
  if (events.some((e) => e.type === 'arm_complete')) return 'idle'
  let lost: boolean | null = null
  let lean: number | null = null
  let correct: number | null = null
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (lost === null && (e.type === 'perception_lost' || e.type === 'perception_regained')) lost = e.type === 'perception_lost'
    if (lean === null && e.type === 'compensation_lean') lean = e.t
    if (correct === null && e.type === 'coach' && e.action === 'correct') correct = e.t
    if (lost !== null && lean !== null && correct !== null) break
  }
  if (lost) return 'dim-lost'
  if ((lean !== null && now - lean < REF_DIM_S) || (correct !== null && now - correct < REF_DIM_S)) return 'dim-cue'
  return 'run'
}

/** Time (s) of the newest coach event that asks for avatar playback (`ui.avatar_clip`: the rule
 *  coach's `arm_intro` at exercise start and `arm_lift` when a lift starts), or null. */
export function demoRequested(events: PraxisEvent[]): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type !== 'coach') continue
    const ui = e.ui as { avatar_clip?: unknown } | undefined
    if (ui && typeof ui.avatar_clip === 'string' && ui.avatar_clip) return e.t
  }
  return null
}

type Phase = 'idle' | 'toIdle' | 'dim' | 'reset' | 'rest' | 'lift' | 'hold' | 'lower'
type St = { phase: Phase; t0: number; h: number; demoDone: boolean; reps: number; from: number; R: number; cue: boolean; holdP: number | null }
type Svg = { root?: SVGSVGElement | null; arc?: SVGPathElement | null; tick?: SVGLineElement | null; tickT?: SVGTextElement | null; cue?: SVGPolylineElement | null; ring?: SVGCircleElement | null; ringBg?: SVGCircleElement | null }

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2)
const JOINTS = ['lShoulder', 'lElbow', 'lWrist', 'rShoulder', 'rElbow', 'rWrist']

export function RefAvatar({
  clip = 'abduction',
  mode,
  demoAt,
  holdS,
  side,
  repsPerSet = 8,
  setKey = 1,
  onJoints: onJointsOut,
}: {
  clip?: ClipName
  mode: RefMode
  demoAt: number | null
  holdS: number
  side: string
  repsPerSet?: number
  setKey?: number | string
  onJoints?: (pts: Projection) => void
}) {
  const ctl = useRef<AvatarCtl | null>(null)
  const svg = useRef<Svg>({})
  const st = useRef<St>({ phase: 'idle', t0: 0, h: 0, demoDone: false, reps: 0, from: 0, R: 0, cue: false, holdP: null })
  const [ui, setUi] = useState({ phase: 'idle' as Phase, reps: 0, demo: false })
  const [reduced] = useState(() => prefersReducedMotion())
  // the figure faces the patient: their left arm is the figure's right
  const avSide = side === 'left' ? 'right' : 'left'
  const tempo = { lift: REF_LIFT_S, hold: holdS, lower: REF_LOWER_S }
  const waiting = mode === 'run' && demoAt == null

  const enter = (phase: Phase, now: number) => {
    const s = st.current
    s.phase = phase
    s.t0 = now
    s.from = s.h
    setUi({ phase, reps: s.reps, demo: !s.demoDone })
  }

  useEffect(() => {
    const s = st.current
    s.demoDone = false
    s.reps = 0
    setUi((u) => ({ ...u, reps: 0 }))
  }, [setKey])

  const lastDemo = useRef<number | null>(null)
  useEffect(() => {
    const now = performance.now()
    const s = st.current
    const fresh = demoAt != null && demoAt !== lastDemo.current
    lastDemo.current = demoAt
    if (mode === 'idle' || waiting) enter('toIdle', now)
    else if (mode === 'dim-lost' || mode === 'dim-cue') enter('dim', now)
    else if (!s.demoDone || !fresh) enter(s.h > 0.02 ? 'reset' : 'rest', now)
    // a later "lift started" cue: start the figure's lift with the patient's
    else enter(s.h > 0.02 ? 'reset' : 'lift', now)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, demoAt, waiting])

  const drawOv = (j: Projection | null) => {
    const g = svg.current
    const s = st.current
    if (!j || !g.root || !g.arc || !g.tick || !g.tickT || !g.cue || !g.ring || !g.ringBg) return
    const mv = avSide === 'right' ? 'r' : 'l'
    const ot = mv === 'r' ? 'l' : 'r'
    const S = j[mv + 'Shoulder']
    const E = j[mv + 'Elbow']
    const W = j[mv + 'Wrist']
    const O = j[ot + 'Shoulder']
    if (!S || !E || !W) return
    const dir = O ? Math.sign(S.x - O.x) || 1 : 1
    const len = Math.hypot(E.x - S.x, E.y - S.y) + Math.hypot(W.x - E.x, W.y - E.y)
    if (s.h < 0.05 || !s.R) s.R = Math.max(s.R * 0.9, len)
    const R = s.R
    g.arc.setAttribute('d', `M ${S.x} ${S.y + R} A ${R} ${R} 0 0 ${dir > 0 ? 0 : 1} ${S.x + dir * R} ${S.y}`)
    g.tick.setAttribute('x1', String(S.x + dir * (R - 12)))
    g.tick.setAttribute('y1', String(S.y))
    g.tick.setAttribute('x2', String(S.x + dir * (R + 12)))
    g.tick.setAttribute('y2', String(S.y))
    g.tickT.setAttribute('x', String(S.x + dir * (R + 16)))
    g.tickT.setAttribute('y', String(S.y + 4))
    g.tickT.setAttribute('text-anchor', dir > 0 ? 'start' : 'end')
    g.cue.setAttribute('points', `${S.x},${S.y} ${E.x},${E.y} ${W.x},${W.y}`)
    g.cue.style.opacity = s.cue && s.phase !== 'dim' ? '1' : '0'
    g.ring.setAttribute('cx', String(W.x))
    g.ring.setAttribute('cy', String(W.y))
    g.ringBg.setAttribute('cx', String(W.x))
    g.ringBg.setAttribute('cy', String(W.y))
    const C = 2 * Math.PI * 16
    g.ring.style.strokeDasharray = `${C * (s.holdP ?? 0)} ${C}`
    g.ringBg.style.opacity = s.holdP != null ? '1' : '0'
    g.ring.style.opacity = s.holdP != null ? '1' : '0'
    g.root.style.opacity = s.phase === 'idle' || s.phase === 'toIdle' ? '0' : '1'
  }

  useEffect(() => {
    let raf = 0
    const step = (now: number) => {
      raf = requestAnimationFrame(step)
      const c = ctl.current
      const s = st.current
      if (!c?.am || !c.clock) return
      const el = (now - s.t0) / 1e3
      let lowering = false
      let holdP: number | null = null
      let cue = false
      switch (s.phase) {
        case 'idle':
          s.h = 0
          break
        case 'toIdle': {
          const k = Math.min(1, el / 0.9)
          s.h = s.from * (1 - ease(k))
          lowering = true
          if (k >= 1) enter('idle', now)
          break
        }
        case 'dim':
          break
        case 'reset': {
          const k = Math.min(1, el / 1.2)
          s.h = s.from * (1 - ease(k))
          lowering = true
          if (k >= 1) enter('rest', now)
          break
        }
        case 'rest':
          s.h = 0
          if (el >= AV_REST_S) enter('lift', now)
          break
        case 'lift': {
          const k = Math.min(1, el / tempo.lift)
          s.h = reduced ? 0 : ease(k)
          cue = true
          if (k >= 1) {
            s.h = 1
            enter('hold', now)
          }
          break
        }
        case 'hold':
          s.h = 1
          holdP = Math.min(1, el / tempo.hold)
          if (el >= tempo.hold) enter('lower', now)
          break
        case 'lower': {
          const k = Math.min(1, el / tempo.lower)
          s.h = reduced ? 0 : 1 - ease(k)
          lowering = true
          cue = true
          if (k >= 1) {
            s.h = 0
            if (!s.demoDone) s.demoDone = true
            else s.reps = Math.min(repsPerSet, s.reps + 1)
            enter('rest', now)
          }
          break
        }
      }
      const q = lowering ? 0.8 + 0.2 * (1 - s.h) : 0.4 * s.h
      const t = pacedActionTime(c.am, q)
      c.clock.current.target = t
      c.clock.current.time = t
      s.cue = cue
      s.holdP = holdP
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tempo.lift, tempo.hold, tempo.lower, reduced, repsPerSet, avSide])

  const onJoints = (proj: Projection) => {
    drawOv(proj)
    onJointsOut?.(proj)
  }
  const jl = useMemo(() => JOINTS, [])
  const phase = ui.phase
  const dimmed = mode === 'dim-lost' || mode === 'dim-cue'
  const idle = mode === 'idle' || waiting
  const label = idle ? 'Reference · ready' : dimmed ? (mode === 'dim-lost' ? 'Reference · waiting for you' : 'Reference · listen to the coach') : ui.demo ? 'Reference · demonstration' : 'Reference · follow my pace'
  const PH: [Phase, string, number][] = [
    ['lift', 'Lift', tempo.lift],
    ['hold', 'Hold', tempo.hold],
    ['lower', 'Lower', tempo.lower],
  ]

  return (
    <section className={`sx-panel sx-ref av-ref ${dimmed ? 'av-dim' : ''} ${idle ? 'av-idle' : ''}`} aria-label="Reference figure">
      <div className="sx-ref-stage">
        <AvatarPanel bare overlayTop={40} clip={clip} camera="front" side={avSide} onJoints={onJoints} jointList={jl} ctlRef={ctl} />
        <svg className="av-ov" aria-hidden ref={(el) => { svg.current.root = el }}>
          <path className="av-arc" ref={(el) => { svg.current.arc = el }} />
          <line className="av-tick" ref={(el) => { svg.current.tick = el }} />
          <text className="av-tick-t" ref={(el) => { svg.current.tickT = el }}>90°</text>
          <polyline className="av-cue" ref={(el) => { svg.current.cue = el }} />
          <circle className="av-ring-bg" r={16} ref={(el) => { svg.current.ringBg = el }} />
          <circle className="av-ring" r={16} ref={(el) => { svg.current.ring = el }} />
        </svg>
      </div>
      <div className="sx-tag sx-tag-quiet">{label}</div>
      <div className="sx-ref-foot">
        <div className="av-foot">
          <div className="av-phases" role="list" aria-label="Rep tempo">
            {PH.map(([k, w, sec]) => (
              <span key={k} role="listitem" className={`av-ph ${phase === k && !dimmed ? 'is-on' : ''}`}>
                {w}
                <small>{` ${sec} s`}</small>
              </span>
            ))}
          </div>
          <div className="av-reps">
            <span className="av-reps-l">{ui.demo && mode === 'run' && !waiting ? 'Watch once, then follow' : 'Reference reps'}</span>
            <span className="av-ticks" aria-label={`${ui.reps} of ${repsPerSet} reference reps`}>
              {Array.from({ length: repsPerSet }, (_, i) => <i key={i} className={i < ui.reps ? 'is-done' : ''} />)}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

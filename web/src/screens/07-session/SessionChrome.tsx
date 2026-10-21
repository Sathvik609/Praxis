import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { AlertTriangle, Bot, Camera, Check, CloudOff, ListChecks, LoaderCircle, Pause, Play, X } from '../../design/Icon'
import { Chip } from '../../design/Chip'
import { useModalFocus } from '../../design/useModalFocus'
import { arrowSelect } from '../../design/arrowKeys'
import { usePainStopLevel } from '../../lib/api'
import { plural } from '../../lib/plural'
import type { AgentStatus, CoachSource } from '../../session/agent'
import { CameraBlocked } from '../../session/CameraBlocked'
import { type LiveStatus, type StatusLabel } from '../../session/liveStatus'
import { OverlayCanvas, type FrameEvent } from '../../session/OverlayCanvas'
import { readPrefs } from '../../lib/prefs'
import { coachVolume, resetSpeech, setCoachVolume, type CoachEvent, type Overlay } from '../../session/useCoach'
import type { EndReason } from '../../session/useSessionFlow'
import { pausedNote } from './LivePrompt'
import { RULE_TITLE } from './SessionOverlays'

/** Session chrome of screens 07 / 07b / 07c, as the designers' 6 Oct artifact draws it (`sx-*`
 *  classes in design/designer.css): header, feed and reference panels, coach and stats cards,
 *  the hold over the feed, the fixed control bar and the End dialog. The safety and honesty
 *  rules are rendered with the artifact's own elements: "Live · not recording" (`sx-rec`), the
 *  coach label as visible text, verified and unverified counts, Pause and Pain / feel unwell in
 *  the bar. */

export const STATUS_ICON: Record<LiveStatus, ReactNode> = {
  connecting: <Camera />,
  waiting_for_frames: <Camera />,
  camera_blocked: <X />,
  service_unreachable: <X />,
  calibrating: <AlertTriangle />,
  lost: <AlertTriangle />,
  tracking: <Check />,
  replay: <Play />,
  paused: <Pause />,
  ended: <Check />,
}

/** Agent run state (`agent_status` events) in the session header, so it never moves the
 *  columns. The polite live region is always mounted and empty while idle; it announces only
 *  "Coach offline" (a run in progress is shown, not announced: its caption is). Offline means the rule coach carries on; the reason is a tooltip and the
 *  chip's accessible description. */
export function AgentStatusChip({ status }: { status: AgentStatus | null }) {
  const id = useId()
  const reason = status?.reason || 'The Claude agent is unavailable. The rule-based coach carries on.'
  return (
    <span aria-live="polite" data-testid="agent-status" className="inline-flex">
      {/* shown, not announced: the caption the run produces is (one polite region per screen) */}
      {status?.state === 'thinking' && <span aria-hidden className="inline-flex"><Chip tone="focus" icon={<LoaderCircle className="motion-safe:animate-spin" />}>Coach is thinking…</Chip></span>}
      {status?.state === 'offline' && (
        <span title={reason} aria-describedby={id} className="inline-flex">
          <Chip tone="amber" icon={<CloudOff />}>Coach offline · rule coach</Chip>
          <span id={id} className="sr-only">{reason}</span>
        </span>
      )}
    </span>
  )
}

/** Header: brand, title, subtitle; on the right the red "Live · not recording" marker while the
 *  camera is on (amber "Replay · processed on the service" in replay), the agent chip and the
 *  status chip. */
export function SessionHeader({ title, sub, status, label, live = false, replay = false, agent = null }: { title: string; sub: ReactNode; status: LiveStatus; label: StatusLabel; live?: boolean; replay?: boolean; agent?: AgentStatus | null }) {
  return (
    <header className="sx-head">
      <span className="sx-brand">Praxis</span>
      {/* The screen's one level-1 heading: a role, not an h1 element, so the global heading
          rules in designer.css do not restyle the artifact's header title. */}
      <span className="sx-htitle" role="heading" aria-level={1}>{title}</span>
      <span className="sx-hsub">{sub}</span>
      <span className="sx-hright">
        {(live || replay) && (
          <span className="sx-rec">
            <span aria-hidden className={`sx-rec-dot ${replay ? 'sx-rec-replay' : ''}`} />
            {replay ? 'Replay · processed on the service' : 'Live · not recording'}
          </span>
        )}
        <AgentStatusChip status={agent} />
        <span role="status" className={`sx-chip sx-chip-${label.tone}`}>
          <span aria-hidden className="sx-chip-ic">{STATUS_ICON[status]}</span>
          {label.chip}
        </span>
      </span>
    </header>
  )
}

/** The camera panel: video (or the replay stage), the event-drawn overlay, the "You · note" tag,
 *  the measurement band and the developer line (`mono`, Judge view only), a children slot (the
 *  hold) and the camera-blocked card. Frames never reach the browser in replay. */
export function SxFeed({
  replay,
  camActive,
  status,
  videoRef,
  frame,
  note,
  band,
  bandTone = 'amber',
  mono,
  onRetry,
  errorDetail,
  children,
}: {
  replay: boolean
  camActive: boolean
  status: LiveStatus
  videoRef: RefObject<HTMLVideoElement | null>
  frame: FrameEvent | null
  note?: ReactNode
  band?: ReactNode
  bandTone?: 'amber' | 'mint' | 'neutral'
  mono?: ReactNode
  onRetry: () => void
  errorDetail?: string | null
  children?: ReactNode
}) {
  return (
    <section className="sx-panel sx-feed" aria-label="Your camera">
      <div className="sx-frame">
        {replay ? <div aria-hidden className="sx-replaybg" /> : <video ref={videoRef} muted playsInline className="sx-video" />}
        <OverlayCanvas width={640} height={480} calibration={null} frame={frame} mirrored={!replay} />
      </div>
      <div className="sx-tag">
        <span aria-hidden className={`sx-dot ${camActive && !replay ? 'sx-dot-live' : replay ? 'sx-dot-replay' : ''}`} />
        <b>You</b>
        {note && <span>· {note}</span>}
      </div>
      {band && (
        <div className="sx-foot">
          <div className={`sx-band sx-band-${bandTone}`}>{band}</div>
        </div>
      )}
      {/* The judge line keeps its own row at the foot of the feed: in the top-right stack a long
          line (the NHPT one) grew leftwards over the "You" tag (e2e 11 Oct). */}
      {mono && <div className="sx-mono sx-mono-row">{mono}</div>}
      {children}
      {(status === 'camera_blocked' || status === 'service_unreachable') && (
        <div className="sx-blocked"><CameraBlocked reason={status} detail={errorDetail} onRetry={onRetry} /></div>
      )}
    </section>
  )
}

/** The reference panel: the figure stage, its tag and an optional footer. */
export function SxRef({ tag, dim = false, footer, children, className = '' }: { tag: ReactNode; dim?: boolean; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`sx-panel sx-ref ${dim ? 'sx-dim' : ''} ${className}`} aria-label="Reference figure">
      <div className="sx-ref-stage">{children}</div>
      <div className="sx-tag sx-tag-quiet">{tag}</div>
      {footer && <div className="sx-ref-foot">{footer}</div>}
    </section>
  )
}

/** Which coach said it: icon + label text, so rule and agent cues never differ by colour alone. */
function CoachLabel({ label, source }: { label: string; source: CoachSource }) {
  return (
    <span data-source={source} className="inline-flex items-center gap-1.5">
      {source === 'agent' ? <Bot aria-hidden size={14} className="shrink-0" /> : <ListChecks aria-hidden size={14} className="shrink-0" />}
      <span>{label}</span>
    </span>
  )
}

/** Coach card. The eyebrow names the coach implementation that said the caption
 *  (`coachLabel(...)`) as visible text with its icon. `watch` is the posture tone, `tone` the
 *  artifact's mint / amber / neutral card. With captions off (only possible while the coach is
 *  not speaking: Audio off or volume 0) the caption is hidden; the label stays. */
export function SxCoach({
  caption,
  label,
  source = 'rule',
  eyebrow,
  tone,
  watch = false,
  captions = true,
  sub,
}: {
  caption: string
  label: string
  source?: CoachSource
  eyebrow?: string
  tone?: 'mint' | 'amber' | 'neutral'
  watch?: boolean
  captions?: boolean
  sub?: ReactNode
}) {
  const toneClass = watch ? 'sx-coach-watch cup-coach-amber' : tone ? `cup-coach-${tone}` : ''
  return (
    <section className={`sx-card sx-coach ${toneClass}`} aria-label="Coach">
      <div className="sx-kicker flex flex-wrap items-center gap-x-2">
        <span>{eyebrow ?? (watch ? 'Coach · posture' : 'Coach')}</span>
        <span aria-hidden>·</span>
        <CoachLabel label={label} source={source} />
      </div>
      {captions ? (
        <p className="sx-coach-text" aria-live="polite">{caption}</p>
      ) : (
        <p className="sx-coach-off">Captions are off. Turn them on with the captions switch below.</p>
      )}
      {sub && <p className="sx-small">{sub}</p>}
    </section>
  )
}

export type DotState = 'done' | 'now' | 'todo' | 'amber'

/** Progress card: the big metric on the left; head, dots, `extra` (exertion chip, minis) and the
 *  verified / unverified counts (always shown, from the camera totals) on the right. */
export function SxStats({
  metricLabel,
  metric,
  unit,
  metricSub,
  head,
  headRight,
  dots,
  extra,
  verified,
  unverified,
  sub,
}: {
  metricLabel: ReactNode
  metric: ReactNode
  unit?: ReactNode
  metricSub?: ReactNode
  head: ReactNode
  headRight?: ReactNode
  dots?: { label: string; items: DotState[]; numbers?: boolean } | null
  extra?: ReactNode
  verified: number
  unverified: number
  sub?: ReactNode
}) {
  return (
    <section className="sx-card sx-stats" aria-label="Progress">
      <div className="sx-metric">
        <div className="sx-kicker">{metricLabel}</div>
        <div className="sx-big">{metric}{unit && <span className="sx-unit">{unit}</span>}</div>
        {metricSub && <div className="sx-small">{metricSub}</div>}
      </div>
      <div className="sx-stats-main">
        <div className="sx-stats-head"><b>{head}</b>{headRight && <span className="sx-small">{headRight}</span>}</div>
        {dots && (
          <div className="sx-dots" role="img" aria-label={dots.label}>
            {dots.items.map((st, i) => <span key={i} aria-hidden className={`sx-d sx-d-${st}`}>{dots.numbers ? i + 1 : null}</span>)}
          </div>
        )}
        {extra}
        <div className="sx-small tabular-nums">{verified} verified · {unverified} unverified</div>
        {sub && <div className="sx-small">{sub}</div>}
      </div>
    </section>
  )
}

export type HoldKind = 'resting' | 'paused' | 'rest'
type Note = { text: string; label: string; source: CoachSource }

/** What `sxHold` decides; `since` is the opening event's time (`clock: 'event'`, seconds) or,
 *  for the patient's own rest, the wall-clock start (`clock: 'wall'`, ms). `prompt` says the
 *  open coach prompt belongs inside the hold (the screen renders it in the `prompt` slot).
 *  `caution` is the tracking-lost state (the service's `perception` pause): a non-blocking
 *  notice with no button, since the service resumes by itself once the camera sees the person
 *  or the sheet again (D-CAL-2) and the `resume` event closes it. */
export type Hold = {
  open: boolean
  kind: HoldKind
  title: string
  text: string
  since: number | null
  clock: 'event' | 'wall'
  primary: { label: string; onClick: () => void }
  onEnd: () => void
  note: Note | null
  prompt: boolean
  resumeByPrompt: boolean
  caution: boolean
}

const noop = () => {}
const CLOSED: Hold = { open: false, kind: 'paused', title: '', text: '', since: null, clock: 'event', primary: { label: '', onClick: noop }, onEnd: noop, note: null, prompt: false, resumeByPrompt: false, caution: false }

type HoldCoach = { overlay: Overlay | null; decisions: CoachEvent[]; clearOverlay: () => void }
type HoldRest = { since: number | null; end: () => void; cancel: () => void }

/** The hold over the feed: the patient's rest (counted on the wall clock), or a pause / rest
 *  the service opened (counted from its event). A stop is explained by `SessionOverlay`, so the
 *  hold stays closed then and while the feedback form is open. While paused, the coach cue said
 *  during the pause (`pausedNote`) and an open coach prompt go inside; a resume prompt's Yes is
 *  the resume. Tracking lost (21 Oct team review) is a `caution`: counting and coaching stay
 *  paused on the service (the stop rule), but nothing asks for a tap; it clears itself. */
export function sxHold(
  coach: HoldCoach,
  rest: HoldRest,
  stopped: boolean,
  feedbackOpen: boolean,
  finish: (endedEarly: boolean, reason?: EndReason) => void,
  send: (o: Record<string, unknown>) => void,
  cp: { prompt: { kind?: string } | null },
): Hold {
  if (stopped || feedbackOpen) return CLOSED
  if (rest.since != null) {
    return {
      ...CLOSED,
      open: true,
      kind: 'resting',
      title: 'Resting',
      text: 'Rest as long as you need. About a minute is usually enough. The camera is not counting.',
      since: rest.since,
      clock: 'wall',
      primary: { label: 'Rested — continue', onClick: rest.end },
      onEnd: () => {
        rest.cancel()
        finish(true, 'rest')
      },
    }
  }
  const o = coach.overlay
  if (!o || o.kind === 'stopped') return CLOSED
  const prompt = !!cp.prompt
  const caution = o.kind === 'paused' && o.rule === 'perception'
  return {
    caution,
    open: true,
    kind: o.kind === 'rest' ? 'rest' : 'paused',
    title: RULE_TITLE[o.rule] ?? 'Paused',
    text: o.text || 'Counting is on hold. Nothing you completed is lost.',
    since: o.t ?? null,
    clock: 'event',
    primary: {
      label: o.kind === 'rest' ? 'Rested — continue' : 'Resume when ready',
      onClick: () => {
        send({ cmd: 'resume' })
        coach.clearOverlay()
      },
    },
    onEnd: () => finish(true, 'paused'),
    note: pausedNote(coach.decisions, o),
    prompt,
    resumeByPrompt: prompt && cp.prompt?.kind === 'resume',
  }
}

/** Seconds the hold has been open. Event clock: the newest event time minus the opening event's
 *  time, plus the whole seconds since that newest event arrived (frames may stop while paused),
 *  so the count is right after a re-render or remount. Wall clock: since the rest started. */
export function useHoldSeconds(hold: Pick<Hold, 'open' | 'since' | 'clock'>, eventNow: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  // whole seconds of wall time since the newest event arrived (reset when a new one does)
  const [ticks, setTicks] = useState({ t: eventNow, n: 0 })
  if (ticks.t !== eventNow) setTicks({ t: eventNow, n: 0 })
  useEffect(() => {
    if (!hold.open) return
    const id = setInterval(() => {
      setNow(Date.now())
      setTicks((p) => ({ ...p, n: p.n + 1 }))
    }, 1000)
    return () => clearInterval(id)
  }, [hold.open])
  if (!hold.open) return 0
  if (hold.clock === 'wall') return hold.since == null ? 0 : Math.max(0, Math.floor((now - hold.since) / 1000))
  if (hold.since == null || eventNow == null) return ticks.n
  return Math.max(0, Math.floor(eventNow - hold.since) + ticks.n)
}

const clock = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)

/** The hold dialog over the feed (inside `SxFeed` children). */
export function SxHold({
  open,
  kind,
  title,
  text,
  seconds,
  primary,
  onEnd,
  note = null,
  prompt = null,
  resumeByPrompt = false,
  caution = false,
}: {
  open: boolean
  kind: HoldKind
  title: string
  text: string
  seconds: number
  primary: { label: string; onClick: () => void }
  onEnd?: () => void
  note?: Note | null
  prompt?: ReactNode
  resumeByPrompt?: boolean
  caution?: boolean
}) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  // not modal (the control bar stays usable): focus moves in on open and back on close; a
  // caution takes no focus (nothing in it to press)
  useModalFocus(ref, open && !caution, { trap: false })
  if (!open) return null
  if (caution) {
    // Centered over the feed, without the scrim and click-through, so the patient sees
    // themselves while getting back in view. No Resume: the service resumes on its own.
    return (
      <div className="sx-hold-wrap pointer-events-none !bg-transparent" data-testid="tracking-caution">
        <div ref={ref} className="sx-hold" role="alert" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}>
          <div className="sx-hold-head">
            <h2 id={`${id}-t`}>{title}</h2>
            <span className="sx-hold-time" aria-label={`paused for ${seconds} seconds`}>{clock(seconds)}</span>
          </div>
          <p id={`${id}-d`}>{text}</p>
          <p className="sx-small">Counting is paused. It carries on by itself when you are back in view.</p>
          {prompt && <div className="sx-prompt pointer-events-auto">{prompt}</div>}
        </div>
      </div>
    )
  }
  return (
    <div className="sx-hold-wrap">
      <div ref={ref} className="sx-hold" role="alertdialog" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}>
        <div className="sx-hold-head">
          <h2 id={`${id}-t`}>{title}</h2>
          <span className="sx-hold-time" aria-label={`${kind === 'resting' ? 'resting' : 'paused'} for ${seconds} seconds`}>{clock(seconds)}</span>
        </div>
        <p id={`${id}-d`}>{text}</p>
        {note && (
          <div className="sx-card sx-coach">
            <div className="sx-kicker"><CoachLabel label={note.label} source={note.source} /></div>
            <p className="sx-coach-text">{note.text}</p>
          </div>
        )}
        {prompt && <div className="sx-prompt">{prompt}</div>}
        {!resumeByPrompt && (
          <button type="button" className="sx-btn sx-btn-primary sx-btn-wide" data-autofocus onClick={primary.onClick}>{primary.label}</button>
        )}
        {onEnd && <button type="button" className="sx-linkbtn sx-hold-end" onClick={onEnd}>End session instead</button>}
      </div>
    </div>
  )
}

/** The fixed control bar (CLAUDE.md §1: Take a rest · Pain / feel unwell · End session on every
 *  in-session screen), in the artifact's `.sx-btn` look. 21 Oct team review: the captions switch
 *  and the coach voice volume on the left; Show trace (Judge view only), Take a rest, Pain /
 *  feel unwell and End session on the right. There is no separate Pause: it did what Take a rest
 *  does (both pause the session on the service), so Take a rest is the one pause. Captions are
 *  locked on while the coach speaks (Audio on and volume above 0), so every spoken cue is
 *  shown as text. */
export function SxBar({
  onRest,
  onPain,
  onEnd,
  traceOpen,
  onTrace,
  captions,
  onCaptions,
  captionsLocked = false,
  volume,
  onVolume,
  resting = false,
}: {
  onRest: () => void
  onPain: () => void
  onEnd: () => void
  traceOpen: boolean
  onTrace: () => void
  captions: boolean
  onCaptions: () => void
  captionsLocked?: boolean
  volume: number
  onVolume: (v: number) => void
  resting?: boolean
}) {
  const vol = Math.round(volume * 100)
  const change = (e: ChangeEvent<HTMLInputElement>) => onVolume(Number(e.target.value) / 100)
  return (
    <footer className="sx-bar">
      <button
        type="button"
        role="switch"
        className="sx-switch"
        aria-checked={captions}
        aria-disabled={captionsLocked || undefined}
        aria-label="Captions"
        title={captionsLocked ? 'Captions stay on while the coach speaks' : captions ? 'Captions on' : 'Captions off'}
        onClick={() => !captionsLocked && onCaptions()}
      >
        <svg className="sx-cc-ic" viewBox="0 0 24 24" aria-hidden>
          <rect x={3} y={5} width={18} height={14} rx={3} />
          <path d="M10.5 10.2a2.2 2.2 0 1 0 0 3.6M16.5 10.2a2.2 2.2 0 1 0 0 3.6" />
        </svg>
        <span className="sx-switch-track" aria-hidden><span className="sx-switch-thumb" /></span>
      </button>
      <label className="sx-vol">
        <svg className="sx-vol-ic" viewBox="0 0 24 24" aria-hidden>
          <path d={vol === 0 ? 'M11 5 6 9H3v6h3l5 4V5Zm6 4 5 5m0-5-5 5' : vol < 50 ? 'M11 5 6 9H3v6h3l5 4V5Zm4.5 3.5a5 5 0 0 1 0 7' : 'M11 5 6 9H3v6h3l5 4V5Zm4.5 3.5a5 5 0 0 1 0 7m3-10a9 9 0 0 1 0 13'} />
        </svg>
        <input type="range" min={0} max={100} step={5} value={vol} onChange={change} aria-label="Coach voice volume" aria-valuetext={`${vol}%`} style={{ '--v': `${vol}%` } as CSSProperties} />
      </label>
      <button type="button" className="sx-linkbtn sx-trace-btn" aria-pressed={traceOpen} onClick={onTrace}>{traceOpen ? 'Hide trace' : 'Show trace'}</button>
      {/* ml-auto: the right-hand group stays right when Show trace is hidden (no Judge view) */}
      <span className="ml-auto flex flex-wrap items-center gap-3.5">
        <button type="button" className="sx-btn sx-btn-secondary" disabled={resting} onClick={onRest}>Take a rest</button>
        <button type="button" className="sx-btn sx-btn-danger" onClick={onPain}>Pain / feel unwell</button>
        <button type="button" className="sx-btn sx-btn-danger" onClick={onEnd}>End session</button>
      </span>
    </footer>
  )
}

const END_REASONS: [Exclude<EndReason, 'pain' | 'rest' | 'paused'>, string][] = [
  ['tired', 'Too tired to continue'],
  ['blocked', 'Something got in the way'],
  ['finished', 'Finished for today — no problem'],
]

/** "Ending the session": why, as radio reasons. Pain opens the pain check (the stop rule runs in
 *  the service); the others end with that reason. What the camera verified is saved either way. */
export function SxEndDialog({ open, done, noun, onPain, onEnd, onClose }: { open: boolean; done: number; noun: string; onPain: () => void; onEnd: (reason: Exclude<EndReason, 'pain' | 'rest' | 'paused'>) => void; onClose: () => void }) {
  const id = useId()
  const [pick, setPick] = useState<Exclude<EndReason, 'rest' | 'paused'> | null>(null)
  // the prescription's stop level, the one the service's pain stop rule uses
  const painMax = usePainStopLevel(open)
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) setPick(null)
  }
  const ref = useRef<HTMLDivElement>(null)
  useModalFocus(ref, open, { onEscape: onClose })
  if (!open) return null
  return (
    <div className="sx-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} className="sx-modal" role="dialog" aria-modal aria-labelledby={`${id}-t`}>
        <h2 id={`${id}-t`}>Ending the session</h2>
        <p className="sx-modal-sub">{`The ${done} ${plural(done, noun)} the camera verified so far ${done === 1 ? 'is' : 'are'} saved either way. Telling us why helps your therapist plan your next visit.`}</p>
        <div className="sx-reasons" role="radiogroup" aria-label="Why are you ending?" onKeyDown={arrowSelect}>
          <button type="button" role="radio" aria-checked={pick === 'pain'} className="sx-reason sx-reason-pain" onClick={() => setPick('pain')}>I have pain or feel unwell</button>
          {END_REASONS.map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={pick === k} className="sx-reason" onClick={() => setPick(k)}>{l}</button>
          ))}
        </div>
        <div className="sx-modal-foot">
          <p>{painMax != null ? `Pain of ${painMax} or more ends practice for today and flags your therapist.` : 'Pain at your stop level ends practice for today and flags your therapist.'}</p>
          <div className="sx-end-actions">
            <button type="button" className="sx-btn sx-btn-secondary" data-autofocus onClick={onClose}>Go back</button>
            <button type="button" className="sx-btn sx-btn-primary" disabled={!pick} onClick={() => (pick === 'pain' ? onPain() : pick && onEnd(pick))}>End session</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Event seconds as m:ss (the cup's session clock). */
export const sxClock = (t: number | null | undefined) => {
  const x = Math.max(0, Math.floor(t ?? 0))
  return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`
}

/** Per-screen session UI state: the coach voice (Settings > Audio, `prefs.audio`, on by
 *  default) and its volume (`praxis.volume`), captions (on; they cannot be switched off while the
 *  coach speaks, so every spoken cue is captioned) and the End dialog. */
export function useSxSession() {
  const [audio] = useState(() => readPrefs().audio)
  const [volume, setVol] = useState(() => coachVolume())
  const [panel, setPanel] = useState(true)
  const [endOpen, setEndOpen] = useState(false)
  const closeEnd = useCallback(() => setEndOpen(false), [])
  // leaving the screen silences any cue still queued
  useEffect(() => () => resetSpeech(), [])
  const speaking = audio && volume > 0
  return {
    /** Speak the coach's cues on this screen (pass to `useCoach` as `voice`). */
    audio: speaking,
    volume,
    setVolume: (v: number) => {
      setCoachVolume(v)
      setVol(coachVolume())
      if (v <= 0) resetSpeech()
    },
    captions: speaking || panel,
    captionsLocked: speaking,
    toggleCaptions: () => {
      if (!speaking) setPanel((c) => !c)
    },
    endOpen,
    openEnd: () => setEndOpen(true),
    closeEnd,
  }
}

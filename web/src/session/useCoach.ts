import { useEffect, useMemo, useRef, useState } from 'react'
import type { PraxisEvent } from '../lib/events'
import { coachLabel, coachSource, latestAgentStatus, promptKind, type CoachSource, type Prompt } from './agent'

export type { Prompt } from './agent'

export type CoachEvent = PraxisEvent & {
  action: string
  cue_id: string
  text: string
  reason: string
  evidence: number[]
  ui: { prompt?: Prompt; avatar_clip?: string; apply?: Record<string, unknown>; chip?: string }
  label: string
  /** Absent on events from before the agent coach: those are the rule coach. */
  source?: CoachSource
}
/** `id` is the event that opened the state (so a cue said during a pause can be told apart). */
export type Overlay = { kind: 'paused' | 'stopped' | 'rest'; rule: string; text: string; id?: number }
export type ExertionState = { level: 'low' | 'moderate' | 'high'; reasons: string[]; method: string }

export type SpeechPriority = 'instruct' | 'correct' | 'stop'
type Opts = { speak?: (text: string, priority: SpeechPriority) => void; voice?: boolean }

/** A coach caption stays on screen this long (in event time, from the newest frame) before
 *  the screen falls back to its state caption ("Hold… 2", "Place the cup on dot 1"). */
export const CAPTION_TTL_S = 4

function priorityOf(action: string): SpeechPriority {
  if (action === 'stop') return 'stop'
  if (action === 'correct' || action === 'rest' || action === 'regress') return 'correct'
  return 'instruct'
}

/** A resume, however it happened: the service's `resume` event, or an accepted `resume`
 *  command (the patient's own, or the agent's after the patient tapped Yes). */
function isResume(e: PraxisEvent): boolean {
  return e.type === 'resume' || (e.type === 'command' && e.cmd === 'resume' && e.ok !== false)
}

/** Consumes coach / stop-rule / exertion events: latest caption (spoken once), pending prompt,
 *  overlay state (paused | stopped | rest) and the exertion chip. */
export function useCoach(events: PraxisEvent[], opts: Opts = {}) {
  const spoken = useRef<Set<number>>(new Set())
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [resumedAfter, setResumedAfter] = useState(0)

  const coachEvents = useMemo(() => events.filter((e) => e.type === 'coach') as CoachEvent[], [events])
  const latest = coachEvents.length ? coachEvents[coachEvents.length - 1] : null
  const lastFrame = [...events].reverse().find((e) => e.type === 'frame')
  const caption = latest && (!lastFrame || lastFrame.t - latest.t <= CAPTION_TTL_S) ? latest : null

  useEffect(() => {
    for (const e of coachEvents) {
      if (spoken.current.has(e.id)) continue
      spoken.current.add(e.id)
      if (opts.voice !== false) opts.speak?.(e.text, priorityOf(e.action))
    }
  }, [coachEvents, opts])

  // A resume prompt is answered by the session resuming, whichever button did it.
  const resumedAt = events.reduce((m, e) => (isResume(e) ? Math.max(m, e.id) : m), 0)
  const promptEvent = [...coachEvents]
    .reverse()
    .find((e) => e.ui?.prompt && !dismissed.has(e.id) && !(promptKind(e.ui.prompt) === 'resume' && resumedAt > e.id))
  const prompt: (Prompt & { eventId: number }) | null = promptEvent
    ? { ...promptEvent.ui.prompt!, kind: promptKind(promptEvent.ui.prompt!), eventId: promptEvent.id }
    : null

  const overlay: Overlay | null = (() => {
    const stop = [...events].reverse().find((e) => e.type === 'stop')
    if (stop) return { kind: 'stopped', rule: String(stop.rule), text: String(stop.text ?? ''), id: stop.id }
    const last = [...events].reverse().find((e) => e.type === 'pause' || e.type === 'rest' || isResume(e))
    if (!last || last.id <= resumedAfter) return null
    if (isResume(last)) return null
    if (last.type === 'rest') return { kind: 'rest', rule: String(last.rule ?? 'exertion'), text: String(last.text ?? ''), id: last.id }
    return { kind: 'paused', rule: String(last.rule ?? 'patient'), text: String(last.text ?? ''), id: last.id }
  })()

  const exertionEvent = [...events].reverse().find((e) => e.type === 'exertion')
  const exertion: ExertionState | null = exertionEvent
    ? { level: exertionEvent.level as ExertionState['level'], reasons: (exertionEvent.reasons as string[]) ?? [], method: String(exertionEvent.method ?? 'behavioural') }
    : null

  const lastRule = [...coachEvents].reverse().find((e) => coachSource(e) === 'rule')

  return {
    caption,
    /** Which coach said the caption (legacy events without `source` are the rule coach). */
    captionSource: coachSource(caption),
    /** Label for the screen's own state captions: the rule coach's latest label. */
    ruleLabel: coachLabel(lastRule),
    agent: latestAgentStatus(events),
    prompt,
    dismissPrompt: () => promptEvent && setDismissed((s) => new Set(s).add(promptEvent.id)),
    overlay,
    clearOverlay: () => setResumedAfter(events.length ? Math.max(...events.map((e) => e.id)) : 0),
    exertion,
    decisions: coachEvents,
  }
}

/** Browser text-to-speech (Polly in W6). Cues queue instead of cancelling each other
 *  mid-word (audit A8); a correction drops queued instructions, a stop interrupts. */
const queue: { text: string; priority: SpeechPriority }[] = []
let speaking = false

function pump() {
  if (speaking) return
  const next = queue.shift()
  if (!next) return
  speaking = true
  const u = new SpeechSynthesisUtterance(next.text)
  u.rate = 1.0
  u.onend = u.onerror = () => {
    speaking = false
    pump()
  }
  window.speechSynthesis.speak(u)
}

export function resetSpeech() {
  queue.length = 0
  speaking = false
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* unsupported */
  }
}

export function browserSpeak(text: string, priority: SpeechPriority = 'instruct') {
  try {
    if (!('speechSynthesis' in window)) return
    if (priority !== 'instruct') {
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].priority === 'instruct') queue.splice(i, 1)
    }
    if (priority === 'stop') {
      window.speechSynthesis.cancel()
      speaking = false
    }
    queue.push({ text, priority })
    if (queue.length > 3) queue.splice(0, queue.length - 3) // stale cues are worse than silence
    pump()
  } catch {
    /* unsupported */
  }
}

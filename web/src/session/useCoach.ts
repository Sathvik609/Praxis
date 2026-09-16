import { useEffect, useMemo, useRef, useState } from 'react'
import type { PraxisEvent } from '../lib/events'

export type CoachEvent = PraxisEvent & {
  action: string
  cue_id: string
  text: string
  reason: string
  evidence: number[]
  ui: { prompt?: Prompt; avatar_clip?: string; apply?: Record<string, unknown>; chip?: string }
  label: string
}
export type Prompt = { id: string; title: string; text: string; options: string[]; within_prescription?: boolean }
export type Overlay = { kind: 'paused' | 'stopped' | 'rest'; rule: string; text: string }
export type ExertionState = { level: 'low' | 'moderate' | 'high'; reasons: string[]; method: string }

type Opts = { speak?: (text: string) => void; voice?: boolean }

/** Consumes coach / stop-rule / exertion events: latest caption (spoken once), pending prompt,
 *  overlay state (paused | stopped | rest) and the exertion chip. */
export function useCoach(events: PraxisEvent[], opts: Opts = {}) {
  const spoken = useRef<Set<number>>(new Set())
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [resumedAfter, setResumedAfter] = useState(0)

  const coachEvents = useMemo(() => events.filter((e) => e.type === 'coach') as CoachEvent[], [events])
  const caption = coachEvents.length ? coachEvents[coachEvents.length - 1] : null

  useEffect(() => {
    for (const e of coachEvents) {
      if (spoken.current.has(e.id)) continue
      spoken.current.add(e.id)
      if (opts.voice !== false) opts.speak?.(e.text)
    }
  }, [coachEvents, opts])

  const promptEvent = [...coachEvents].reverse().find((e) => e.ui?.prompt && !dismissed.has(e.id))
  const prompt: (Prompt & { eventId: number }) | null = promptEvent ? { ...promptEvent.ui.prompt!, eventId: promptEvent.id } : null

  const overlay: Overlay | null = (() => {
    const stop = [...events].reverse().find((e) => e.type === 'stop')
    if (stop) return { kind: 'stopped', rule: String(stop.rule), text: String(stop.text ?? '') }
    const last = [...events].reverse().find((e) => e.type === 'pause' || e.type === 'resume' || e.type === 'rest')
    if (!last || last.id <= resumedAfter) return null
    if (last.type === 'resume') return null
    if (last.type === 'rest') return { kind: 'rest', rule: String(last.rule ?? 'exertion'), text: String(last.text ?? '') }
    return { kind: 'paused', rule: String(last.rule ?? 'patient'), text: String(last.text ?? '') }
  })()

  const exertionEvent = [...events].reverse().find((e) => e.type === 'exertion')
  const exertion: ExertionState | null = exertionEvent
    ? { level: exertionEvent.level as ExertionState['level'], reasons: (exertionEvent.reasons as string[]) ?? [], method: String(exertionEvent.method ?? 'behavioural') }
    : null

  return {
    caption,
    prompt,
    dismissPrompt: () => promptEvent && setDismissed((s) => new Set(s).add(promptEvent.id)),
    overlay,
    clearOverlay: () => setResumedAfter(events.length ? Math.max(...events.map((e) => e.id)) : 0),
    exertion,
    decisions: coachEvents,
  }
}

/** Browser text-to-speech (Polly in W6). Safe no-op where unsupported. */
export function browserSpeak(text: string) {
  try {
    if (!('speechSynthesis' in window)) return
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 0.95
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  } catch {
    /* unsupported */
  }
}

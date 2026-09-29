import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Chip } from '../../design/Chip'
import { Activity, Bot, ListChecks } from '../../design/Icon'
import { NumberScale } from '../../design/NumberScale'
import { Overlay } from '../../design/Overlay'
import { REST_AT } from '../../lib/plan'
import type { CoachSource } from '../../session/agent'
import type { ExertionState, Overlay as OverlayState } from '../../session/useCoach'

const RULE_TITLE: Record<string, string> = {
  perception: 'Tracking lost',
  lean: 'Paused · posture',
  failed_reps: 'Paused · let’s check the setup',
  patient: 'Paused',
  pain: 'Session ended · pain at stop level',
  symptoms: 'Session ended · new symptoms',
  exertion: 'Rest break',
}

/** In-session states from wireframe 08b: frozen session behind a high-contrast panel. The
 *  stop rule already ran in the service; this only explains it and offers the next step.
 *  While paused, `note` is the coach cue said during the pause (the setup-recovery
 *  instruction, captioned here because the modal hides the coach card) and `prompt` an open
 *  coach prompt; with `resumeByPrompt` the prompt's Yes is the resume, so the overlay does not
 *  offer a second Resume. */
export function SessionOverlay({
  overlay,
  onResume,
  onEnd,
  note = null,
  prompt = null,
  resumeByPrompt = false,
}: {
  overlay: OverlayState | null
  onResume: () => void
  onEnd: () => void
  note?: { text: string; label: string; source: CoachSource } | null
  prompt?: ReactNode
  resumeByPrompt?: boolean
}) {
  if (!overlay) return null
  const title = RULE_TITLE[overlay.rule] ?? (overlay.kind === 'stopped' ? 'Session ended' : 'Paused')
  return (
    <Overlay open title={title}>
      <p className="mt-3 text-2xl">{overlay.text}</p>
      {overlay.kind === 'stopped' ? (
        <>
          <p className="mt-2 text-muted">Your progress so far is saved. Your therapist is flagged and will see this session.</p>
          <div className="mt-6 flex justify-end"><Button onClick={onEnd}>Save and continue</Button></div>
        </>
      ) : (
        <>
          {note && (
            <Card tone="coach" className="mt-4">
              <p className="text-2xl">{note.text}</p>
              <div data-source={note.source} className="mt-2 flex items-center gap-2 text-lg text-muted">
                {note.source === 'agent' ? <Bot aria-hidden className="h-5 w-5 shrink-0" /> : <ListChecks aria-hidden className="h-5 w-5 shrink-0" />}
                <span>{note.label}</span>
              </div>
            </Card>
          )}
          {prompt && <div className="mt-4">{prompt}</div>}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={onEnd}>End session</Button>
            {!resumeByPrompt && <Button onClick={onResume}>{overlay.kind === 'rest' ? 'Rested — continue' : 'Resume'}</Button>}
          </div>
        </>
      )}
    </Overlay>
  )
}

/** "Take a rest" (patient-chosen): a timer counting the rest up, then continue or end. The
 *  service-imposed rest (exertion rule) keeps using SessionOverlay's "Rest break". */
export function RestOverlay({ since, onResume, onEnd }: { since: number | null; onResume: () => void; onEnd: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (since == null) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [since])
  if (since == null) return null
  const s = Math.max(0, Math.floor((now - since) / 1000))
  return (
    <Overlay open title="Resting" description="The session is paused while you rest.">
      <p className="mt-3 text-2xl">Rest as long as you need. About a minute is usually enough.</p>
      <p className="mt-4 font-heading text-6xl font-semibold tabular-nums" aria-live="off">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</p>
      <p className="mt-1 text-lg text-muted">resting · the camera is not counting</p>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onEnd}>End session</Button>
        <Button onClick={onResume}>Rested — continue</Button>
      </div>
    </Overlay>
  )
}

/** "I'm in pain": 0–10 pain check; the stop rule runs in the service, never here. The copy
 *  quotes the locked stop level (CLAUDE.md §1: pain ≥ 7), the same number the plan uses. */
export function PainCheck({ open, onSubmit, onCancel }: { open: boolean; onSubmit: (pain: number) => void; onCancel: () => void }) {
  const [pain, setPain] = useState<number | null>(null)
  if (!open) return null
  return (
    <Overlay open title="How is the pain right now?">
      <p className="mt-2 text-muted">Pain at or above {REST_AT} ends the session and flags your therapist. Take your time.</p>
      <div className="mt-5"><NumberScale label="Pain right now" value={pain} onChange={setPain} leftAnchor="No pain" rightAnchor="Worst imaginable" /></div>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>Back to session</Button>
        <Button disabled={pain === null} onClick={() => pain !== null && onSubmit(pain)}>Send to coach</Button>
      </div>
    </Overlay>
  )
}

/** Exertion context chip (CLAUDE.md §1): behavioural index level with its reasons. The word
 *  carries the level; the tone only echoes it. */
export function ExertionChip({ exertion }: { exertion: ExertionState | null }) {
  const level = exertion?.level ?? 'low'
  const tone = level === 'high' ? 'red' : level === 'moderate' ? 'amber' : 'mint'
  return (
    <Card padding="sm" className="flex flex-wrap items-center gap-3">
      <Chip tone={tone} icon={<Activity />}>Exertion: {level}</Chip>
      <span className="text-lg text-muted">behavioural index{exertion?.reasons.length ? ` · ${exertion.reasons.join(' · ')}` : ' · no signs yet'}</span>
    </Card>
  )
}

import { useState, type ReactNode } from 'react'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Chip } from '../../design/Chip'
import { Activity, Bot, ListChecks } from '../../design/Icon'
import { NumberScale } from '../../design/NumberScale'
import { Overlay } from '../../design/Overlay'
import { usePainStopLevel } from '../../lib/api'
import type { CoachSource } from '../../session/agent'
import type { ExertionState, Overlay as OverlayState } from '../../session/useCoach'
import type { EndReason, StopEnd } from '../../session/useSessionFlow'

/** Title of the hold / overlay per stop rule (shared with the session chrome's `sxHold`). */
export const RULE_TITLE: Record<string, string> = {
  perception: 'Tracking lost',
  lean: 'Paused · posture',
  failed_reps: 'Paused · let’s check the setup',
  setup: 'Paused · check your position',
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
    <Overlay open title={title} alert={overlay.kind === 'stopped' || overlay.rule === 'perception'}>
      <p className="mt-3 text-2xl">{overlay.text}</p>
      {overlay.kind === 'stopped' ? (
        // The service's stop text is the one statement: it writes the therapist flag with the
        // stop and says so, so no fixed line repeats it (10 Oct walkthrough).
        <div className="mt-6 flex justify-end"><Button onClick={onEnd}>Save and continue</Button></div>
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

/** The end reason for ending from an overlay: the stop rule that ended the session
 *  (`stop:<rule>`), or the rest / pause it was ended from. */
export function overlayEndReason(o: OverlayState | null): EndReason | StopEnd {
  if (o?.kind === 'rest') return 'rest'
  if (o?.kind === 'paused') return 'paused'
  return `stop:${o?.rule || 'unknown'}`
}

/** "I'm in pain": 0–10 pain check; the stop rule runs in the service, never here. The copy
 *  quotes the prescription's stop level (`stop_rules.pain_max`, the level that rule uses), or
 *  names the stop level without a number until the prescription is known. */
export function PainCheck({ open, onSubmit, onCancel }: { open: boolean; onSubmit: (pain: number) => void; onCancel: () => void }) {
  const [pain, setPain] = useState<number | null>(null)
  const painMax = usePainStopLevel(open)
  if (!open) return null
  return (
    // Escape = Back to session; a stray tap on the backdrop does not dismiss it
    <Overlay open title="How is the pain right now?" onClose={onCancel} backdropCloses={false}>
      <p className="mt-2 text-muted">Pain at or above {painMax ?? 'your stop level'} ends the session and flags your therapist. Take your time.</p>
      <div className="mt-5"><NumberScale label="Pain right now" value={pain} onChange={setPain} leftAnchor="No pain" rightAnchor="Worst imaginable" /></div>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>Back to session</Button>
        <Button disabled={pain === null} onClick={() => pain !== null && onSubmit(pain)}>Send to coach</Button>
      </div>
    </Overlay>
  )
}

/** Exertion context chip (CLAUDE.md §1): behavioural index level with its reasons. The word
 *  carries the level; the tone only echoes it. `compact` is the one-line form for the session
 *  stats card (`SxStats.extra`, ruling R7), in the artifact's own `sx-chip` / `sx-small` classes. */
export function ExertionChip({ exertion, compact = false }: { exertion: ExertionState | null; compact?: boolean }) {
  const level = exertion?.level ?? 'low'
  const tone = level === 'high' ? 'red' : level === 'moderate' ? 'amber' : 'mint'
  const reasons = `behavioural index${exertion?.reasons.length ? ` · ${exertion.reasons.join(' · ')}` : ' · no signs yet'}`
  if (compact) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className={`sx-chip sx-chip-${tone}`}><span aria-hidden className="sx-chip-ic"><Activity /></span>Exertion: {level}</span>
        <span className="sx-small">{reasons}</span>
      </div>
    )
  }
  return (
    <Card padding="sm" className="flex flex-wrap items-center gap-3">
      <Chip tone={tone} icon={<Activity />}>Exertion: {level}</Chip>
      <span className="text-lg text-muted">{reasons}</span>
    </Card>
  )
}

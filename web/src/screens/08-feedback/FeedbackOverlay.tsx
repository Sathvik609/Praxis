import * as Dialog from '@radix-ui/react-dialog'
import { useId, useState, type KeyboardEvent } from 'react'
import { Button } from '../../design/Button'
import { TextArea } from '../../design/Field'
import { api, useApi, type Feedback } from '../../lib/api'
import { readCheckinPain } from '../../lib/plan'

export type { Feedback } from '../../lib/api'

type Difficulty = NonNullable<Feedback['difficulty']>
type Again = NonNullable<Feedback['again_tomorrow']>
type Option<T extends string> = { value: T; label: string; sub: string; effort?: number }

const FB_FACES = [
  { at: 0, tone: 'ok', mouth: 'M9 15.2c1.6 1.8 4.4 1.8 6 0' },
  { at: 2.5, tone: 'ok2', mouth: 'M9.4 15c1.4 1 3.8 1 5.2 0' },
  { at: 5, tone: 'mid', mouth: 'M9.2 15h5.6' },
  { at: 7.5, tone: 'warn', mouth: 'M9.4 15.8c1.4-1 3.8-1 5.2 0' },
  { at: 10, tone: 'bad', mouth: 'M9 16.4c1.6-1.8 4.4-1.8 6 0' },
]
const FB_DIFFICULTY: Option<Difficulty>[] = [
  { value: 'too_easy', label: 'Too easy', sub: 'I could have done more', effort: 2 },
  { value: 'just_right', label: 'Just right', sub: 'Worked, but I finished it', effort: 4 },
  { value: 'hard', label: 'Hard', sub: 'I got through it, but only just', effort: 7 },
  { value: 'couldnt_finish', label: "I couldn't finish", sub: 'I had to stop or skip part of it', effort: 9 },
]
const FB_AGAIN: Option<Again>[] = [
  { value: 'yes_easily', label: 'Yes, easily', sub: 'Same again, no problem' },
  { value: 'yes_probably', label: 'Yes, probably', sub: "I'd manage it" },
  { value: 'not_sure', label: 'Not sure', sub: 'Depends how I feel' },
  { value: 'no', label: 'No', sub: "I'd need to rest first" },
]
const FB_BARRIERS = [
  { value: 'tired', label: 'Too tired' },
  { value: 'pain', label: 'Pain or discomfort' },
  { value: 'weak', label: 'Arm felt weak' },
  { value: 'unsteady', label: 'Lost my balance / felt unsteady' },
  { value: 'camera', label: "Couldn't set the camera up" },
  { value: 'time', label: 'Ran out of time' },
  { value: 'interrupted', label: 'Someone needed me' },
  { value: 'equipment', label: 'Equipment missing' },
]
const TITLES = ['How much pain, right now?', 'How hard was that?', 'Could you do this again tomorrow?', 'What got in the way?']

/** Decorative faces that echo the number the patient tapped; nothing is read from a face. */
function FbFace({ face, active, dim }: { face: (typeof FB_FACES)[number]; active: boolean; dim: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={`fb-face fb-face-${face.tone} ${active ? 'fb-face-on' : ''} ${dim ? 'fb-face-dim' : ''}`}
      style={{ gridColumn: face.at % 1 ? `${Math.floor(face.at) + 1} / span 2` : `${face.at + 1}` }}
    >
      <circle cx={12} cy={12} r={10.5} />
      <circle className="fb-eye" cx={9} cy={10} r={0.9} />
      <circle className="fb-eye" cx={15} cy={10} r={0.9} />
      <path d={face.mouth} />
    </svg>
  )
}

function FbChoices<T extends string>({ label, options, value, onChange }: { label: string; options: Option<T>[]; value: T | null; onChange: (v: T | null) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="fb-choices">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className="fb-choice" onClick={() => onChange(value === o.value ? null : o.value)}>
          <b>{o.label}</b>
          <span>{o.sub}</span>
          {o.effort != null && (
            <em className="fb-eff">
              <span aria-hidden>{`${o.effort}/10`}</span>
              <span className="sr-only">{`effort ${o.effort}/10 (from your answer)`}</span>
            </em>
          )}
        </button>
      ))}
    </div>
  )
}

/** Screen 08 · Post-session feedback (design v2, 6 Oct: the designers' one-question-per-step
 *  dialog, live J65659–65772). Pain now (0–10, with today's check-in pain for comparison), how
 *  hard it was (the effort number is derived from the choice and says so), whether it could be
 *  done again tomorrow, and — when the session ended early — what got in the way. An optional
 *  note on the last step travels as `detail`. Unanswered questions are left out, never zero.
 *
 *  Pain at or above the prescription's stop level (`stop_rules.pain_max`) says the therapist
 *  will be flagged: the service writes that `pain_after` flag on the same rule. When the
 *  prescription cannot be read the line is not shown.
 *
 *  `reportedPain` (10 Oct) is the patient's last Pain / feel unwell answer of this session: the
 *  pain step opens with it selected (still editable) instead of asking from nothing. */
export function FeedbackOverlay({ open, early = false, reportedPain = null, onSave, onSkip }: { open: boolean; early?: boolean; reportedPain?: number | null; onSave: (f: Feedback) => void; onSkip: () => void }) {
  const [step, setStep] = useState(0)
  const [pain, setPain] = useState<number | null>(reportedPain)
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null)
  const [again, setAgain] = useState<Again | null>(null)
  const [barriers, setBarriers] = useState<string[]>([])
  const [noteOpen, setNoteOpen] = useState(false)
  const [detail, setDetail] = useState('')
  const [before, setBefore] = useState(readCheckinPain)
  // Each time the dialog opens: back to the first question, today's check-in pain re-read.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setStep(0)
      setBefore(readCheckinPain())
      if (reportedPain != null) setPain(reportedPain)
    }
  }
  // Read the stop level only while the dialog is open (the report keeps it mounted closed).
  const { data: rx } = useApi(() => (open ? api.prescription() : Promise.resolve(null)), [open])
  const painMax = rx?.stop_rules?.pain_max
  const eyebrowId = useId()

  const steps = early ? 4 : 3
  const last = step === steps - 1
  const save = () => {
    const f: Feedback = { ended_early: !!early }
    if (pain !== null) f.pain_after = pain
    if (difficulty) {
      f.difficulty = difficulty
      const effort = FB_DIFFICULTY.find((o) => o.value === difficulty)?.effort
      if (effort != null) f.effort = effort
    }
    if (again) f.again_tomorrow = again
    if (early && barriers.length) f.barriers = barriers
    const note = detail.trim()
    if (note) f.detail = note
    onSave(f)
  }
  const nearest = pain == null ? -1 : FB_FACES.reduce((k, f, i) => (Math.abs(f.at - pain) < Math.abs(FB_FACES[k].at - pain) ? i : k), 0)
  const delta = pain != null && before != null ? pain - before : null
  const deltaTxt = delta == null ? null : delta === 0 ? 'Same' : delta > 0 ? `Up ${delta}` : `Down ${-delta}`
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, n: number) => {
    let nextN: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextN = Math.min(10, n + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextN = Math.max(0, n - 1)
    if (nextN == null) return
    e.preventDefault()
    setPain(nextN)
    ;(e.currentTarget.parentElement?.children[nextN] as HTMLElement | undefined)?.focus()
  }

  const note = last && (
    <div className="mt-4">
      {noteOpen ? (
        <TextArea label="A note for your therapist (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} />
      ) : (
        <Button variant="link" onClick={() => setNoteOpen(true)}>
          Add a note for your therapist (optional)
        </Button>
      )}
    </div>
  )

  const body =
    step === 0 ? (
      <div className="fb-pain">
        <div className="fb-faces" aria-hidden>
          {FB_FACES.map((f, i) => (
            <FbFace key={i} face={f} active={i === nearest} dim={nearest >= 0 && i !== nearest} />
          ))}
        </div>
        <div role="radiogroup" aria-label="Pain right now, 0 to 10" className="fb-scale">
          {Array.from({ length: 11 }, (_, n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={pain === n}
              aria-label={String(n)}
              tabIndex={(pain ?? 0) === n ? 0 : -1}
              className="fb-num"
              onClick={() => setPain(n)}
              onKeyDown={(e) => onKey(e, n)}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="fb-anchors">
          <span>No pain</span>
          <span>Worst imaginable</span>
        </div>
        {deltaTxt && (
          <div className={`fb-compare ${delta! > 0 ? 'fb-compare-up' : ''}`} role="status">
            <span>
              Before you started: <b>{before}</b>
            </span>
            <span className="fb-delta">{deltaTxt}</span>
          </div>
        )}
        {reportedPain != null && <p className="fb-sub">{`You told us ${reportedPain} during the session. Change it if it has changed.`}</p>}
        {pain != null && painMax != null && pain >= painMax && <p className="fb-alert">Your therapist will be flagged.</p>}
      </div>
    ) : step === 1 ? (
      <FbChoices label={TITLES[1]} options={FB_DIFFICULTY} value={difficulty} onChange={setDifficulty} />
    ) : step === 2 ? (
      <FbChoices label={TITLES[2]} options={FB_AGAIN} value={again} onChange={setAgain} />
    ) : (
      <div role="group" aria-label={TITLES[3]} className="fb-barriers">
        {FB_BARRIERS.map((b) => (
          <button
            key={b.value}
            type="button"
            aria-pressed={barriers.includes(b.value)}
            className="fb-choice fb-choice-sm"
            onClick={() => setBarriers((l) => (l.includes(b.value) ? l.filter((x) => x !== b.value) : [...l, b.value]))}
          >
            <b>{b.label}</b>
          </button>
        ))}
      </div>
    )

  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fb-scrim fixed inset-0 z-40" />
        <Dialog.Content className="fb-dialog" aria-labelledby={eyebrowId} onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
          <div className="fb-top">
            <span id={eyebrowId} className="fb-eyebrow">
              How was your practice?
            </span>
            <span className="fb-progress">
              <span className="fb-dots" aria-hidden>
                {Array.from({ length: steps }, (_, i) => (
                  <i key={i} className={i === step ? 'fb-dot-on' : i < step ? 'fb-dot-done' : ''} />
                ))}
              </span>
              {`${step + 1} of ${steps}`}
            </span>
          </div>
          <Dialog.Title className="fb-title">{TITLES[step]}</Dialog.Title>
          <Dialog.Description className={step === 0 ? 'fb-sub' : 'sr-only'}>
            {step === 0 ? 'Tap a number. Some ache after practice is normal.' : early && step === 3 ? 'Pick as many as apply.' : 'Choose one, or go on without answering.'}
          </Dialog.Description>
          <div key={step} className="fb-body">
            {body}
            {note}
          </div>
          <div className="fb-actions">
            {step === 0 ? (
              <Button variant="secondary" onClick={onSkip}>
                Skip
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
            <Button onClick={last ? save : () => setStep(step + 1)}>{last ? 'Save and see report' : 'Next'}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

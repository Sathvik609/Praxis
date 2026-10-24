import { useEffect, useId, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { FlowBar } from '../../app/FlowBar'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Chip, type ChipTone } from '../../design/Chip'
import { NumberScale } from '../../design/NumberScale'
import { Pill } from '../../design/Pill'
import { api, useApi } from '../../lib/api'
import { demoUrl, readDay, readSide, saveCheckin, setupUrl, sideOr, stopReason, syncCheckin, therapistLine, type CheckinAnswers, type Day, type Side } from '../../lib/day'
import { DAY_MINUTES, TIER_TEXT, tierFor, type Tier } from '../../lib/plan'
import { exerciseById, type ExerciseId } from '../../lib/seed'

/** Kept for older imports: what screen 03 collects. */
export type CheckInData = CheckinAnswers

type Location = 'shoulder' | 'arm' | 'hand' | 'nowhere'
type Energy = 'comfortable' | 'tired' | 'very_tired'
type Minutes = '14' | '7'

const LOCATIONS: { value: Location; label: string }[] = [
  { value: 'shoulder', label: 'Shoulder' },
  { value: 'arm', label: 'Arm' },
  { value: 'hand', label: 'Hand' },
  { value: 'nowhere', label: 'Nowhere' },
]
const ENERGY: { value: Energy; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'tired', label: 'Tired' },
  { value: 'very_tired', label: 'Very tired' },
]
const MINUTES: { value: Minutes; label: string }[] = [
  { value: '14', label: `Full session · about ${DAY_MINUTES} min` }, // same figure as Home
  { value: '7', label: 'Shorter · one exercise' },
]
const SIDES: { value: Side; label: string }[] = [
  { value: 'left', label: 'Left arm' },
  { value: 'right', label: 'Right arm' },
]
const TIER_TONE: Record<Tier, ChipTone> = { full: 'mint', gentle: 'amber', rest: 'red' }

/** Screen 03 · Pre-session check-in, once a day. Feeling is self-reported, never read from the
 *  face. Stop rules are shown from the prescription, not inferred. Every answer is a tap (21 Oct
 *  team review: no push to talk, and no "something new or worse" box: pausing or ending the
 *  session with Pain / feel unwell covers it, so the check-in posts `new_symptoms: false`). Pain
 *  starts unselected; Continue stays disabled with a visible hint until a number (and, the first
 *  time, the practising side) is chosen.
 *
 *  The check-in goes to the service (`POST /api/checkin`, `lib/day.ts`), which sets the tier
 *  and writes the therapist flag. Pain at the stop level ends the day here, before any setup or
 *  demonstration (a day an older build stopped for new symptoms still shows as stopped). "Your therapist has been told" appears only when
 *  the service says it flagged; offline, the check-in is kept on this device and posted again
 *  on the next load. A second visit the same day reuses today's answers (one tap to go on).
 *  `?next=<exercise>` is the demonstration's hand-off (design v2, 6 Oct: Choose → Demonstration
 *  → Check-in → Camera setup): with a valid check-in today it goes straight to that exercise's
 *  camera setup without asking again; otherwise the form ends in "Continue to camera setup" and
 *  Back returns to the demonstration. `&rehearse=1` is passed through to setup. */
export function CheckIn() {
  const nav = useNavigate()
  const [sp] = useSearchParams()
  const nextEx = exerciseById(sp.get('next'))
  const nextCoached = nextEx && nextEx.mode === 'coached' ? nextEx : undefined
  const { data: rx } = useApi(() => api.prescription())
  const [day, setDay] = useState<Day>(readDay)
  const [again, setAgain] = useState(false)

  useEffect(() => {
    let alive = true
    void syncCheckin().then(() => alive && setDay(readDay()))
    return () => {
      alive = false
    }
  }, [])

  const rehearse = sp.get('rehearse') === '1'
  const continueLabel = nextCoached ? 'Continue to camera setup' : 'Continue to exercises'
  const nextUrl = (id: ExerciseId, side: Side) => `${setupUrl(id, side)}${rehearse ? '&rehearse=1' : ''}`
  const goOn = (side: Side) => nav(nextCoached ? nextUrl(nextCoached.id, side) : '/details/choose')
  const c = day.checkin
  const goBack = () => nav(nextCoached ? demoUrl(nextCoached.id, sideOr(sp.get('side') ?? c?.side)) : '/details')
  const backLabel = nextCoached ? 'Back to demonstration' : 'Back to Home'

  if (c && day.stopped && !again) {
    return <Stopped day={day} painMax={rx?.stop_rules?.pain_max} onHome={() => nav('/details')} onAgain={() => setAgain(true)} />
  }
  // Demo hand-off: today's answers stand, so setup follows without asking again (D-FLOW).
  if (c && !again && nextCoached) return <Navigate replace to={nextUrl(nextCoached.id, c.side)} />
  if (c && !again) {
    return (
      <div className="flex min-h-full flex-col">
        <div className="mx-auto w-full max-w-3xl flex-1 p-6">
          <h1 className="text-4xl">You checked in today</h1>
          <Card className="mt-5 space-y-3">
            <p className="flex flex-wrap items-center gap-3 text-xl">
              <span>Pain {c.pain}</span>
              <Chip tone={TIER_TONE[c.tier]}>{TIER_TEXT[c.tier].chip}</Chip>
            </p>
            <p className="text-lg">Practising side: {c.side} arm · {c.minutes < 14 ? 'shorter day, one exercise' : 'full day'}</p>
            {!c.synced && <p className="text-lg text-muted">{therapistLine(c)}</p>}
          </Card>
          <p className="mt-4 text-lg text-muted">If your pain has changed since, check in again. Today's plan follows your latest answer.</p>
        </div>
        <FlowBar
          step={2}
          label="Pre-session check-in"
          left={
            <>
              <Button variant="secondary" onClick={goBack}>{backLabel}</Button>
              <Button variant="secondary" onClick={() => setAgain(true)}>Check in again</Button>
            </>
          }
          right={<Button onClick={() => goOn(c.side)}>{continueLabel}</Button>}
        />
      </div>
    )
  }
  return (
    <CheckInForm
      painMax={rx?.stop_rules?.pain_max}
      clinician={rx?.clinician?.split(',')[0] ?? 'your therapist'}
      continueLabel={continueLabel}
      readyLabel={nextCoached ? 'Ready for camera setup' : 'Ready to choose an exercise'}
      onBack={goBack}
      backLabel={backLabel}
      onSaved={(side) => {
        const d = readDay()
        setDay(d)
        setAgain(false)
        if (!d.stopped) goOn(side ?? d.checkin?.side ?? 'left')
      }}
    />
  )
}

/** The day ends at check-in: new or worse symptoms, pain at the stop level, or a stop rule
 *  earlier today. Extends screen 03 (no frame in wireframes v1.1; docs/PLAN.md). */
function Stopped({ day, painMax, onHome, onAgain }: { day: Day; painMax?: number; onHome: () => void; onAgain: () => void }) {
  const c = day.checkin!
  const stop = day.stopped
  const title = stop === 'rest' ? 'Rest today' : stop === 'session' ? 'Stopped for today' : 'No exercises today'
  const body =
    stop === 'new_symptoms'
      ? "You told us something is new or worse. Rest the arm, and don't practise until your therapist has looked at it."
      : stop === 'rest'
        ? `Pain ${c.pain} is at or above your stop level of ${Math.min(7, painMax ?? 7)}. Rest the arm today.`
        : "A stop rule ended today's practice. Rest the arm today."
  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-3xl flex-1 p-6">
        <Card tone="watch" as="div" className="space-y-3">
          <h1 className="text-4xl">{title}</h1>
          <p className="text-xl">{body}</p>
          {stop !== 'session' && <p className="text-xl">{therapistLine(c)}</p>}
          <p className="text-lg text-muted">If it feels urgent, call your care team.</p>
        </Card>
        {stop === 'rest' && <p className="mt-4 text-lg text-muted">Pain can settle. If it has, you can check in again later today.</p>}
      </div>
      <FlowBar
        step={2}
        label="Pre-session check-in"
        left={stop === 'rest' ? <Button variant="secondary" onClick={onAgain}>Check in again</Button> : undefined}
        right={<Button onClick={onHome}>Back to Home</Button>}
      />
    </div>
  )
}

function CheckInForm({ painMax, clinician, continueLabel, readyLabel, onBack, backLabel, onSaved }: { painMax?: number; clinician: string; continueLabel: string; readyLabel: string; onBack: () => void; backLabel: string; onSaved: (side: Side | null) => void }) {
  const hintId = useId()
  const [pain, setPain] = useState<number | null>(null)
  const [side, setSide] = useState<Side | null>(() => readSide())
  const [askSide, setAskSide] = useState(() => readSide() === null)
  // No body area is preselected (review 28 Sep): the patient chooses one, or Nowhere.
  const [location, setLocation] = useState<Location | null>(null)
  const [energy, setEnergy] = useState<Energy>('comfortable')
  const [minutes, setMinutes] = useState<Minutes>('14')
  const [busy, setBusy] = useState(false)

  const stopping = pain != null && stopReason({ pain, new_symptoms: false, tier: tierFor(pain, painMax) }) === 'rest'
  const label = stopping ? 'Rest today and tell my therapist' : continueLabel
  // The side is only needed to practise; a day that stops here does not ask for it. Where it
  // hurts is asked only when there is pain (pain 0 is saved as nowhere) and never blocks a stop.
  const hint =
    pain === null
      ? 'Choose a pain number to continue'
      : side === null && !stopping
        ? 'Choose the arm you are practising to continue'
        : pain > 0 && location === null && !stopping
          ? 'Choose where it hurts, or Nowhere, to continue'
          : null

  const go = async () => {
    if (pain === null) return
    setBusy(true)
    try {
      await saveCheckin({ pain, location: location ?? (pain === 0 ? 'nowhere' : 'not said'), energy, minutes: Number(minutes), new_symptoms: false }, side, painMax)
    } finally {
      setBusy(false)
    }
    onSaved(side)
  }

  const stopAt = Math.min(7, painMax ?? 7)
  const gentle = stopAt - 1 > 4 ? `4–${stopAt - 1}` : '4'

  // 24 Oct: what the pain number does sits under the scale itself, one band per tier, so the
  // patient sees the effect while choosing (it was a side card).
  const fullTo = 3
  const tierOf = (n: number) => (n >= stopAt ? 'rest' : n > fullTo ? 'gentle' : 'full')
  const bands = [
    { tier: 'full', span: fullTo + 1, label: `0–${fullTo} · Full session` },
    { tier: 'gentle', span: stopAt - fullTo - 1, label: `${gentle} · Lighter session` },
    { tier: 'rest', span: 11 - stopAt, label: `${stopAt}–10 · Rest today` },
  ].filter((b) => b.span > 0)
  const picked = pain == null ? null : tierOf(pain)
  const meaning =
    pain == null
      ? null
      : picked === 'rest'
        ? `Pain ${pain}: rest today, and ${clinician} is told.`
        : picked === 'gentle'
          ? `Pain ${pain}: a lighter session today, with fewer reps and a smaller lift.`
          : `Pain ${pain}: your full session today.`

  return (
    <div className="ci-form flex min-h-full flex-col">
      <div className="flex-1 p-6">
        <h1 className="text-4xl">Before you start</h1>
        <p className="mt-2 text-muted">A few quick taps. Your answers set today's pace.</p>
        <Card className="mt-5 space-y-6">
          <div className="ci-pain">
            <NumberScale label="Pain right now" value={pain} onChange={setPain} leftAnchor="No pain" rightAnchor="Worst imaginable" />
            <div className="ci-bands" aria-hidden>
              {bands.map((b) => (
                <span key={b.tier} className={`ci-band ci-band-${b.tier}${picked === b.tier ? ' ci-band-on' : ''}`} style={{ gridColumn: `span ${b.span}` }}>
                  {b.label}
                </span>
              ))}
            </div>
            <p className={`ci-meaning${picked ? ` ci-meaning-${picked}` : ''}`} role="status">
              {meaning ?? 'Tap the number closest to how you feel now.'}
            </p>
          </div>
          {/* asked only once there is pain to place (pain 0 is saved as nowhere) */}
          {pain != null && pain > 0 && (
            <div>
              <div className="mb-2 font-bold">Where does it hurt?</div>
              <Pill ariaLabel="Where does it hurt?" value={location ?? ('' as Location)} options={LOCATIONS} onChange={setLocation} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-6 max-md:grid-cols-1">
            {askSide ? (
              <div>
                <div className="mb-2 font-bold">Which arm are you practising?</div>
                <Pill ariaLabel="Which arm are you practising?" value={side ?? ('' as Side)} options={SIDES} onChange={setSide} />
                <p className="mt-1 text-lg text-muted">The camera setup and the guide figure use this side.</p>
              </div>
            ) : (
              <div>
                <div className="mb-2 font-bold">Practising side</div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-lg">{side === 'left' ? 'Left' : 'Right'} arm</span>
                  <Button variant="link" onClick={() => setAskSide(true)}>Change side</Button>
                </div>
              </div>
            )}
            <div>
              <div className="mb-2 font-bold">Energy today</div>
              <Pill ariaLabel="Energy today" value={energy} options={ENERGY} onChange={setEnergy} />
            </div>
          </div>
          <div>
            <div className="mb-2 font-bold">Time you have</div>
            <Pill ariaLabel="Time you have" value={minutes} options={MINUTES} onChange={setMinutes} className="w-full !flex-nowrap [&>button]:flex-1" />
          </div>
        </Card>
      </div>
      <FlowBar
        step={2}
        label={hint ?? readyLabel}
        labelId={hintId}
        left={<Button variant="secondary" onClick={onBack}>{backLabel}</Button>}
        right={
          <Button disabled={hint !== null || busy} aria-describedby={hint ? hintId : undefined} onClick={() => void go()}>
            {busy ? 'Saving…' : label}
          </Button>
        }
      />
    </div>
  )
}

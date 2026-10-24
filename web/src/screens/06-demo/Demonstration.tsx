import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AvatarPanel, type AvatarCtl } from '../../avatar/AvatarPanel'
import { Button } from '../../design/Button'
import { Activity, AlertTriangle, ChevronRight, Flag, RotateCcw, Volume2, VolumeX, X } from '../../design/Icon'
import { NumberScale } from '../../design/NumberScale'
import { Overlay, OverlayActions } from '../../design/Overlay'
import { useModalFocus } from '../../design/useModalFocus'
import { api, useApi, type Prescription } from '../../lib/api'
import { prefersReducedMotion } from '../../lib/motion'
import { readPrefs, writePrefs } from '../../lib/prefs'
import { dayPosition, markDemoSeen, readDay, saveCheckin, setupUrl, sideOr, startExercise, therapistLine, type Day, type DayCheckin } from '../../lib/day'
import { doseFor, readCheckinPain, tierFor, type Tier } from '../../lib/plan'
import { EXERCISES, exerciseById, isHiddenExercise, type ExerciseId } from '../../lib/seed'
import { resetSpeech } from '../../session/useCoach'

/** A check-in older than this asks for the pain number again before setup. */
const RECHECK_AFTER_MS = 2 * 3600e3

/** Screen 06 · Demonstration, design v2 (6 Oct 2026): the designers' full-screen theater
 *  (`dth-*`). The reference figure plays the clip mirrored so it faces the patient, with the
 *  theater dock (step, progress, Play/Pause, Replay, Slower) and its readouts (AvatarPanel
 *  `theater`). 21 Oct team review: Audio (each step read aloud, on by default, the same
 *  `prefs.audio` as Settings > Audio) and Skip demo (the theater's primary button) sit at the
 *  bottom right of the dock; Exit stays top left. When the clip ends, "Before you start" lists the target, Watch for and Stop if,
 *  with Watch again and one primary action.
 *
 *  The primary action follows the artifact's flow (D-FLOW): no check-in today → check-in with
 *  `next`; a stale check-in (older than 2 h), a day a stop rule ended, or pain after the last
 *  session ≥ 4 → a quick pain check; otherwise camera setup. The quick pain check is a real
 *  check-in (`saveCheckin` → `POST /api/checkin`), so the service sets the tier and writes the
 *  therapist flag at the stop level; a stopped day shows the rest result, never setup.
 *
 *  The figure's limit line is the prescription's, by tier (gentle → the lower bound of
 *  `allowed_adaptations.abduction.target_deg`, full → `exercises.abduction.target_deg`), never
 *  parsed from the dose text. Opening the screen records the exercise as the day's current one.
 *  A hidden exercise (28 Sep) is never demonstrated: its deep link goes back to Choose exercise.
 *  Demo-only exercises (none visible since 28 Sep; the path is kept dormant) tick sets through
 *  `/api/self_report`, traced as self-reported, never as a camera-verified rep. */
export function Demonstration() {
  const [sp] = useSearchParams()
  if (isHiddenExercise(sp.get('exercise'))) return <Navigate to="/details/choose" replace />
  return <DemonstrationFor />
}

/** The figure's angle limit for this exercise on this tier, from the prescription; undefined
 *  (the figure's own ceiling) for exercises without an angle or while it has not loaded. */
function limitFor(rx: Prescription | null, id: ExerciseId, tier: Tier): number | undefined {
  if (id !== 'abduction' || !rx) return undefined
  if (tier === 'gentle') {
    const range = rx.allowed_adaptations?.abduction?.target_deg
    if (Array.isArray(range) && typeof range[0] === 'number') return range[0]
  }
  const target = rx.exercises?.abduction?.target_deg
  return typeof target === 'number' ? target : undefined
}

function needsPainCheck(d: Day): boolean {
  if (!d.checkin) return false
  const age = Date.now() - Date.parse(d.checkin.at)
  return !(age < RECHECK_AFTER_MS) || d.stopped === 'session' || (d.lastPainAfter ?? 0) >= 4
}

function DemonstrationFor() {
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const id = sp.get('exercise') ?? 'cup'
  const [day] = useState(readDay)
  const side = sp.get('side') === 'right' || sp.get('side') === 'left' ? sideOr(sp.get('side')) : (day.checkin?.side ?? sideOr(null))
  const stopped = day.stopped != null
  const ex = exerciseById(id) ?? EXERCISES.find((e) => e.id === 'cup')!
  const demo = ex.mode === 'demo'
  const { data: rx } = useApi(() => api.prescription())

  useEffect(() => {
    if (!demo) startExercise(ex.id)
  }, [demo, ex.id])

  const [ticked, setTicked] = useState(0)
  const [tickError, setTickError] = useState<string | null>(null)
  const tick = () => {
    setTickError(null)
    api
      .selfReport(ex.serviceId)
      .then((r) => (r.ok ? setTicked(r.sets_today ?? ticked + 1) : setTickError(r.error ?? 'not saved')))
      .catch(() => setTickError('the session service is not reachable'))
  }

  // Today's dose (pain tier applied) sets the demonstrated hold; the prescription sets the limit.
  const tier = day.checkin?.tier ?? tierFor(readCheckinPain())
  const dose = doseFor(ex, tier)
  const holdS = Number(/hold (\d+(?:\.\d+)?) s/.exec(dose)?.[1]) || undefined
  const limitDeg = limitFor(rx, ex.id, tier)

  const dayNow = readDay()
  const ctaLabel = !dayNow.checkin ? 'Continue to check-in' : needsPainCheck(dayNow) ? 'Continue' : 'Continue to setup'
  const [painRe, setPainRe] = useState(false)
  const [painVal, setPainVal] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [restResult, setRestResult] = useState<{ checkin: DayCheckin; stop: Day['stopped'] } | null>(null)
  const practise = () => {
    markDemoSeen(ex.id)
    const d = readDay()
    if (!d.checkin) return nav(`/details/checkin?next=${ex.id}&side=${side}`)
    if (needsPainCheck(d)) return setPainRe(true)
    nav(setupUrl(ex.id, side))
  }
  // The quick pain check is a check-in: the earlier answers carry over with the new pain number,
  // and the service decides the tier and the therapist flag.
  const painDone = async () => {
    const prev = readDay().checkin
    if (painVal == null || !prev || saving) return
    setSaving(true)
    const c = await saveCheckin({ pain: painVal, location: prev.location, energy: prev.energy, minutes: prev.minutes, new_symptoms: prev.new_symptoms }, prev.side, rx?.stop_rules?.pain_max)
    setSaving(false)
    const after = readDay()
    if (after.stopped) setRestResult({ checkin: c, stop: after.stopped })
    else nav(setupUrl(ex.id, side))
  }

  const ctl = useRef<AvatarCtl | null>(null)
  const [complete, setComplete] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  // Reduced motion: the figure waits for Play (the dock's Play / Pause / Replay stay available)
  const [reducedMotion] = useState(prefersReducedMotion)
  const onComplete = useCallback(() => setComplete(true), [])
  const pos = dayPosition(day, ex.id)
  const sideWord = side === 'right' ? 'Right' : 'Left'
  const watchAgain = () => {
    setComplete(false)
    ctl.current?.replay()
  }
  const [audio, setAudio] = useState(() => readPrefs().audio)
  const toggleAudio = () => {
    const next = !audio
    setAudio(next)
    writePrefs({ ...readPrefs(), audio: next })
    if (!next) resetSpeech()
  }
  useEffect(() => () => resetSpeech(), [])
  // "Before you start": focus inside while open, Escape = Watch again, focus back on close
  useModalFocus(modalRef, complete, { onEscape: watchAgain })
  const stopAt = Math.min(7, rx?.stop_rules?.pain_max ?? 7)
  const restTitle = restResult?.stop === 'rest' ? 'Rest today' : restResult?.stop === 'session' ? 'Stopped for today' : 'No exercises today'

  return (
    <div className="dth-root" data-testid="demo-theater">
      <header className="dth-top">
        <button type="button" className="dth-exit" onClick={() => nav('/details/choose')}>
          <X aria-hidden size={18} />
          Exit
        </button>
        <div className="dth-titles">
          <div className="dth-title-row">
            <h1 className="dth-title">{ex.name}</h1>
            {/* 24 Oct: said up front that this is only a demonstration; the camera starts later */}
            <span className="dth-demo-badge">Demo · camera off</span>
          </div>
          <p className="dth-sub">{`Watch how it's done first · ${sideWord} arm`}</p>
        </div>
        {pos && <div className="dth-count" data-testid="day-title">{`Exercise ${pos.index} of ${pos.total}`}</div>}
      </header>
      <div className="dth-main" aria-hidden={complete || undefined}>
        <AvatarPanel
          theater
          autoplay={!reducedMotion}
          overlayTop={92}
          limitDeg={limitDeg}
          ctlRef={ctl}
          onComplete={onComplete}
          clip={ex.clip}
          side={side === 'right' ? 'left' : 'right'}
          patientSide={side}
          holdS={holdS}
          speakSteps={audio && !complete}
          dockEnd={
            <>
              <button type="button" className={`dth-btn ${audio ? 'dth-on' : ''}`} aria-pressed={audio} onClick={toggleAudio}>
                {audio ? <Volume2 aria-hidden size={18} /> : <VolumeX aria-hidden size={18} />}
                {audio ? 'Audio on' : 'Audio off'}
              </button>
              {/* 13 Oct team test: go on without watching (same way on as the clip's own Continue) */}
              {!demo && !stopped && (
                <button type="button" className="dth-mbtn dth-mbtn-1" onClick={practise}>
                  Skip demo
                  <ChevronRight aria-hidden size={18} />
                </button>
              )}
            </>
          }
        />
        {ex.stopIf && (
          <p className="dth-stopline">
            <AlertTriangle aria-hidden className="dth-stop-ic" />
            {`Stop if your ${ex.stopIf}.`}
          </p>
        )}
      </div>
      {complete && (
        <div className="dth-scrim">
          <div ref={modalRef} role="dialog" aria-modal aria-labelledby="dth-modal-title" className="dth-modal">
            <h2 id="dth-modal-title" className="dth-mtitle">Before you start</h2>
            <p className="dth-msub">{`${ex.name} · ${sideWord} arm`}</p>
            <dl className="dth-rows">
              <div className="dth-row">
                <Activity aria-hidden className="dth-ic dth-ic-teal" />
                <dt>Your target</dt>
                <dd>{dose}</dd>
              </div>
              {ex.watchFor && (
                <div className="dth-row">
                  <AlertTriangle aria-hidden className="dth-ic dth-ic-amber" />
                  <dt>Watch for</dt>
                  <dd>{ex.watchFor}</dd>
                </div>
              )}
              {ex.stopIf && (
                <div className="dth-row dth-row-stop">
                  <Flag aria-hidden className="dth-ic dth-ic-red" />
                  <dt>Stop if</dt>
                  <dd>{`Your ${ex.stopIf}`}</dd>
                </div>
              )}
            </dl>
            {stopped ? (
              <p className="dth-note dth-note-warn">No exercises today: you can watch, but nothing starts until your next check-in allows it.</p>
            ) : demo ? (
              <p role="status" className="dth-note">
                {tickError
                  ? `Could not save the tick: ${tickError}.`
                  : ticked > 0
                    ? `${ticked} set${ticked === 1 ? '' : 's'} ticked today · self-reported, not checked by the camera`
                    : 'Demo only: follow the figure and tick each set yourself. The camera does not score this one.'}
              </p>
            ) : (
              <p className="dth-note">The figure only shows the movement. The camera checks your real reps.</p>
            )}
            <div className="dth-actions">
              <button type="button" className="dth-mbtn dth-mbtn-2" onClick={watchAgain}>
                <RotateCcw aria-hidden size={16} />
                Watch again
              </button>
              {demo ? (
                <button type="button" className="dth-mbtn dth-mbtn-1" data-autofocus disabled={stopped} onClick={tick}>I did a set</button>
              ) : (
                <button type="button" className="dth-mbtn dth-mbtn-1" data-autofocus disabled={stopped} onClick={practise}>{ctaLabel}</button>
              )}
            </div>
            {demo && (
              <div className="dth-links">
                <button type="button" onClick={() => nav('/details/choose')}>Back to exercises</button>
              </div>
            )}
          </div>
        </div>
      )}
      {/* The quick pain check and the stopped-day card open from Skip demo too (13 Oct),
          so they live outside the end-of-clip "Before you start" box. */}
      <Overlay
        open={painRe && !restResult}
        title="Quick pain check"
        description="One question before the camera setup."
        onClose={saving ? undefined : () => setPainRe(false)}
        className="w-[min(640px,92vw)]"
      >
        <p className="mt-1 text-muted">You checked in earlier today. Before this exercise, just the pain number.</p>
        <div className="mt-5">
          <NumberScale label="Pain right now" value={painVal} onChange={setPainVal} leftAnchor="No pain" rightAnchor="Worst imaginable" />
        </div>
        <OverlayActions>
          <Button variant="secondary" disabled={saving} onClick={() => setPainRe(false)}>Back</Button>
          <Button disabled={painVal == null || saving} onClick={() => void painDone()}>Continue to setup</Button>
        </OverlayActions>
      </Overlay>
      {/* The quick check stopped the day. No frame in the artifact: extends Check-in's
          stopped card inside the artifact's own overlay (docs/PLAN.md). */}
      <Overlay open={!!restResult} title={restTitle} description="Today's practice has stopped." className="w-[min(640px,92vw)]">
        {restResult && (
          <>
            <p className="mt-1">
              {restResult.stop === 'rest'
                ? `Pain ${restResult.checkin.pain} is at or above your stop level of ${stopAt}. Rest the arm today.`
                : restResult.stop === 'new_symptoms'
                  ? "You told us something is new or worse. Rest the arm, and don't practise until your therapist has looked at it."
                  : "A stop rule ended today's practice. Rest the arm today."}
            </p>
            {restResult.stop !== 'session' && <p className="mt-2">{therapistLine(restResult.checkin)}</p>}
            <p className="mt-2 text-muted">If it feels urgent, call your care team.</p>
            <OverlayActions className="justify-end">
              <Button onClick={() => nav('/details')}>Back to Home</Button>
            </OverlayActions>
          </>
        )}
      </Overlay>
    </div>
  )
}

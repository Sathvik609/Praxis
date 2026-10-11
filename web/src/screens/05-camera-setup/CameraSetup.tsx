import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { FlowBar } from '../../app/FlowBar'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { RotateCcw, X } from '../../design/Icon'
import { SESSION_WS_URL, processingPlace } from '../../lib/config'
import { readDay, sessionUrl, sideOr, startExercise, syncCheckin, therapistLine, type Day, type Side } from '../../lib/day'
import { EXERCISES, exerciseById, isHiddenExercise, type Exercise } from '../../lib/seed'
import { cameraBlockedCopy } from '../../session/CameraBlocked'
import { OverlayCanvas, type CalibrationEvent } from '../../session/OverlayCanvas'
import { useWebcamStream } from '../../session/useWebcamStream'
import { SETUP_TIPS, SetupDiagram, placementCopy } from './SetupDiagram'
import { currentStepIndex, resolveChecks, setupViewFor, type Check } from './setupView'

const SHEET: Record<string, string> = { nhpt: 'nhpt_board', cup: 'cup_targets', arm: 'nhpt_board' }

type SetupChecksEvent = { checks: Check[]; all_required_pass: boolean }
type QualityEvent = { steadiness?: { ok?: boolean } }

/** Screen 05 · Camera setup and calibration (design v2, 6 Oct: the designers' immersive `cs-*`
 *  layout, live J65151–65385). The checks come from the service's `setup_checks` events
 *  (`setupView.ts`); pose rows the service does not measure yet and the table view's
 *  "Is this your left arm?" are patient self-checks, confirmed in the coach pill. Once every
 *  required check passes, a still-pose countdown and a 4 s auto-continue run into the session
 *  (D-FLOW: Demonstration → Check-in → Setup → Session), with a visible Cancel.
 *
 *  A day stopped at check-in never opens the camera. */
export function CameraSetup() {
  const [sp] = useSearchParams()
  // A hidden exercise (28 Sep) never opens the camera: back to Choose exercise.
  if (isHiddenExercise(sp.get('exercise'))) return <Navigate to="/details/choose" replace />
  return <CameraSetupFor />
}

function CameraSetupFor() {
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const [day, setDay] = useState<Day>(readDay)
  useEffect(() => {
    let alive = true
    void syncCheckin().then(() => alive && setDay(readDay()))
    return () => {
      alive = false
    }
  }, [])
  const ex = exerciseById(sp.get('exercise') ?? 'nhpt') ?? EXERCISES.find((e) => e.id === 'nhpt')!
  const param = sp.get('side')
  const side: Side = param === 'left' || param === 'right' ? param : (day.checkin?.side ?? sideOr(null))
  if (day.stopped) {
    return (
      <div className="flex min-h-full flex-col">
        <div className="mx-auto w-full max-w-3xl flex-1 p-6">
          <Card tone="watch" as="div" className="space-y-3">
            <h1 className="text-4xl">No exercises today</h1>
            <p className="text-xl">
              {day.stopped === 'new_symptoms'
                ? 'You told us something is new or worse. Rest the arm until your therapist has looked at it.'
                : day.stopped === 'rest'
                  ? 'Your pain today is at your stop level. Rest the arm today.'
                  : "A stop rule ended today's practice. Rest the arm today."}
              {day.checkin && day.stopped !== 'session' ? ` ${therapistLine(day.checkin)}` : ''}
            </p>
            <p className="text-lg text-muted">The camera stays off.</p>
          </Card>
        </div>
        <FlowBar step={3} label="Camera setup" right={<Button onClick={() => nav('/details')}>Back to Home</Button>} />
      </div>
    )
  }
  return <SetupLive ex={ex} side={side} rehearse={sp.get('rehearse') === '1'} />
}

function SetupLive({ ex, side, rehearse }: { ex: Exercise; side: Side; rehearse: boolean }) {
  const nav = useNavigate()
  // The arm exercises run the arm pipeline: no sheet.
  const kind = ex.session ?? 'nhpt'
  const isArm = kind === 'arm'
  const view = setupViewFor(ex)
  const pendulum = ex.id === 'pendulum'
  const [ticks, setTicks] = useState<Record<string, boolean>>({})
  const params = useMemo(() => {
    const p: Record<string, string> = { sheet: SHEET[kind] ?? 'nhpt_board' }
    if (kind === 'arm') p.for = 'arm' // no sheet; the service skips marker checks
    return p
  }, [kind])
  const { camActive, connected, events, error, start, stop, videoRef } = useWebcamStream({
    wsUrl: SESSION_WS_URL,
    mode: 'calibrate',
    params,
  })

  useEffect(() => {
    void start()
    return stop
  }, [start, stop])

  const last = <T,>(type: string) =>
    [...events].reverse().find((e) => e.type === type) as (T & { type: string }) | undefined
  const cal = last<CalibrationEvent>('calibration') ?? null
  const blocked = !!error
  const camOn = camActive && !blocked
  // The checks count only while this run's camera and socket are up, and never the event that
  // was newest when the camera was restarted (it describes the previous run).
  const latestChecks = last<SetupChecksEvent>('setup_checks')
  const [staleChecks, setStaleChecks] = useState<unknown>(null)
  const checks = camOn && connected && latestChecks !== staleChecks ? latestChecks : undefined
  const { rows, ready } = resolveChecks(view, side, pendulum, checks, ticks)
  const restart = () => {
    setStaleChecks(latestChecks ?? null)
    stop()
    void start()
  }
  const copy = placementCopy(view, side, pendulum)
  // The still pose resets while the service says the picture is not steady. The service sends
  // `quality` (with `steadiness`) only on a sheet calibrate; the arm setup has no steadiness
  // event, so there the still-pose step is time-only.
  const steady = last<QualityEvent>('quality')?.steadiness?.ok !== false
  const local = processingPlace().includes('this device')
  const [info, setInfo] = useState(false)
  // Seconds the patient has been ready and still; it drives the still-pose countdown and then
  // the auto-continue, and drops back to 0 whenever readiness or steadiness is lost.
  const [stillN, setStillN] = useState(0)
  // Cancel holds the auto-continue for the rest of this setup; Continue stays with the patient.
  const [held, setHeld] = useState(false)
  const sideWord = side === 'right' ? 'Right' : 'Left'
  const armed = ready && camOn && connected && steady

  useEffect(() => {
    if (!armed) return
    const t = window.setInterval(() => setStillN((n) => Math.min(n + 1, CS_STILL_S + CS_GO_S)), 1000)
    return () => {
      window.clearInterval(t)
      setStillN(0)
    }
  }, [armed])
  const stillLeft = armed ? Math.max(0, CS_STILL_S - stillN) : null
  const goLeft = stillLeft === 0 && !held ? CS_STILL_S + CS_GO_S - stillN : null

  const goSession = useCallback(() => {
    startExercise(ex.id)
    nav(`${sessionUrl(ex, side)}${rehearse ? '&rehearse=1' : ''}`)
  }, [nav, ex, side, rehearse])

  useEffect(() => {
    if (goLeft === 0) goSession()
  }, [goLeft, goSession])

  const short = (id: string) => (id === 'markers' ? 'Sheet' : (CS_SHORT[id] ?? id))
  type Step = Check & { short: string }
  const steps: Step[] = [
    ...rows.map((r) => ({ ...r, short: short(r.id) })),
    { id: 'still', short: 'Still pose', label: 'Hold still in your starting pose', status: stillLeft === 0 ? 'pass' : 'pending', hint: null, source: 'camera' },
  ]
  // the specific camera fix first, then the open self-checks; advice rows never hold the walk
  const firstOpen = currentStepIndex(rows)
  const currentIdx = !camOn ? 0 : ready ? (stillLeft === 0 ? -1 : steps.length - 1) : Math.max(0, firstOpen)
  const cur = currentIdx >= 0 ? steps[currentIdx] : null
  type Coach = { tone: 'amber' | 'mint'; icon?: string; num?: number; text: string; self?: Step | null }
  const coach: Coach | null = !camOn
    ? null
    : !ready
      ? { tone: 'amber', icon: cur?.id ?? 'camera', text: cur?.hint || cur?.label || 'Getting ready…', self: cur?.source === 'self' ? cur : null }
      : stillLeft === 0
        ? { tone: 'mint', icon: 'check', text: 'All set. Starting your session' }
        : { tone: 'mint', num: stillLeft ?? CS_STILL_S, text: 'Hold still in your starting pose' }

  const offCopy = blocked
    ? cameraBlockedCopy(/unreachable/i.test(error ?? '') ? 'service_unreachable' : 'camera_blocked', error)
    : { title: 'Camera is off', text: `Praxis needs your camera to check each rep. ${local ? 'Video stays on this device.' : 'Video is processed in memory and never stored.'}` }
  const telemetry = [
    isArm ? 'OpenCV 5 · pose view' : 'OpenCV 5 · ArUco calibration',
    isArm
      ? connected
        ? 'Connection ready'
        : 'Connecting…'
      : `Calibration ${cal?.calibrated ? 'locked' : 'searching'}${cal?.calibrated && cal.rms_mm != null ? ` · rms ${cal.rms_mm} mm` : ''}`,
    local ? 'Processed on this device' : 'Processed in memory · never stored',
  ]

  return (
    <div className="cs-root" data-testid="camera-setup">
      <header className="cs-top">
        <button type="button" className="cs-exit" onClick={() => nav('/details/choose')}>
          <X aria-hidden size={16} />
          Exit
        </button>
        <div className="cs-titles">
          <h1 className="cs-title">{ex.name}</h1>
          <p className="cs-sub">{`Camera setup · ${sideWord} arm`}</p>
        </div>
      </header>
      <div className="cs-stage">
        <div className="cs-frame">
          <video ref={videoRef} muted playsInline className="cs-video" />
          <OverlayCanvas width={640} height={480} calibration={cal} />
          {camOn && <div aria-hidden className={`cs-guide ${ready ? 'cs-guide-ok' : ''}`} />}
        </div>
        {camOn && (
          <div className="cs-live" role="status">
            <span className="cs-live-dot" aria-hidden />
            <b>Live · not recording</b>
            <span>· Mirrored ·</span>
            {ico('lock', 13)}
            <span>{local ? 'Processed on this device' : 'Processed in memory, never stored'}</span>
          </div>
        )}
        <button type="button" className="cs-info-btn" aria-expanded={info} aria-label="Setup guide and camera details" onClick={() => setInfo((v) => !v)}>
          i
        </button>
        {info && (
          <div className="cs-info" role="dialog" aria-label="Setup guide">
            <div className="cs-info-head">
              <h2>{copy.heading}</h2>
              <button type="button" aria-label="Close" onClick={() => setInfo(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="cs-info-diagram">
              <SetupDiagram view={view} pendulum={pendulum} />
            </div>
            <p>{copy.body}</p>
            <p className="cs-info-muted">{SETUP_TIPS}</p>
            <ul className="cs-info-checks">
              {rows.map((r) => (
                <li key={r.id}>
                  <span className={`cs-mini cs-mini-${r.status === 'pass' ? 'ok' : 'todo'}`}>{r.status === 'pass' ? '✓' : ''}</span>
                  {r.label}
                </li>
              ))}
            </ul>
            <div className="cs-telemetry">
              {telemetry.map((t, i) => (
                <div key={i}>{t}</div>
              ))}
            </div>
            <div className="cs-info-actions">
              <button type="button" onClick={restart}>
                <RotateCcw aria-hidden size={14} />
                Restart camera
              </button>
              <button type="button" onClick={() => nav('/details/choose')}>
                Change exercise
              </button>
            </div>
          </div>
        )}
        {!camOn && (
          <div className="cs-off" role={blocked ? 'alert' : undefined}>
            <div className="cs-off-icon">{ico('camoff', 40)}</div>
            <h2>{offCopy.title}</h2>
            <p>{offCopy.text}</p>
            <button type="button" className="cs-allow" onClick={restart}>
              {blocked ? 'Try again' : 'Allow camera'}
            </button>
            <button type="button" className="cs-link" onClick={() => nav('/details/settings')}>
              No camera? Use a recorded session
            </button>
          </div>
        )}
        {coach && (
          <div className={`cs-coach cs-coach-${coach.tone}`} role="status" aria-live="polite">
            <span className="cs-coach-ic" aria-hidden>
              {coach.num != null ? coach.num : ico(coach.icon ?? 'dot', 18)}
            </span>
            <span className="cs-coach-text">{coach.text}</span>
            {coach.self && (
              <button type="button" className="cs-coach-yes" onClick={() => setTicks((t) => ({ ...t, [coach.self!.id]: true }))}>
                {coach.self.yes ?? 'Yes, I can see it'}
              </button>
            )}
          </div>
        )}
      </div>
      <footer className="cs-bar">
        {/* The artifact's Seated/Bedside segment (hidden by its CSS, read by nothing) is not
            ported; this empty cell keeps the steps centred in the bar's 1fr · auto · 1fr grid. */}
        <span aria-hidden />
        <ol className="cs-steps" aria-label="Setup checks">
          {steps.map((st, i) => {
            const shownUpTo = ready ? steps.length : Math.max(0, firstOpen)
            const state = i === currentIdx ? 'now' : st.status === 'pass' && (st.id === 'still' || i < shownUpTo) ? 'ok' : 'todo'
            return (
              <li key={st.id} className={`cs-step cs-step-${state}`} aria-current={state === 'now' ? 'step' : undefined} title={st.label}>
                <span className="cs-step-ic">
                  {ico(st.id, 18)}
                  {state !== 'todo' && (
                    <span className="cs-step-badge" aria-hidden>
                      {state === 'ok' ? '✓' : '!'}
                    </span>
                  )}
                </span>
                <span className="cs-step-label">{st.short}</span>
                <span className="cs-sr">{state === 'ok' ? ' · done' : state === 'now' ? ' · now' : ''}</span>
              </li>
            )
          })}
        </ol>
        <div className="cs-go">
          {goLeft != null && (
            <button type="button" className="cs-skip" onClick={() => setHeld(true)}>
              Cancel
            </button>
          )}
          {/* Nothing blocks (10 Oct, product owner): failing checks stay visible with their fix, but the
              patient may always go on; without the sheet nothing is counted and the session says so. */}
          <button type="button" className="cs-continue" onClick={goSession}>
            {goLeft != null ? `Continue · ${goLeft}` : ready ? 'Continue' : 'Continue anyway'}
          </button>
        </div>
      </footer>
    </div>
  )
}

function ico(id: string, size = 20) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {(CS_ICONS[id] ?? CS_ICONS.dot).map((d, i) => {
        if (!d.startsWith('c:')) return <path key={i} d={d} />
        const [, cx, cy, r] = d.split(':')
        return <circle key={i} cx={+cx} cy={+cy} r={+r} />
      })}
    </svg>
  )
}

const CS_STILL_S = 2
const CS_GO_S = 4
const CS_SHORT: Record<string, string> = {
  side_confirm: 'Your side',
  camera: 'Camera',
  person: 'In frame',
  task_area: 'Hand area',
  angle: 'Angle',
  lighting: 'Lighting',
  front_view: 'Facing',
  upper_in_view: 'Both arms',
  side_view: 'Side on',
  hip_in_view: 'Hip',
  arm_in_view: 'Whole arm',
}
const CS_ICONS: Record<string, string[]> = {
  camera: ['M3 8h3.5L8 5.5h8L17.5 8H21v11H3z', 'c:12:13:3.6'],
  person: ['c:12:7:3.5', 'M5 20.5c0-4 3.1-6.8 7-6.8s7 2.8 7 6.8'],
  front_view: ['c:12:7:3.5', 'M5 20.5c0-4 3.1-6.8 7-6.8s7 2.8 7 6.8'],
  side_confirm: ['c:12:6:3', 'M7 21v-6.5a5 5 0 0 1 10 0V21', 'M4 11l3 2'],
  side_view: ['c:12:6:3', 'M12 9.5v6l-2 5.5M12 12l3.5 2.5', 'M9 21h6'],
  hip_in_view: ['c:12:5:2.5', 'M12 8v6M8 14h8M9 14l-1 7M15 14l1 7'],
  task_area: ['M8 13V6a1.5 1.5 0 0 1 3 0v5', 'M11 11V4.5a1.5 1.5 0 0 1 3 0V11', 'M14 11V6a1.5 1.5 0 0 1 3 0v8c0 4-2.5 7-6 7-2.4 0-4-1.2-5.4-3.4L4.2 15a1.5 1.5 0 0 1 2.5-1.6L8 15'],
  markers: ['M6.5 4.5h9l-1.4 15h-6.2z', 'M15.5 8h1.8a2 2 0 0 1 0 4h-2.2'],
  angle: ['M4 20h16', 'M4 20 16 7', 'M10 20a6.5 6.5 0 0 0-2-4.6'],
  upper_in_view: ['c:12:5:2.5', 'M3 10h18M12 10v5M9 21l3-6 3 6'],
  arm_in_view: ['c:12:5:2.5', 'M3 10h18M12 10v5M9 21l3-6 3 6'],
  lighting: ['c:12:12:4', 'M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4'],
  still: ['c:12:13:7.5', 'M12 9.5V13l2.4 2', 'M9.5 2.5h5'],
  check: ['M5 12.5 9.5 17 19 7.5'],
  lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  camoff: ['M3 3l18 18', 'M7.5 7.5H3v11.5h14', 'M10 5h6l1.5 2.5H21v10', 'M9.6 10.6a3.6 3.6 0 0 0 4.9 4.9'],
  dot: ['c:12:12:4'],
}

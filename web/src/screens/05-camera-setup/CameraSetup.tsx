import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FlowBar } from '../../app/FlowBar'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { RotateCcw } from '../../design/Icon'
import { Panel } from '../../design/Panel'
import { SESSION_WS_URL, processingPlace } from '../../lib/config'
import { demoUrl, readDay, sessionUrl, sideOr, startExercise, syncCheckin, therapistLine, type Day, type Side } from '../../lib/day'
import { EXERCISES, exerciseById, type Exercise } from '../../lib/seed'
import { CameraBlocked } from '../../session/CameraBlocked'
import { LiveIndicator } from '../../session/LiveIndicator'
import { OverlayCanvas, type CalibrationEvent } from '../../session/OverlayCanvas'
import { useWebcamStream } from '../../session/useWebcamStream'
import { DayStrip } from '../04-choose/DayStrip'
import { Checklist, type Check } from './Checklist'
import { SETUP_TIPS, SetupDiagram, placementCopy } from './SetupDiagram'
import { resolveChecks, setupViewFor } from './setupView'

const SHEET: Record<string, string> = { nhpt: 'nhpt_board', cup: 'cup_targets', arm: 'nhpt_board' }

type SetupChecksEvent = { checks: Check[]; all_required_pass: boolean }

/** Screen 05 · Camera setup and calibration. Continue stays disabled until every required
 *  check passes. The checklist, the placement diagram and the copy follow the exercise's
 *  camera view (`setupView.ts`): side (Pendulum, Arm to the front), front (Arm out to the side)
 *  or table (Waiter – cup, NHPT, ArUco markers required). Pose rows the service does not
 *  measure yet are patient self-checks and say so. The feed is a Panel with the live, mirrored
 *  and calibration lines in its corners.
 *
 *  Day flow: the day strip shows where this exercise sits; a demonstration already watched
 *  today can be skipped; a day stopped at check-in never opens the camera. */
export function CameraSetup() {
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
        <FlowBar step={2} label="Camera setup" right={<Button onClick={() => nav('/details')}>Back to Home</Button>} />
      </div>
    )
  }
  return <SetupLive ex={ex} side={side} day={day} />
}

function SetupLive({ ex, side, day }: { ex: Exercise; side: Side; day: Day }) {
  const nav = useNavigate()
  // Pendulum, Arm to the front and Arm out to the side all run the arm pipeline: no sheet.
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
  const checks = last<SetupChecksEvent>('setup_checks')
  const { rows, ready } = resolveChecks(view, side, pendulum, checks, ticks)
  const hasSelf = rows.some((r) => r.source === 'self')
  const restart = () => {
    stop()
    void start()
  }
  const copy = placementCopy(view, side, pendulum)
  const seenDemo = day.demosSeen.includes(ex.id)
  const intro = isArm
    ? view === 'front'
      ? `No sheet needed. ${ex.name}: face the camera with both shoulders and both hands in view.`
      : pendulum
        ? `No sheet needed. ${ex.name}: stand sideways to the camera, your ${side} side toward it.`
        : `No sheet needed. ${ex.name}: sit sideways to the camera, your ${side} side toward it.`
    : `Continue unlocks when every required check passes. ${ex.name}.`

  return (
    <div className="flex min-h-full flex-col">
      <div className="grid flex-1 grid-cols-[3fr_2fr] gap-6 p-6">
        <Panel
          className="self-start"
          topLeft={<LiveIndicator active={camActive} />}
          topRight={<span>mirrored · {processingPlace()}</span>}
          bottomLeft={
            <span>
              {isArm ? 'OpenCV 5 · pose view' : 'OpenCV 5 · ArUco calibration'}{' '}
              <b>{isArm ? (connected ? 'ready' : 'connecting…') : cal?.calibrated ? 'locked' : 'searching'}</b>
              {!isArm && cal?.calibrated && cal.rms_mm != null ? ` · rms ${cal.rms_mm} mm` : ''}
              {!isArm && !connected ? ' · connecting…' : ''}
            </span>
          }
        >
          <video ref={videoRef} muted playsInline className="aspect-4/3 w-full -scale-x-100 object-cover" />
          <OverlayCanvas width={640} height={480} calibration={cal} />
          {error && (
            <div className="absolute inset-0 z-20">
              <CameraBlocked reason={/unreachable/i.test(error) ? 'service_unreachable' : 'camera_blocked'} detail={error} onRetry={restart} />
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-5">
          <div>
            <DayStrip day={day} active={ex.id} className="mb-2" />
            <h1 className="text-3xl">Set up camera and equipment</h1>
            <p className="text-muted">{intro}</p>
          </div>
          <Card padding="sm" className="flex items-center gap-4">
            <SetupDiagram view={view} pendulum={pendulum} />
            <div className="min-w-0">
              <h2 className="text-xl">{copy.heading}</h2>
              <p className="text-lg text-muted">{copy.body}</p>
            </div>
          </Card>
          <Card padding="none" className="px-5">
            <Checklist checks={rows} onTick={(id) => setTicks((t) => ({ ...t, [id]: !t[id] }))} />
            {hasSelf && (
              <p className="border-t border-line py-3 text-lg text-muted">
                Rows marked “You check”: the camera does not check these yet. Look at the picture and tap “Yes, I can see it”.
              </p>
            )}
          </Card>
          <p className="text-lg text-muted">{SETUP_TIPS}</p>
          <p className="text-lg text-muted">Video is {processingPlace()}. Only measurements and events are saved.</p>
          <div>
            <Button variant="secondary" icon={<RotateCcw />} onClick={restart}>
              Restart camera
            </Button>
          </div>
        </div>
      </div>
      <FlowBar
        step={2}
        label="Camera setup"
        left={
          <>
            <Button variant="secondary" onClick={() => nav('/details/choose')}>
              Change exercise
            </Button>
            {seenDemo && (
              <Button
                variant="secondary"
                disabled={!ready}
                onClick={() => {
                  startExercise(ex.id)
                  nav(sessionUrl(ex, side))
                }}
              >
                Skip demo
              </Button>
            )}
          </>
        }
        right={
          <Button disabled={!ready} onClick={() => nav(demoUrl(ex.id, side))}>
            Continue to demonstration
          </Button>
        }
      />
    </div>
  )
}

import { useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FlowBar } from '../../app/FlowBar'
import { Button } from '../../design/Button'
import { SESSION_WS_URL } from '../../lib/config'
import { LiveIndicator } from '../../session/LiveIndicator'
import { OverlayCanvas, type CalibrationEvent } from '../../session/OverlayCanvas'
import { useWebcamStream } from '../../session/useWebcamStream'
import { Checklist, type Check } from './Checklist'
import { ProcessingToggle } from './ProcessingToggle'

const SHEET: Record<string, string> = { nhpt: 'nhpt_board', cup: 'cup_targets', arm: 'nhpt_board' }
const TITLE: Record<string, string> = {
  nhpt: 'Nine-Hole Peg Test',
  cup: 'Waiter – cup',
  arm: 'Arm to the front',
}

type SetupChecksEvent = { checks: Check[]; all_required_pass: boolean }

/** Screen 05 · Camera setup and calibration. Continue stays disabled until every required
 *  check passes. ArUco markers are required for the two board tasks. */
export function CameraSetup() {
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const exercise = sp.get('exercise') ?? 'nhpt'
  const params = useMemo(() => {
    const p: Record<string, string> = { sheet: SHEET[exercise] ?? 'nhpt_board' }
    if (exercise === 'arm') p.for = 'arm' // no sheet; the service skips marker checks
    return p
  }, [exercise])
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
  const ready = checks?.all_required_pass === true

  return (
    <div className="flex min-h-[calc(100vh-5rem)] flex-col">
      <div className="grid flex-1 grid-cols-[3fr_2fr] gap-8 p-8">
        <div className="relative overflow-hidden rounded-3xl bg-[var(--stage-a)] text-white">
          <div className="absolute left-4 top-3 z-10 flex items-center gap-2">
            <LiveIndicator active={camActive} />
            <span className="text-white/70">· mirrored · processed on this device</span>
          </div>
          <video ref={videoRef} muted playsInline className="aspect-4/3 w-full -scale-x-100 object-cover" />
          <OverlayCanvas width={640} height={480} calibration={cal} />
          <div className="absolute bottom-3 left-4 text-white/80">
            OpenCV 5 · ArUco calibration <b>{cal?.calibrated ? 'locked' : 'searching'}</b>
            {cal?.calibrated && cal.rms_mm != null ? ` · rms ${cal.rms_mm} mm` : ''}
            {connected ? '' : ' · connecting…'}
          </div>
          {error && <div className="absolute inset-x-4 top-12 rounded-xl bg-red p-3">{error}</div>}
        </div>

        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-4xl">Set up camera and equipment</h1>
            <p className="text-muted">
              {exercise === 'arm'
                ? 'No sheet needed. Sit sideways to the camera with your shoulder and hip in view.'
                : `Continue unlocks when every required check passes. ${TITLE[exercise] ?? exercise}.`}
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-surface px-6">
            <Checklist checks={checks?.checks ?? []} />
          </div>
          <ProcessingToggle />
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                stop()
                void start()
              }}
            >
              Retry
            </Button>
            <Button variant="secondary">Setup guide</Button>
            <Button variant="secondary">Audio test</Button>
          </div>
        </div>
      </div>
      <FlowBar
        step={2}
        label="Camera setup"
        left={
          <Button variant="secondary" onClick={() => nav('/choose')}>
            Change exercise
          </Button>
        }
        right={
          <Button disabled={!ready} onClick={() => nav(`/demo?exercise=${exercise}`)}>
            Continue to demonstration
          </Button>
        }
      />
    </div>
  )
}

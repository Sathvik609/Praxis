import { useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FlowBar } from '../../app/FlowBar'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { RotateCcw } from '../../design/Icon'
import { Panel } from '../../design/Panel'
import { SESSION_WS_URL } from '../../lib/config'
import { CameraBlocked } from '../../session/CameraBlocked'
import { LiveIndicator } from '../../session/LiveIndicator'
import { OverlayCanvas, type CalibrationEvent } from '../../session/OverlayCanvas'
import { useWebcamStream } from '../../session/useWebcamStream'
import { Checklist, type Check } from './Checklist'

const SHEET: Record<string, string> = { nhpt: 'nhpt_board', cup: 'cup_targets', arm: 'nhpt_board' }
const TITLE: Record<string, string> = {
  nhpt: 'Nine-Hole Peg Test',
  cup: 'Waiter – cup',
  arm: 'Arm to the front',
}

type SetupChecksEvent = { checks: Check[]; all_required_pass: boolean }

/** Screen 05 · Camera setup and calibration. Continue stays disabled until every required
 *  check passes. ArUco markers are required for the two board tasks; the arm task needs no
 *  sheet. The feed is a Panel with the live, mirrored and calibration lines in its corners. */
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
  const restart = () => {
    stop()
    void start()
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="grid flex-1 grid-cols-[3fr_2fr] gap-6 p-6">
        <Panel
          className="self-start"
          topLeft={<LiveIndicator active={camActive} />}
          topRight={<span>mirrored · processed on this device</span>}
          bottomLeft={
            <span>
              {exercise === 'arm' ? 'OpenCV 5 · pose view' : 'OpenCV 5 · ArUco calibration'}{' '}
              <b>{exercise === 'arm' ? (connected ? 'ready' : 'connecting…') : cal?.calibrated ? 'locked' : 'searching'}</b>
              {exercise !== 'arm' && cal?.calibrated && cal.rms_mm != null ? ` · rms ${cal.rms_mm} mm` : ''}
              {exercise !== 'arm' && !connected ? ' · connecting…' : ''}
            </span>
          }
        >
          <video ref={videoRef} muted playsInline className="aspect-4/3 w-full -scale-x-100 object-cover" />
          <OverlayCanvas width={640} height={480} calibration={cal} />
          {error && (
            <div className="absolute inset-0 z-20">
              <CameraBlocked reason={/unreachable/i.test(error) ? 'service_unreachable' : 'camera_blocked'} onRetry={restart} />
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-5">
          <div>
            <h1 className="text-3xl">Set up camera and equipment</h1>
            <p className="text-muted">
              {exercise === 'arm'
                ? 'No sheet needed. Sit sideways to the camera with your shoulder and hip in view.'
                : `Continue unlocks when every required check passes. ${TITLE[exercise] ?? exercise}.`}
            </p>
          </div>
          <Card padding="none" className="px-5">
            <Checklist checks={checks?.checks ?? []} />
          </Card>
          <p className="text-lg text-muted">Processed on this device. Video is not stored; only measurements and events are saved.</p>
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

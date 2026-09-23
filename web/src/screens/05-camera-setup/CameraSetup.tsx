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
import { exerciseById } from '../../lib/seed'
import { Checklist, type Check } from './Checklist'

const SHEET: Record<string, string> = { nhpt: 'nhpt_board', cup: 'cup_targets', arm: 'nhpt_board' }

type SetupChecksEvent = { checks: Check[]; all_required_pass: boolean }

/** Overhead-mount guidance for the two sheet tasks (D-CAL-3). The sheet homography ignores
 *  height, so a webcam looking across the table puts pegs and hands tens of mm off; the
 *  service measures the tilt from the ArUco pose and asks for ≤ 25°. Inline SVG: a phone on
 *  a stand about 50 cm above the table, pointing straight down at the sheet. */
function MountDiagram() {
  return (
    <svg
      role="img"
      aria-label="A phone on a stand about 50 centimetres above the table, pointing straight down at the printed sheet"
      viewBox="0 0 240 150"
      className="h-auto w-full max-w-60 shrink-0"
    >
      {/* table */}
      <line x1="12" y1="128" x2="228" y2="128" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      {/* sheet on the table */}
      <rect x="70" y="118" width="96" height="10" rx="2" fill="var(--mint)" stroke="currentColor" strokeWidth="1.5" />
      {/* stand: base, column, arm */}
      <line x1="176" y1="128" x2="212" y2="128" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <line x1="194" y1="128" x2="194" y2="34" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <line x1="194" y1="34" x2="128" y2="34" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      {/* phone, screen up, camera down */}
      <rect x="104" y="26" width="40" height="16" rx="4" fill="var(--surface)" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="118" cy="42" r="3" fill="currentColor" />
      {/* sight line straight down */}
      <line x1="118" y1="48" x2="118" y2="114" stroke="var(--amber)" strokeWidth="2" strokeDasharray="4 4" />
      <polygon points="112,110 124,110 118,118" fill="var(--amber)" />
      {/* height dimension */}
      <line x1="40" y1="40" x2="40" y2="122" stroke="currentColor" strokeWidth="1.5" />
      <line x1="34" y1="40" x2="46" y2="40" stroke="currentColor" strokeWidth="1.5" />
      <line x1="34" y1="122" x2="46" y2="122" stroke="currentColor" strokeWidth="1.5" />
      <text x="20" y="86" fontSize="13" fill="currentColor" fontFamily="inherit">
        ~50 cm
      </text>
    </svg>
  )
}

/** Screen 05 · Camera setup and calibration. Continue stays disabled until every required
 *  check passes. ArUco markers are required for the two board tasks; the arm task needs no
 *  sheet. The feed is a Panel with the live, mirrored and calibration lines in its corners. */
export function CameraSetup() {
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const exercise = sp.get('exercise') ?? 'nhpt'
  const ex = exerciseById(exercise)
  // Pendulum, Arm to the front and Arm out to the side all run the arm pipeline: no sheet.
  const kind = ex?.session ?? 'nhpt'
  const isArm = kind === 'arm'
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
            <h1 className="text-3xl">Set up camera and equipment</h1>
            <p className="text-muted">
              {isArm
                ? ex?.view === 'front'
                  ? `No sheet needed. ${ex.name}: face the camera with both shoulders and hips in view.`
                  : `No sheet needed. ${ex?.name ?? 'Arm to the front'}: sit or stand sideways to the camera with your shoulder and hip in view.`
                : `Continue unlocks when every required check passes. ${ex?.name ?? exercise}.`}
            </p>
          </div>
          {!isArm && (
            <Card padding="sm" className="flex items-center gap-4">
              <MountDiagram />
              <div className="min-w-0">
                <h2 className="text-xl">Mount the camera above the table</h2>
                <p className="text-lg text-muted">
                  Put the phone or webcam on a stand about 50 cm up, pointing straight down at the sheet. Looking across the
                  table makes pegs and hands land in the wrong place. The check below measures the tilt.
                </p>
              </div>
            </Card>
          )}
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
          <Button variant="secondary" onClick={() => nav('/details/choose')}>
            Change exercise
          </Button>
        }
        right={
          <Button disabled={!ready} onClick={() => nav(`/details/demo?exercise=${exercise}`)}>
            Continue to demonstration
          </Button>
        }
      />
    </div>
  )
}

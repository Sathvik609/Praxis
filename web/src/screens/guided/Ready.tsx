import { useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AvatarPanel } from '../../avatar/AvatarPanel'
import { guidedAvatarProps } from '../../avatar/guidedClip'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Chip } from '../../design/Chip'
import { Check } from '../../design/Icon'
import { Panel } from '../../design/Panel'
import { api, useApi } from '../../lib/api'
import { SESSION_WS_URL } from '../../lib/config'
import { CameraBlocked } from '../../session/CameraBlocked'
import { LiveIndicator } from '../../session/LiveIndicator'
import { OverlayCanvas, type CalibrationEvent, type FrameEvent } from '../../session/OverlayCanvas'
import { useWebcamStream } from '../../session/useWebcamStream'
import type { Check as SetupCheck } from '../05-camera-setup/Checklist'
import { readyHint } from './readyHint'

type SetupChecksEvent = { checks: SetupCheck[]; all_required_pass: boolean }

/** Guided path · Get ready. The camera on the left, the figure on the right, and one thing to
 *  fix at a time in the coach's words — never the setup table. There is no sheet to find: the
 *  socket runs `mode=calibrate` with `for=arm`, so the service skips the marker checks and
 *  looks for the patient instead. Go unlocks when the required checks pass. */
export function Ready() {
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const id = sp.get('exercise') ?? 'flexion'
  const { data: envelope } = useApi(() => api.profile())
  const { data: plan } = useApi(() => api.planToday())
  const profile = envelope?.profile ?? null
  const item = plan?.items.find((i) => i.id === id) ?? null
  const view = item?.view ?? 'side'

  // Built from the exercise id alone: the service reads the view from the registry, and a
  // params object that changed on every fetch would restart the camera mid-setup.
  const params = useMemo(() => ({ sheet: 'none', for: 'arm', exercise: id }), [id])
  const { camActive, events, error, start, stop, videoRef } = useWebcamStream({ wsUrl: SESSION_WS_URL, mode: 'calibrate', params })
  useEffect(() => {
    void start()
    return stop
  }, [start, stop])

  const last = <T,>(type: string) => [...events].reverse().find((e) => e.type === type) as (T & { type: string }) | undefined
  const checks = last<SetupChecksEvent>('setup_checks')
  const frame = last<FrameEvent>('frame') ?? null
  const cal = last<CalibrationEvent>('calibration') ?? null
  const ready = checks?.all_required_pass === true
  const hint = readyHint(checks?.checks ?? [], view)
  const restart = () => {
    stop()
    void start()
  }

  return (
    <div className="grid h-screen grid-rows-[4rem_minmax(0,1fr)] overflow-hidden bg-bg text-ink">
      <header className="flex h-16 shrink-0 items-center gap-4 px-8">
        <span className="font-heading text-2xl font-semibold text-teal-ink">Praxis</span>
        <span className="text-xl font-bold">{item?.name ?? 'Get ready'}</span>
        <span className="ml-auto">
          {ready ? <Chip tone="mint" icon={<Check />}>Ready</Chip> : <Chip tone="amber">Getting ready</Chip>}
        </span>
      </header>

      <main className="grid min-h-0 grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-8 px-8 pb-6">
        <Panel
          className="isolate"
          topLeft={<LiveIndicator active={camActive} />}
          topRight={<span className="text-lg">mirrored · processed on this device</span>}
          bottomLeft={<span>OpenCV 5 · pose view · no sheet needed</span>}
        >
          <video ref={videoRef} muted playsInline className="aspect-4/3 w-full -scale-x-100 object-cover" />
          <OverlayCanvas width={640} height={480} calibration={cal} frame={frame} />
          {error && (
            <div className="absolute inset-0 z-20">
              <CameraBlocked reason={/unreachable/i.test(error) ? 'service_unreachable' : 'camera_blocked'} onRetry={restart} />
            </div>
          )}
        </Panel>

        <div className="flex min-h-0 flex-col gap-4">
          <div className="mx-auto w-full max-w-[260px]">
            <AvatarPanel
              {...guidedAvatarProps(item?.id ?? id, item?.clip, {
                camera: view === 'front' ? 'front' : 'side',
                side: profile?.side ?? 'left',
                compact: true,
                aspect: '4/5',
              })}
            />
          </div>

          <Card tone={ready ? 'coach' : 'watch'}>
            <div className="text-base text-muted">Coach</div>
            <p className="text-2xl">{ready ? 'That is it — I can see you. Go when you are ready.' : (hint?.text ?? 'Getting the camera ready.')}</p>
            {ready && hint && <p className="mt-2 text-base text-muted">{hint.text}</p>}
          </Card>

          <Button full disabled={!ready} onClick={() => nav(`/go?exercise=${id}&side=${profile?.side ?? 'left'}&tier=${plan?.tier ?? 'full'}`)}>
            Go
          </Button>
          <Button variant="secondary" onClick={() => nav('/')}>Not now</Button>
        </div>
      </main>
    </div>
  )
}

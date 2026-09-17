import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AvatarPanel } from '../../avatar/AvatarPanel'
import { guidedAvatarProps } from '../../avatar/guidedClip'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Chip } from '../../design/Chip'
import { Check } from '../../design/Icon'
import { Overlay } from '../../design/Overlay'
import { Panel } from '../../design/Panel'
import { api, useApi } from '../../lib/api'
import { SESSION_WS_URL } from '../../lib/config'
import type { PraxisEvent } from '../../lib/events'
import { CameraBlocked } from '../../session/CameraBlocked'
import { LiveIndicator } from '../../session/LiveIndicator'
import { liveStatus, statusLabel } from '../../session/liveStatus'
import { OverlayCanvas, type FrameEvent } from '../../session/OverlayCanvas'
import { browserSpeak, useCoach } from '../../session/useCoach'
import { useWebcamStream } from '../../session/useWebcamStream'
import { COACH_LABEL } from '../07-session/LiveShell'
import { PainCheck, SessionOverlay } from '../07-session/SessionOverlays'
import { FeedbackOverlay } from '../08-feedback/FeedbackOverlay'
import { phaseLine, phaseOf, repProgress, type GuidedArm } from './phase'

type RepComplete = PraxisEvent & { verified: boolean }

/** Guided path · the session. You on the left, the figure on the right, one big count, one
 *  coach line and one Pause button — everything else the patient might need (rest, pain, end)
 *  lives behind that button. Reps are verified from the OpenCV events only; the figure paces
 *  and never scores. */
export function Go() {
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const exercise = sp.get('exercise') ?? 'flexion'
  const side = sp.get('side') ?? 'left'
  const tier = sp.get('tier') ?? 'full'
  const { data: envelope } = useApi(() => api.profile())
  const { data: plan } = useApi(() => api.planToday())
  const profile = envelope?.profile ?? null
  const item = plan?.items.find((i) => i.id === exercise) ?? null

  const params = useMemo(() => ({ sheet: 'none', exercise, side, tier }), [exercise, side, tier])
  const { camActive, connected, events, error, start, stop, send, videoRef } = useWebcamStream({ wsUrl: SESSION_WS_URL, mode: 'arm', params })
  const coach = useCoach(events, { speak: browserSpeak })

  useEffect(() => {
    void start()
    return stop
  }, [start, stop])

  // Today's pain goes with the session so the service's stop rules have it from the first frame.
  const sentCheckin = useRef(false)
  useEffect(() => {
    if (!connected || sentCheckin.current || !profile) return
    sentCheckin.current = true
    send({ cmd: 'checkin', pain: profile.pain_last, energy: '', minutes: 0, new_symptoms: false })
  }, [connected, profile, send])

  const [menuOpen, setMenuOpen] = useState(false)
  const [resting, setResting] = useState(false)
  const [painOpen, setPainOpen] = useState(false)
  const [endRequested, setEndRequested] = useState(false)
  const [feedbackSent, setFeedbackSent] = useState(false)

  const frame = ([...events].reverse().find((e) => e.type === 'frame') as FrameEvent | undefined) ?? null
  const a = (frame?.arm ?? null) as GuidedArm | null
  const lost = (() => {
    const last = [...events].reverse().find((e) => e.type === 'perception_lost' || e.type === 'perception_regained')
    return last?.type === 'perception_lost'
  })()
  const reps = events.filter((e) => e.type === 'rep_complete') as RepComplete[]
  const verified = reps.filter((r) => r.verified).length
  const unverified = reps.length - verified
  // Both sets done, or the patient asked to stop: the same two questions either way.
  const complete = events.find((e) => e.type === 'arm_complete')
  const feedbackOpen = !feedbackSent && (endRequested || !!complete)

  const status = liveStatus({ connected, camActive, error, replay: false, frame, lost, overlay: coach.overlay, ended: feedbackOpen })
  const label = statusLabel(status, 'arm')


  const ack = [...events].reverse().find((e) => e.type === 'command' && e.cmd === 'feedback') as (PraxisEvent & { summary?: { session_id?: string } }) | undefined
  useEffect(() => {
    if (!ack) return
    stop()
    const sid = ack.summary?.session_id
    nav(sid ? `/done/${sid}` : '/')
  }, [ack?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const end = () => {
    setMenuOpen(false)
    if (!connected) {
      stop()
      nav('/')
      return
    }
    setEndRequested(true)
  }
  const pause = () => {
    setMenuOpen(true)
    send({ cmd: 'pause' })
  }
  const resume = () => {
    setMenuOpen(false)
    setResting(false)
    send({ cmd: 'resume' })
    coach.clearOverlay()
  }

  const exertionTone = coach.exertion?.level === 'high' ? 'red' : coach.exertion?.level === 'moderate' ? 'amber' : 'mint'
  const repsPerSet = a?.reps_per_set ?? item?.reps ?? 8
  const sets = a?.sets ?? item?.sets ?? 2
  const repNow = Math.min((a?.rep ?? 0) + 1, repsPerSet)
  const phase = phaseOf(a)
  const line = coach.caption?.text ?? label.coach ?? phaseLine(a)
  // The paused overlay the service sends is the same pause this screen asked for; the menu
  // already explains it, so only the service's own states (stopped, rest) open on top.
  const serviceOverlay = menuOpen && coach.overlay?.kind === 'paused' ? null : coach.overlay

  return (
    <div className="grid h-screen grid-rows-[4rem_minmax(0,1fr)_auto] overflow-hidden bg-bg text-ink">
      <header className="flex h-16 shrink-0 items-center gap-4 px-6">
        <span className="font-heading text-2xl font-semibold text-teal-ink">Praxis</span>
        <span className="text-xl font-bold">{item?.name ?? 'Practice'}</span>
        <span className="text-base text-muted">
          Set {a?.set ?? 1} of {sets} · {verified} verified · {unverified} unverified
        </span>
        <span className="ml-auto flex items-center gap-3">
          <Chip tone={exertionTone}>Exertion: {coach.exertion?.level ?? 'low'}</Chip>
          <Chip tone={label.tone}>{label.chip}</Chip>
        </span>
      </header>

      <main className="grid min-h-0 grid-cols-2 items-center gap-6 px-6">
        <Panel
          className="isolate"
          topLeft={<LiveIndicator active={camActive} />}
          topRight={<span className="text-lg">{side} side · {phase}</span>}
          bottomLeft={<span>cv2 dnn pose · {item?.name ?? exercise} · angles are relative progress</span>}
        >
          <video ref={videoRef} muted playsInline className="aspect-4/3 w-full -scale-x-100 object-cover" />
          <OverlayCanvas width={640} height={480} calibration={null} frame={frame} />
          {(status === 'camera_blocked' || status === 'service_unreachable') && (
            <div className="absolute inset-0 z-20">
              <CameraBlocked reason={status} detail={error} onRetry={() => { stop(); void start() }} />
            </div>
          )}
        </Panel>

        <div className="flex min-h-0 flex-col gap-2">
          <div className="mx-auto w-full max-w-[320px]">
            <AvatarPanel
              {...guidedAvatarProps(item?.id ?? exercise, item?.clip, {
                camera: (item?.view ?? 'side') === 'front' ? 'front' : 'side',
                side: (profile?.side ?? side) === 'right' ? 'right' : 'left',
                compact: true,
                aspect: '4/5',
              })}
              paced={a && !a.finished ? repProgress(a) : null}
            />
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="progress through this rep" aria-valuenow={Math.round(repProgress(a) * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-teal-fill transition-[width]" style={{ width: `${Math.round(repProgress(a) * 100)}%` }} />
          </div>
        </div>
      </main>

      <footer className="flex items-center gap-6 px-6 py-4">
        <div className="shrink-0">
          <div className="whitespace-nowrap font-heading text-6xl font-semibold tabular-nums">{repNow}<span className="text-3xl font-normal text-muted"> of {repsPerSet}</span></div>
          <div className="flex items-center gap-2 text-base text-muted">
            <span>reps this set</span>
            {verified > 0 && <Chip tone="mint" icon={<Check />}>{verified} verified</Chip>}
          </div>
        </div>
        <Card tone="coach" className="min-w-0 flex-1" padding="sm">
          <p className="text-2xl">{line}</p>
          <div className="text-base text-muted">{coach.caption?.label ?? COACH_LABEL}</div>
        </Card>
        <Button className="shrink-0 px-10" onClick={pause}>Pause</Button>
      </footer>

      <Overlay open={menuOpen} title={resting ? 'Take as long as you need' : 'Paused'} description="Choose how to carry on, take a rest, tell the coach about pain, or end the session.">
        {resting ? (
          <p className="mt-3 text-2xl">Rest your arm. I will be here when you are ready.</p>
        ) : (
          <p className="mt-3 text-2xl">Nothing is being recorded. What would you like to do?</p>
        )}
        <div className="mt-8 flex flex-col gap-3">
          <Button full onClick={resume}>{resting ? 'Rested — carry on' : 'Carry on'}</Button>
          {!resting && <Button full variant="secondary" onClick={() => setResting(true)}>Take a rest</Button>}
          <Button full variant="secondary" onClick={() => { setMenuOpen(false); setPainOpen(true) }}>Pain or feel unwell</Button>
          <Button full variant="ghost" onClick={end}>End session</Button>
        </div>
      </Overlay>

      <PainCheck open={painOpen} onSubmit={(p) => { send({ cmd: 'pain', pain: p }); setPainOpen(false) }} onCancel={() => setPainOpen(false)} />
      <SessionOverlay overlay={serviceOverlay} onResume={resume} onEnd={end} />
      <FeedbackOverlay open={feedbackOpen} onSave={(f) => { send({ cmd: 'feedback', ...f }); setFeedbackSent(true) }} onSkip={() => { send({ cmd: 'feedback' }); setFeedbackSent(true) }} />
    </div>
  )
}

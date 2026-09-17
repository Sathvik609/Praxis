import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AvatarPanel } from '../../avatar/AvatarPanel'
import { Card } from '../../design/Card'
import { Chip } from '../../design/Chip'
import { ProgressDots } from '../../design/ProgressDots'
import { Stat } from '../../design/Stat'
import { SESSION_WS_URL } from '../../lib/config'
import type { PraxisEvent } from '../../lib/events'
import { latencyLine, useLatency } from '../../session/latency'
import { liveStatus, statusLabel } from '../../session/liveStatus'
import type { FrameEvent } from '../../session/OverlayCanvas'
import { useWebcamStream } from '../../session/useWebcamStream'
import { browserSpeak, useCoach } from '../../session/useCoach'
import { useSessionFlow } from '../../session/useSessionFlow'
import { FeedbackOverlay } from '../08-feedback/FeedbackOverlay'
import { COACH_LABEL, CoachCard, LiveFeed, SessionHeader } from './LiveShell'
import { ExertionChip, PainCheck, SessionOverlay } from './SessionOverlays'
import { SessionControls } from './SessionControls'
import { SetCheckIn } from './SetCheckIn'
import { TracePanel } from './TracePanel'

type ArmComplete = PraxisEvent & { sets: number; reps: number }
type RepComplete = PraxisEvent & { set: number; rep: number; peak_deg: number; hold_s: number; verified: boolean; reason: string | null; lean: boolean; hike: boolean }

/** Trunk lean above this many degrees is shown as "(leaning)" in amber; the stop rule's own
 *  threshold lives in the service. */
export const LEAN_SHOW_DEG = 12

function caption(f: FrameEvent | null, lost: boolean, lean: boolean): string {
  if (lost) return 'I cannot see your shoulder and hip. Turn your practising side to the camera.'
  if (lean) return "Sit tall — you're leaning back to lift. Lower the arm a little and lift from the shoulder."
  const a = f?.arm
  if (!a) return 'Getting the camera ready.'
  if (a.finished) return 'Both sets done. Rest your arm.'
  if (a.state === 'hold') return `Hold it there… ${Math.max(0, Math.ceil(a.hold_s * (1 - a.hold_progress)))}`
  if (a.state === 'moving') return 'Lift slowly to the line, no higher than your shoulder.'
  if (a.state === 'return') return 'Lower for three.'
  return 'Arm by your side. Lift for three when you are ready.'
}

/** Screen 07c · Live session, Arm to the front. Ghost arm shows the target; the camera
 *  measures the shoulder angle and watches for leaning. Angles are relative progress. */
export function LiveArm() {
  const [sp] = useSearchParams()
  const side = sp.get('side') ?? 'left'
  const replay = sp.get('replay')
  const params = useMemo(() => ({ sheet: 'none', side }), [side])
  const { camActive, connected, events, error, start, stop, send, videoRef } = useWebcamStream({ wsUrl: SESSION_WS_URL, mode: 'arm', params, replay })
  const [traceOpen, setTraceOpen] = useState(false)
  const [painOpen, setPainOpen] = useState(false)
  const coach = useCoach(events, { speak: browserSpeak })
  const flow = useSessionFlow(events, send, stop, connected)
  const latency = useLatency(events)

  useEffect(() => {
    void start()
    return stop
  }, [start, stop])

  const frame = ([...events].reverse().find((e) => e.type === 'frame') as FrameEvent | undefined) ?? null
  const a = frame?.arm
  const lost = (() => {
    const last = [...events].reverse().find((e) => e.type === 'perception_lost' || e.type === 'perception_regained')
    return last?.type === 'perception_lost'
  })()
  const status = liveStatus({ connected, camActive, error, replay: !!replay, frame, lost, overlay: coach.overlay, ended: flow.feedbackOpen })
  const label = statusLabel(status, 'arm')
  const live = status === 'tracking' || status === 'replay'
  const lastLean = [...events].reverse().find((e) => e.type === 'compensation_lean')
  const leanRecent = !!lastLean && (frame ? frame.t - lastLean.t < 4 : true)
  const complete = events.find((e) => e.type === 'arm_complete') as ArmComplete | undefined
  const [askedSets, setAskedSets] = useState<number[]>([])
  const setDone = [...events].reverse().find((e) => e.type === 'set_complete' && !askedSets.includes(Number(e.set))) as (PraxisEvent & { set: number }) | undefined
  const setCheckOpen = !!setDone && !complete
  const reps = events.filter((e) => e.type === 'rep_complete') as RepComplete[]

  const finish = (endedEarly: boolean) => {
    flow.finish({
        kind: 'arm', side, sets: complete?.sets ?? a?.set ?? 0, reps, ended_early: endedEarly,
        lean_count: a?.flags.lean_count ?? 0, hike_count: a?.flags.hike_count ?? 0, ceiling_deg: a?.ceiling_deg ?? 90,
      })
  }
  useEffect(() => {
    if (complete) finish(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete?.id])

  const now = a?.angle_now ?? null
  const holding = a?.state === 'hold'
  const target = a?.target_deg ?? 90
  const ceiling = a?.ceiling_deg ?? 90
  const lean = Math.round(Math.abs(a?.trunk_lean_deg ?? 0))
  const leaning = lean > LEAN_SHOW_DEG
  const repsPerSet = a?.reps_per_set ?? 8
  const holdCount = holding ? Math.ceil((a?.hold_s ?? 3) * (a?.hold_progress ?? 0)) : 0

  return (
    <div className="grid h-screen grid-rows-[4rem_minmax(0,1fr)_5rem] overflow-hidden bg-bg text-ink">
      <SessionHeader title={`Arm to the front · ${side} side`} subtitle={`Arm strengthening · set ${a?.set ?? 1} of ${a?.sets ?? 2}`} status={status} label={label} />

      <div className="grid min-h-0 grid-cols-[5fr_2fr_2fr] gap-4 p-4">
        <LiveFeed
          className="min-h-0 self-start"
          replay={!!replay}
          camActive={camActive}
          status={status}
          videoRef={videoRef}
          frame={frame}
          feedLabel={replay ? `recorded session · ${side} side` : `${side} side · ${label.feed}`}
          tracking={live ? `ghost arm shows target${frame?.arm?.angles && !frame.arm.angles.view_ok ? ' · turn your side to the camera' : ''}` : undefined}
          band={<>Shoulder {now != null ? `${Math.round(now)}°` : '—'} · target {target}° · ceiling {ceiling}°</>}
          cvLine={`cv2 dnn pose · shoulder–elbow–hip angle · trunk lean ${lean}°${frame?.pose?.present ? ` · ${frame.pose.ms ?? 0} ms` : ' · no pose'}`}
          latencyLine={latencyLine(latency)}
          onRetry={() => { stop(); void start() }}
        />

        <Card
          className="flex min-h-0 flex-col gap-3 overflow-hidden"
          padding="sm"
          title={<span className="text-lg font-body font-normal text-muted">Reference</span>}
          action={<Chip tone={holding ? 'mint' : 'neutral'}>{holding ? 'At target' : 'Lift'}</Chip>}
        >
          <div className="mx-auto w-full max-w-[288px]"><AvatarPanel clip="armFront" camera="side" compact /></div>
          <p className="text-center text-lg text-muted">side view · shoulder {now != null ? Math.round(now) : '—'}° of {target}°</p>
          <div className="flex justify-between text-lg text-muted"><span>Lift for 3</span><span>Lower for 3</span></div>
          <div className="h-3 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="hold progress" aria-valuenow={Math.round((a?.hold_progress ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-teal-fill transition-[width]" style={{ width: `${Math.round((a?.hold_progress ?? 0) * 100)}%` }} />
          </div>
          <p className="text-center text-lg text-muted">Figure paces with you. It never scores you.</p>
        </Card>

        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
          <Card title={`Rep ${Math.min((a?.rep ?? 0) + 1, repsPerSet)} of ${repsPerSet} · hold ${a?.hold_s ?? 3} s`} action={<span className="whitespace-nowrap text-lg text-muted tabular-nums">count: {holdCount}</span>}>
            <ProgressDots total={repsPerSet} done={a?.rep ?? 0} current={holding ? a?.rep : undefined} />
          </Card>
          <Card>
            <div className="grid grid-cols-3 gap-3">
              <Stat value={now != null ? `${Math.round(now)}°` : '—'} label="now" />
              <Stat value={`${Math.round(a?.best_this_set ?? 0)}°`} label="best this set" />
              <Stat value={`${lean}°`} label="trunk lean" tone={leaning ? 'amber' : 'default'} extra={leaning ? <span className="font-bold text-amber-ink">(leaning)</span> : undefined} />
            </div>
          </Card>
          {traceOpen ? (
            <div className="min-h-0 flex-1"><TracePanel events={events} replay={!!replay} /></div>
          ) : (
            <>
              <CoachCard
                watch={leanRecent}
                text={coach.caption?.text ?? (leanRecent ? caption(frame, lost, true) : label.coach ?? caption(frame, lost, false))}
                label={coach.caption?.label ?? COACH_LABEL}
              />
              <ExertionChip exertion={coach.exertion} />
            </>
          )}
        </div>
      </div>

      <SetCheckIn open={setCheckOpen} setNumber={setDone?.set ?? 1} onSubmit={(r) => { if (r !== null) send({ cmd: 'rpe', rpe: r }); setAskedSets((s) => [...s, setDone?.set ?? 0]) }} />
      <FeedbackOverlay open={flow.feedbackOpen} onSave={flow.save} onSkip={flow.skip} />
      <SessionOverlay overlay={coach.overlay} onResume={() => { send({ cmd: 'resume' }); coach.clearOverlay() }} onEnd={() => finish(true)} />
      <PainCheck open={painOpen} onSubmit={(p) => { send({ cmd: 'pain', pain: p }); setPainOpen(false) }} onCancel={() => setPainOpen(false)} />
      <SessionControls
        onPause={() => send({ cmd: 'pause' })}
        onRest={() => send({ cmd: 'pause' })}
        onPain={() => setPainOpen(true)}
        onEnd={() => finish(true)}
        traceOpen={traceOpen}
        onToggleTrace={() => setTraceOpen((v) => !v)}
      />
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AvatarPanel } from '../../avatar/AvatarPanel'
import { Chip } from '../../design/Chip'
import { ProgressDots } from '../../design/ProgressDots'
import { SESSION_WS_URL } from '../../lib/config'
import type { PraxisEvent } from '../../lib/events'
import { LiveIndicator } from '../../session/LiveIndicator'
import { OverlayCanvas, type FrameEvent } from '../../session/OverlayCanvas'
import { useWebcamStream } from '../../session/useWebcamStream'
import { browserSpeak, useCoach } from '../../session/useCoach'
import { ExertionChip, PainCheck, SessionOverlay } from './SessionOverlays'
import { SessionControls } from './SessionControls'
import { TracePanel } from './TracePanel'

type ArmComplete = PraxisEvent & { sets: number; reps: number }
type RepComplete = PraxisEvent & { set: number; rep: number; peak_deg: number; hold_s: number; verified: boolean; reason: string | null; lean: boolean; hike: boolean }

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
  const nav = useNavigate()
  const side = sp.get('side') ?? 'left'
  const params = useMemo(() => ({ sheet: 'none', side }), [side])
  const { camActive, events, error, start, stop, send, videoRef } = useWebcamStream({ wsUrl: SESSION_WS_URL, mode: 'arm', params })
  const [traceOpen, setTraceOpen] = useState(false)
  const [painOpen, setPainOpen] = useState(false)
  const coach = useCoach(events, { speak: browserSpeak })

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
  const lastLean = [...events].reverse().find((e) => e.type === 'compensation_lean')
  const leanRecent = !!lastLean && (frame ? frame.t - lastLean.t < 4 : true)
  const complete = events.find((e) => e.type === 'arm_complete') as ArmComplete | undefined
  const reps = events.filter((e) => e.type === 'rep_complete') as RepComplete[]

  const finish = (endedEarly: boolean) => {
    stop()
    nav('/report', {
      state: {
        kind: 'arm', side, sets: complete?.sets ?? a?.set ?? 0, reps, ended_early: endedEarly,
        lean_count: a?.flags.lean_count ?? 0, hike_count: a?.flags.hike_count ?? 0, ceiling_deg: a?.ceiling_deg ?? 90,
      },
    })
  }
  useEffect(() => {
    if (complete) finish(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete?.id])

  const now = a?.angle_now ?? null
  const holding = a?.state === 'hold'

  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <header className="flex h-20 items-center gap-6 border-b border-line bg-surface px-6">
        <span className="font-heading text-2xl font-semibold text-teal">Praxis</span>
        <span className="text-xl font-bold">Arm to the front · {side} side</span>
        <span className="text-muted">Arm strengthening · set {a?.set ?? 1} of {a?.sets ?? 2}</span>
        <span className="ml-auto flex items-center gap-4">
          <LiveIndicator active={camActive} />
          <Chip tone={lost ? 'amber' : 'mint'}>{lost ? 'Tracking lost' : 'Tracking ready'}</Chip>
        </span>
      </header>

      <div className="grid flex-1 grid-cols-[5fr_2fr_2fr] gap-6 p-6">
        <div className="relative overflow-hidden rounded-3xl bg-[var(--stage-a)] text-white">
          <div className="absolute left-4 top-3 z-10 text-white/80">
            <span className="mr-2 inline-block h-3 w-3 rounded-full bg-red" />
            <b>You</b> · ghost arm shows target{frame?.arm?.angles && !frame.arm.angles.view_ok ? ' · turn your side to the camera' : ''}
          </div>
          <video ref={videoRef} muted playsInline className="aspect-4/3 w-full -scale-x-100 object-cover" />
          <OverlayCanvas width={640} height={480} calibration={null} frame={frame} />
          <div className="absolute bottom-10 left-4 text-2xl font-bold text-amber">
            Shoulder {now != null ? `${Math.round(now)}°` : '—'} · target {a?.target_deg ?? 90}° · ceiling {a?.ceiling_deg ?? 90}°
          </div>
          <div className="absolute bottom-3 left-4 text-white/80">
            cv2 dnn pose · shoulder–elbow–hip angle · trunk lean <b>{Math.round(Math.abs(a?.trunk_lean_deg ?? 0))}°</b>{frame?.pose?.present ? ` · ${frame.pose.ms ?? 0} ms` : ' · no pose'}
          </div>
          {error && <div className="absolute inset-x-4 top-12 rounded-xl bg-red p-3">{error}</div>}
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-center gap-2">
            <span className="text-muted">Reference · {holding ? 'at target' : 'lift'}</span>
            <span className="ml-auto rounded-full bg-teal px-4 py-2 font-bold text-white">Avatar</span>
          </div>
          <AvatarPanel clip="armFront" camera="side" compact />
          <p className="text-center text-muted">side view · shoulder {now != null ? Math.round(now) : '—'}° of {a?.target_deg ?? 90}°</p>
          <div className="flex justify-between text-muted"><span>Lift for 3</span><span>Lower for 3</span></div>
          <div className="h-3 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-teal transition-[width]" style={{ width: `${Math.round((a?.hold_progress ?? 0) * 100)}%` }} />
          </div>
          <p className="text-center text-muted">Figure paces with you. It never scores you.</p>
          {traceOpen && <TracePanel events={events} />}
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="flex justify-between">
              <span className="text-xl font-bold">Rep {Math.min((a?.rep ?? 0) + 1, a?.reps_per_set ?? 8)} of {a?.reps_per_set ?? 8} · hold {a?.hold_s ?? 3}</span>
              <span className="text-muted">count: {holding ? Math.ceil((a?.hold_s ?? 3) * (a?.hold_progress ?? 0)) : 0}</span>
            </div>
            <div className="mt-3"><ProgressDots total={a?.reps_per_set ?? 8} done={a?.rep ?? 0} current={holding ? a?.rep : undefined} /></div>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-line bg-surface p-5">
            <div><div className="text-3xl font-bold">{now != null ? `${Math.round(now)}°` : '—'}</div><div className="text-muted">now</div></div>
            <div><div className="text-3xl font-bold">{`${Math.round(a?.best_this_set ?? 0)}°`}</div><div className="text-muted">best this set</div></div>
            <div><div className={`text-3xl font-bold ${Math.abs(a?.trunk_lean_deg ?? 0) > 12 ? 'text-amber' : ''}`}>{`${Math.round(Math.abs(a?.trunk_lean_deg ?? 0))}°`}</div><div className="text-muted">trunk lean</div></div>
          </div>
          <div className={`rounded-2xl border-l-8 p-6 ${leanRecent ? 'border-amber bg-amber/10' : 'border-teal bg-mint/10'}`}>
            <div className="text-muted">Coach{leanRecent ? ' · posture' : ''}</div>
            <p className="text-2xl">{coach.caption?.text ?? caption(frame, lost, leanRecent)}</p>
            <div className="mt-2 text-sm text-muted">{coach.caption?.label ?? 'Rule-based coach · LLM agent pending'}</div>
          </div>
          <ExertionChip exertion={coach.exertion} />
        </div>
      </div>

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

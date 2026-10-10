import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AvatarPanel } from '../../avatar/AvatarPanel'
import { RefAvatar, demoRequested, refMode } from '../../avatar/RefAvatar'
import { SESSION_WS_URL } from '../../lib/config'
import type { PraxisEvent } from '../../lib/events'
import { readCheckinPain, tierFor } from '../../lib/plan'
import { plural } from '../../lib/plural'
import { exerciseById } from '../../lib/seed'
import { coachLabel } from '../../session/agent'
import { latencyLine, useLatency } from '../../session/latency'
import { liveStatus, statusLabel } from '../../session/liveStatus'
import type { FrameEvent } from '../../session/OverlayCanvas'
import { useEventHistory } from '../../session/eventHistory'
import { browserSpeak, useCoach } from '../../session/useCoach'
import { useCoachPrompt } from '../../session/useCoachPrompt'
import { useRestBreak } from '../../session/useRestBreak'
import { useSessionFlow, type EndReason, type StopEnd } from '../../session/useSessionFlow'
import { useWebcamStream } from '../../session/useWebcamStream'
import { FeedbackOverlay } from '../08-feedback/FeedbackOverlay'
import { LivePrompt } from './LivePrompt'
import { SessionHeader, SxBar, SxCoach, SxEndDialog, SxFeed, SxHold, SxRef, SxStats, sxHold, useHoldSeconds, useSxSession } from './SessionChrome'
import { ExertionChip, PainCheck, SessionOverlay, overlayEndReason } from './SessionOverlays'
import { SetCheckIn } from './SetCheckIn'
import { TracePanel } from './TracePanel'

type ArmComplete = PraxisEvent & { sets: number; reps: number }
type RepComplete = PraxisEvent & { set: number; rep: number; peak_deg: number; hold_s: number; verified: boolean; reason: string | null; lean: boolean; hike: boolean; above_ceiling?: boolean }

/** Trunk lean above this many degrees is shown as "leaning" in amber; the stop rule's own
 *  threshold lives in the service. */
export const LEAN_SHOW_DEG = 12

/** The cue a recent event asks for: trunk lean (posture) or a lift past the ceiling (range). */
type Cue = 'lean' | 'ceiling' | null

function caption(f: FrameEvent | null, lost: boolean, cue: Cue, view: 'side' | 'front', swing: boolean): string {
  if (lost) return statusLabel('lost', 'arm', view).coach ?? ''
  if (cue === 'lean') return "Sit tall — you're leaning back to lift. Lower the arm a little and lift from the shoulder."
  if (cue === 'ceiling') return 'Stop at shoulder height — no higher than the line.'
  const a = f?.arm
  if (!a) return 'Getting the camera ready.'
  if (a.finished) return 'Both sets done. Rest your arm.'
  if (swing) return a.state === 'start_pose' ? 'Lean on the table and let the arm hang loose.' : "Let it swing, loose and easy — don't lift it."
  if (a.state === 'hold') return `Hold it there… ${Math.max(0, Math.ceil(a.hold_s * (1 - a.hold_progress)))}`
  if (a.state === 'moving') return 'Lift slowly to the line, no higher than your shoulder.'
  if (a.state === 'return') return 'Lower for three.'
  return 'Arm by your side. Lift for three when you are ready.'
}

/** Screen 07c · Live session for the camera-coached arm exercise of the 28 Sep lock, Arm out to
 *  the side (front view), in the designers' 6 Oct session layout (`sx-*`): camera with the
 *  shoulder band | reference figure (or the trace), coach | progress, fixed control bar. The
 *  swing and side-view branches serve the hidden, dormant entries and never run while those stay
 *  hidden. The registry entry on the service decides the metric, view gate and dose; the pain
 *  tier from the check-in is sent as `tier` (the service applies the check-in's tier itself and
 *  never loosens it). Angles are camera-relative progress. The reference figure is a metronome
 *  whose mode and demonstration come from events (`refMode`, `demoRequested`); it never scores. */
export function LiveArm() {
  const [sp] = useSearchParams()
  const side = sp.get('side') ?? 'left'
  const replay = sp.get('replay')
  const ex = exerciseById(sp.get('exercise')) ?? exerciseById('abduction')!
  const exId = ex.session === 'arm' ? ex.serviceId : 'abduction'
  const tier = tierFor(readCheckinPain()) === 'gentle' ? 'gentle' : 'full'
  const params = useMemo(() => ({ sheet: 'none', side, exercise: exId, tier }), [side, exId, tier])
  const { camActive, connected, events: recent, sessionId, error, start, stop, send, videoRef } = useWebcamStream({ wsUrl: SESSION_WS_URL, mode: 'arm', params, replay })
  // One-off events (reps, set ends, stops) outlive the socket's 200-event window here.
  const events = useEventHistory(recent)
  const [traceOpen, setTraceOpen] = useState(false)
  const [painOpen, setPainOpen] = useState(false)
  const ui = useSxSession()
  // Spoken cues follow Settings > Spoken instructions; captions stay on while the coach speaks.
  const coach = useCoach(events, { speak: browserSpeak, voice: ui.spoken })
  const rest = useRestBreak(send, coach.clearOverlay)
  const stopped = coach.overlay?.kind === 'stopped'
  const flow = useSessionFlow(events, send, stop, connected)
  const latency = useLatency(recent)
  const cp = useCoachPrompt(events, coach.prompt, coach.dismissPrompt, send)

  useEffect(() => {
    void start()
    return stop
  }, [start, stop])

  const frame = ([...events].reverse().find((e) => e.type === 'frame') as FrameEvent | undefined) ?? null
  const a = frame?.arm
  const lastT = events.length ? events[events.length - 1].t : null
  const lost = (() => {
    const last = [...events].reverse().find((e) => e.type === 'perception_lost' || e.type === 'perception_regained')
    return last?.type === 'perception_lost'
  })()
  const status = liveStatus({ connected, camActive, error, replay: !!replay, frame, lost, overlay: coach.overlay, ended: flow.feedbackOpen })
  const live = status === 'tracking' || status === 'replay'
  const lastLean = [...events].reverse().find((e) => e.type === 'compensation_lean')
  const leanRecent = !!lastLean && (frame ? frame.t - lastLean.t < 4 : true)
  // A lift past the in-code ceiling (service `above_ceiling`, 10 Oct): shown like the lean cue.
  const lastAbove = [...events].reverse().find((e) => e.type === 'above_ceiling')
  const aboveRecent = !!lastAbove && (frame ? frame.t - lastAbove.t < 4 : true)
  const cue: Cue = leanRecent ? 'lean' : aboveRecent ? 'ceiling' : null
  const complete = events.find((e) => e.type === 'arm_complete') as ArmComplete | undefined
  const [askedSets, setAskedSets] = useState<number[]>([])
  const setDone = [...events].reverse().find((e) => e.type === 'set_complete' && !askedSets.includes(Number(e.set))) as (PraxisEvent & { set: number }) | undefined
  const setCheckOpen = !!setDone && !complete
  const reps = events.filter((e) => e.type === 'rep_complete') as RepComplete[]

  const finish = (endedEarly: boolean, reason?: EndReason | StopEnd) => {
    flow.finish(endedEarly, reason, {
      kind: 'arm', name: ex.name, side, sets: complete?.sets ?? a?.set ?? 0, reps, ended_early: endedEarly,
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
  const view: 'side' | 'front' = a?.view_required ?? ex.view ?? 'side'
  const label = statusLabel(status, 'arm', view)
  const swing = (a?.kind ?? (ex.id === 'pendulum' ? 'oscillation' : 'hold')) === 'oscillation'
  const turnHint = view === 'front' ? ' · face the camera' : ' · turn your side to the camera'
  const wrongView = !!frame?.arm?.angles && (view === 'front' ? frame.arm.angles.view_ok : !frame.arm.angles.view_ok)
  const hold = sxHold(coach, rest, stopped, flow.feedbackOpen, finish, send, cp)
  const holdSeconds = useHoldSeconds(hold, lastT)
  const verifiedLifts = Math.max(0, (a?.reps_total ?? 0) - (a?.unverified_total ?? 0))
  const repNow = a?.rep ?? 0
  const noun = swing ? 'swing' : 'lift'
  const running = { target_deg: a?.target_deg, hold_s: a?.hold_s, reps: a?.reps_per_set }
  const poseTail = `trunk lean ${lean}°${frame?.pose?.present ? ` · ${frame.pose.ms ?? 0} ms` : ' · no pose'}`
  const pipeline = `cv2 dnn pose · shoulder–elbow–hip angle · ${poseTail}`
  const lastRep = reps[reps.length - 1]
  const tone = lost ? 'neutral' : lastRep && frame && frame.t - lastRep.t < 2 && lastRep.verified !== false ? 'mint' : undefined

  const coachCard = (
    <SxCoach
      captions={ui.captions}
      watch={cue !== null}
      eyebrow={cue === 'ceiling' ? 'Coach · range' : undefined}
      tone={tone}
      caption={coach.caption?.text ?? (cue ? caption(frame, lost, cue, view, swing) : label.coach ?? caption(frame, lost, null, view, swing))}
      label={coach.caption ? coachLabel(coach.caption) : coach.ruleLabel}
      source={coach.captionSource}
    />
  )

  return (
    <div className="sx-root">
      <SessionHeader
        title={`${ex.name} · ${side} side`}
        sub={`${ex.category} · ${hold.open ? 'paused' : `set ${a?.set ?? 1} of ${a?.sets ?? 2}`}`}
        status={status}
        label={label}
        live={camActive && !replay}
        replay={!!replay}
        agent={coach.agent}
      />
      <main className="sx-grid">
        <SxFeed
          errorDetail={error}
          replay={!!replay}
          camActive={camActive}
          status={status}
          videoRef={videoRef}
          frame={frame}
          note={live ? `ghost arm shows target${wrongView ? turnHint : ''}` : label.feed}
          band={live && now != null ? `Shoulder ${Math.round(now)}° · target ${target}°` : null}
          bandTone={holding ? 'mint' : 'amber'}
          mono={`cv2 dnn pose · shoulder–elbow–hip · ${poseTail} · ceiling ${ceiling}°`}
          onRetry={() => { stop(); void start() }}
        >
          <SxHold
            open={hold.open}
            kind={hold.kind}
            title={hold.title}
            text={hold.text}
            seconds={holdSeconds}
            primary={hold.primary}
            onEnd={hold.onEnd}
            note={hold.note}
            prompt={hold.prompt ? <LivePrompt state={cp} running={running} /> : null}
            resumeByPrompt={hold.resumeByPrompt}
          />
        </SxFeed>

        {traceOpen ? (
          <div className="sx-panel sx-trace">
            <TracePanel events={recent} sessionId={sessionId} replay={!!replay} pipeline={[pipeline, latencyLine(latency)]} />
          </div>
        ) : !swing ? (
          <RefAvatar
            clip={ex.clip}
            side={side}
            mode={refMode(events, frame, hold, frame?.t ?? lastT ?? 0)}
            demoAt={demoRequested(events)}
            holdS={a?.hold_s ?? 3}
            limitDeg={target}
            repsPerSet={repsPerSet}
            setKey={a?.set ?? 1}
          />
        ) : (
          <SxRef dim={hold.open} tag={hold.open ? 'Reference · paused' : 'Reference · swing'}>
            <AvatarPanel bare overlayTop={40} clip={ex.clip} camera={view} side={side === 'right' ? 'right' : 'left'} paced={a && !a.finished && !hold.open ? (a.rep_progress ?? null) : null} />
          </SxRef>
        )}

        {/* The agent's dose prompt sits in the coach slot, never over the camera, so reps keep counting. */}
        {cp.prompt && !hold.prompt ? (
          <div className="flex min-h-0 flex-col gap-3">
            <LivePrompt state={cp} running={running} />
            {coachCard}
          </div>
        ) : (
          coachCard
        )}

        <SxStats
          metricLabel={swing ? 'Swing' : 'Rep'}
          metric={Math.min(repNow + 1, repsPerSet)}
          unit={`of ${repsPerSet}`}
          metricSub={`set ${a?.set ?? 1} of ${a?.sets ?? 2}${swing ? '' : ` · hold ${a?.hold_s ?? 3} s`}`}
          head={holding ? `Holding · ${holdCount} of ${a?.hold_s ?? 3}` : `${verifiedLifts} ${plural(verifiedLifts, noun)} verified`}
          headRight={`${a?.unverified_total ?? 0} unverified`}
          dots={{ label: `${repNow} of ${repsPerSet} done this set`, items: Array.from({ length: repsPerSet }, (_, i) => (i < repNow ? 'done' : i === repNow && holding ? 'now' : 'todo')) }}
          extra={
            <>
              <div className="sx-minis">
                <div><b>{`${Math.round(a?.best_this_set ?? 0)}°`}</b><span>best this set</span></div>
                <div className={leaning ? 'sx-warn' : ''}><b>{`${lean}°`}</b><span>{leaning ? 'trunk lean · leaning' : 'trunk lean'}</span></div>
              </div>
              <ExertionChip exertion={coach.exertion} compact />
            </>
          }
          verified={verifiedLifts}
          unverified={a?.unverified_total ?? 0}
        />
      </main>

      <SetCheckIn open={setCheckOpen} setNumber={setDone?.set ?? 1} onSubmit={(r) => { if (r !== null) send({ cmd: 'rpe', rpe: r }); setAskedSets((s) => [...s, setDone?.set ?? 0]) }} />
      <FeedbackOverlay open={flow.feedbackOpen} early={flow.early} onSave={flow.save} onSkip={flow.skip} />
      <SessionOverlay overlay={stopped && !flow.feedbackOpen ? coach.overlay : null} onResume={() => { send({ cmd: 'resume' }); coach.clearOverlay() }} onEnd={() => finish(true, overlayEndReason(coach.overlay))} />
      <PainCheck open={painOpen} onSubmit={(p) => { send({ cmd: 'pain', pain: p }); setPainOpen(false) }} onCancel={() => setPainOpen(false)} />
      <SxBar
        onPause={() => send({ cmd: 'pause' })}
        onRest={rest.start}
        onPain={() => setPainOpen(true)}
        onEnd={ui.openEnd}
        traceOpen={traceOpen}
        onTrace={() => setTraceOpen((v) => !v)}
        captions={ui.captions}
        captionsLocked={ui.captionsLocked}
        onCaptions={ui.toggleCaptions}
        volume={ui.volume}
        onVolume={ui.setVolume}
        resting={rest.since != null || !!coach.overlay}
      />
      <SxEndDialog
        open={ui.endOpen}
        done={verifiedLifts}
        noun={noun}
        onClose={ui.closeEnd}
        onPain={() => { ui.closeEnd(); setPainOpen(true) }}
        onEnd={(reason) => { ui.closeEnd(); finish(true, reason) }}
      />
    </div>
  )
}

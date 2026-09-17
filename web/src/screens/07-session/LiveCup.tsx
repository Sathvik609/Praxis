import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AvatarPanel } from '../../avatar/AvatarPanel'
import { Chip } from '../../design/Chip'
import { ProgressDots } from '../../design/ProgressDots'
import { SESSION_WS_URL } from '../../lib/config'
import type { PraxisEvent } from '../../lib/events'
import { LiveIndicator } from '../../session/LiveIndicator'
import { liveStatus, statusLabel } from '../../session/liveStatus'
import { OverlayCanvas, type FrameEvent } from '../../session/OverlayCanvas'
import { useWebcamStream } from '../../session/useWebcamStream'
import { ProgressionPrompt } from './ProgressionPrompt'
import { browserSpeak, useCoach } from '../../session/useCoach'
import { useSessionFlow } from '../../session/useSessionFlow'
import { FeedbackOverlay } from '../08-feedback/FeedbackOverlay'
import { ExertionChip, PainCheck, SessionOverlay } from './SessionOverlays'
import { SessionControls } from './SessionControls'
import { TracePanel } from './TracePanel'

type ArcComplete = PraxisEvent & { arc: number; phase: string; mean_reach_ms: number | null; unverified: number; awaiting_phase: boolean }
type CupComplete = PraxisEvent & { arcs: number; reaches: unknown[] }

function caption(f: FrameEvent | null, lost: boolean): string {
  if (lost) return 'I lost the sheet. Keep all four corner markers in view.'
  if (!f?.cup) return 'Getting the camera ready.'
  const c = f.cup
  if (c.dot == null) return 'Place the cup on dot 1, then rest your hand in your lap.'
  if (c.finished) return 'All four arcs done. Lovely work.'
  if (c.awaiting_phase) return 'Two slow arcs verified. Take a breath while you decide about the fast arcs.'
  if (c.state === 'placed' || c.state === 'over_dot') return `Onto dot ${(c.dot ?? 0) + 1} — good. Let your hand come back to your lap before the next reach.`
  if (c.expected_next != null) return `Reach and move the cup to dot ${c.expected_next + 1}, one at a time.`
  return 'Nice and steady.'
}

/** Screen 07b · Live session, Waiter – cup (GRASP coordination). Reps are verified from the
 *  camera; the avatar (Phase 6) is a pacing reference only. */
export function LiveCup() {
  const [sp] = useSearchParams()
  const side = sp.get('side') ?? 'left'
  const replay = sp.get('replay')
  const params = useMemo(() => ({ sheet: 'cup_targets' }), [])
  const { camActive, connected, events, error, start, stop, send, videoRef } = useWebcamStream({ wsUrl: SESSION_WS_URL, mode: 'cup', params, replay })
  const [traceOpen, setTraceOpen] = useState(false)
  const [painOpen, setPainOpen] = useState(false)
  const coach = useCoach(events, { speak: browserSpeak })
  const flow = useSessionFlow(events, send, stop, connected)
  const [whyOpen, setWhyOpen] = useState(false)
  const [declined, setDeclined] = useState(false)

  useEffect(() => {
    void start()
    return stop
  }, [start, stop])

  const frame = ([...events].reverse().find((e) => e.type === 'frame') as FrameEvent | undefined) ?? null
  const cup = frame?.cup
  const lost = (() => {
    const last = [...events].reverse().find((e) => e.type === 'perception_lost' || e.type === 'perception_regained')
    return last?.type === 'perception_lost'
  })()
  const status = liveStatus({ connected, camActive, error, replay: !!replay, frame, lost, overlay: coach.overlay, ended: flow.feedbackOpen })
  const label = statusLabel(status, 'cup')
  const live = status === 'tracking' || status === 'replay'
  const lastArc = [...events].reverse().find((e) => e.type === 'arc_complete') as ArcComplete | undefined
  const complete = events.find((e) => e.type === 'cup_complete') as CupComplete | undefined
  const showPrompt = (!!coach.prompt || (!!cup?.awaiting_phase && cup.phase === 'slow')) && !declined

  const finish = (endedEarly: boolean) => {
    flow.finish({
        kind: 'cup', side, arcs: complete?.arcs ?? cup?.arcs_done ?? 0,
        reaches: complete?.reaches ?? [], ended_early: endedEarly,
      })
  }
  useEffect(() => {
    if (complete) finish(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete?.id])

  const planned = cup?.arcs_planned ?? { slow: 2, fast: 2 }
  const arcLabel = cup ? `arc ${Math.min(cup.arc_index, cup.phase === 'slow' ? planned.slow : planned.slow + planned.fast) - (cup.phase === 'fast' ? planned.slow : 0)} of ${cup.phase === 'slow' ? planned.slow : planned.fast} ${cup.phase}` : 'arc 1 of 2 slow'
  const dotsDone = cup?.dots_in_arc.length ?? 0
  const unverified = cup?.unverified_total ?? 0

  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <header className="flex h-20 items-center gap-6 border-b border-line bg-surface px-6">
        <span className="font-heading text-2xl font-semibold text-teal">Praxis</span>
        <span className="text-xl font-bold">Waiter – cup · {side} side</span>
        <span className="text-muted">Coordination · {arcLabel}</span>
        <span className="ml-auto flex items-center gap-4">
          <LiveIndicator active={camActive} replay={!!replay} />
          <Chip tone={label.tone}>{label.chip}</Chip>
        </span>
      </header>

      <div className="grid flex-1 grid-cols-[5fr_3fr_3fr] gap-6 p-6">
        <div className="flex flex-col gap-4">
          <div className="relative overflow-hidden rounded-3xl bg-[var(--stage-a)] text-white">
            <div className="absolute left-4 top-3 z-10 text-white/80">
              <span className={`mr-2 inline-block h-3 w-3 rounded-full ${replay ? 'bg-amber' : 'bg-red'}`} />
              <b>You</b> · {live ? `${frame?.hand?.present ? 'hand tracked' : 'hand not in view'} · ${frame?.overlay.cup_px ? 'cup tracked' : 'cup not seen'}` : label.feed}
            </div>
            {replay ? <div className="flex aspect-4/3 w-full items-center justify-center text-white/60">Replay · recorded clip runs on the service; frames are not sent to the browser</div> : <video ref={videoRef} muted playsInline className="aspect-4/3 w-full -scale-x-100 object-cover" />}
            <OverlayCanvas width={640} height={480} calibration={null} frame={frame} />
            <div className="absolute bottom-3 left-4 text-white/80">
              {!live ? label.feed : cup?.dot != null ? `cup over dot ${cup.dot + 1} · hand ${cup.hand_clear ? 'clear' : 'not clear'}` : 'place the cup on dot 1'}
            </div>
            {error && <div className="absolute inset-x-4 top-12 rounded-xl bg-red p-3">{error}</div>}
          </div>
          <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface px-6 py-4">
            <ProgressDots total={5} done={dotsDone} current={cup?.expected_next ?? undefined} />
            <span className="ml-auto text-muted">
              {dotsDone} of 5 dots · {unverified} unverified{unverified ? ' (hand covered cup or markers lost)' : ''}
            </span>
          </div>
          <div className="rounded-2xl border-l-8 border-teal bg-mint/10 p-6">
            <div className="text-muted">Coach</div>
            <p className="text-2xl">{coach.caption?.text ?? label.coach ?? caption(frame, lost)}</p>
            <div className="mt-2 text-sm text-muted">{coach.caption?.label ?? 'Rule-based coach · LLM agent pending'}</div>
          </div>
          <ExertionChip exertion={coach.exertion} />
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-center gap-2">
            <span className="text-muted">Reference</span>
            <span className="ml-auto rounded-full bg-teal px-4 py-2 font-bold text-white">Avatar</span>
          </div>
          <AvatarPanel clip="cup" compact />
          <p className="text-center text-muted">ideal path · dot {cup?.dot != null ? cup.dot + 1 : 1} → {cup?.expected_next != null ? cup.expected_next + 1 : 2}</p>
        </div>

        <div className="flex flex-col gap-4">
          {showPrompt && (
            <ProgressionPrompt
              reason={`Two clean slow arcs${lastArc?.mean_reach_ms ? `, mean reach ${(lastArc.mean_reach_ms / 1000).toFixed(1)} s` : ''}${lastArc?.unverified ? `, ${lastArc.unverified} unverified` : ', no unverified reaches'}.`}
              onAccept={() => { send(coach.prompt ? { cmd: 'answer', prompt: coach.prompt.id, choice: 'Yes, go faster' } : { cmd: 'set_phase', phase: 'fast' }); coach.dismissPrompt() }}
              onDecline={() => { if (coach.prompt) send({ cmd: 'answer', prompt: coach.prompt.id, choice: 'Keep pace' }); coach.dismissPrompt(); setDeclined(true) }}
              onWhy={() => setWhyOpen((v) => !v)}
              whyOpen={whyOpen}
            />
          )}
          {traceOpen ? (
            <TracePanel events={events} />
          ) : (
            <div className="rounded-2xl border border-line bg-surface p-6">
              <div className="text-muted">This session</div>
              <div className="text-3xl font-bold">{cup?.reaches_total ?? 0} reaches</div>
              <div className="text-muted">{(cup?.reaches_total ?? 0) - unverified} verified · {unverified} unverified · {cup?.arcs_done ?? 0} arcs done</div>
            </div>
          )}
        </div>
      </div>

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

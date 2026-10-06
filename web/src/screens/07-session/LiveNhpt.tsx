import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AvatarPanel } from '../../avatar/AvatarPanel'
import { SESSION_WS_URL } from '../../lib/config'
import type { PraxisEvent } from '../../lib/events'
import { coachLabel } from '../../session/agent'
import { latencyLine, useLatency } from '../../session/latency'
import { liveStatus, statusLabel } from '../../session/liveStatus'
import type { FrameEvent } from '../../session/OverlayCanvas'
import { browserSpeak, useCoach } from '../../session/useCoach'
import { useCoachPrompt } from '../../session/useCoachPrompt'
import { useRestBreak } from '../../session/useRestBreak'
import { useSessionFlow, type EndReason } from '../../session/useSessionFlow'
import { useWebcamStream } from '../../session/useWebcamStream'
import { FeedbackOverlay } from '../08-feedback/FeedbackOverlay'
import { BoardView } from './BoardView'
import { LivePrompt } from './LivePrompt'
import { SessionHeader, SxBar, SxCoach, SxEndDialog, SxFeed, SxHold, SxRef, SxStats, sxHold, useHoldSeconds, useSxSession } from './SessionChrome'
import { ExertionChip, PainCheck, SessionOverlay } from './SessionOverlays'
import { TracePanel } from './TracePanel'

type NhptComplete = PraxisEvent & { total_s: number; splits_s: number[]; pegs: unknown[] }

function caption(f: FrameEvent | null, lost: boolean): string {
  if (lost) return 'I lost the board. Keep all four corner markers in view.'
  if (!f) return 'Getting the camera ready.'
  if (!f.nhpt?.started) return 'Pick up the first peg when you are ready. The timer starts on your first lift.'
  if (f.nhpt?.completed) return 'All nine seated. Nicely done.'
  return 'Nice and steady. Timer is running — no need to rush.'
}

/** Screen 07 · Live session, Nine-Hole Peg Test (assessment mode), in the designers' 6 Oct
 *  session layout (`sx-*`): camera | reference figure with the board inset (tap a seated hole to
 *  sample its peg colour), coach | progress (elapsed, seated, next hole, verified · unverified,
 *  last peg split, exertion chip), fixed control bar. Timer starts at the first peg lift and
 *  stops at the ninth seated peg; pegs are verified from OpenCV events only. */
export function LiveNhpt() {
  const [sp] = useSearchParams()
  const hand = sp.get('hand') ?? 'left'
  const replay = sp.get('replay')
  const params = useMemo(() => ({ sheet: 'nhpt_board' }), [])
  const { camActive, connected, events, sessionId, error, start, stop, send, videoRef } = useWebcamStream({
    wsUrl: SESSION_WS_URL,
    mode: 'nhpt',
    params,
    replay,
  })
  const [traceOpen, setTraceOpen] = useState(false)
  const [painOpen, setPainOpen] = useState(false)
  const ui = useSxSession()
  // Spoken cues follow Settings > Spoken instructions; captions stay on while the coach speaks.
  const coach = useCoach(events, { speak: browserSpeak, voice: ui.spoken })
  const rest = useRestBreak(send, coach.clearOverlay)
  const stopped = coach.overlay?.kind === 'stopped'
  const flow = useSessionFlow(events, send, stop, connected)
  const latency = useLatency(events)
  const cp = useCoachPrompt(events, coach.prompt, coach.dismissPrompt, send)

  useEffect(() => {
    void start()
    return stop
  }, [start, stop])

  const frame = ([...events].reverse().find((e) => e.type === 'frame') as FrameEvent | undefined) ?? null
  const lastT = events.length ? events[events.length - 1].t : null
  const lost = (() => {
    const last = [...events].reverse().find((e) => e.type === 'perception_lost' || e.type === 'perception_regained')
    return last?.type === 'perception_lost'
  })()
  const status = liveStatus({ connected, camActive, error, replay: !!replay, frame, lost, overlay: coach.overlay, ended: flow.feedbackOpen })
  const label = statusLabel(status, 'nhpt')
  const live = status === 'tracking' || status === 'replay'
  const complete = events.find((e) => e.type === 'nhpt_complete') as NhptComplete | undefined

  const finish = (endedEarly: boolean, reason?: EndReason) => {
    flow.finish(endedEarly, reason, {
      kind: 'nhpt',
      hand,
      total_s: complete?.total_s ?? frame?.nhpt?.total_s ?? null,
      splits_s: complete?.splits_s ?? [],
      pegs: complete?.pegs ?? [],
      pegs_done: frame?.nhpt?.pegs_done ?? 0,
      ended_early: endedEarly,
    })
  }

  useEffect(() => {
    if (complete) finish(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete?.id])

  const pegsDone = frame?.nhpt?.pegs_done ?? 0
  // Occupancy is the peg test's verification; a peg is unverified only when the service says so
  // (`unverified_total`) or a rep_complete arrives with `verified: false`.
  const pegsUnverified = Number((frame?.nhpt as { unverified_total?: number } | undefined)?.unverified_total ?? events.filter((e) => e.type === 'rep_complete' && e.verified === false).length)
  const unv = Math.min(pegsDone, pegsUnverified)
  const lastSplitEv = [...events].reverse().find((e) => e.type === 'nhpt_split')
  const lastSplit = lastSplitEv ? Number(lastSplitEv.split_s) : null
  const nextHole = frame?.overlay.next_hole ?? null
  const elapsed = frame?.nhpt?.elapsed_s ?? 0
  const started = !!frame?.nhpt?.started
  const handSeen = frame?.models?.hand ? (frame.hand?.present ? 'hand tracked' : 'hand not in view') : null
  const hold = sxHold(coach, rest, stopped, flow.feedbackOpen, finish, send, cp)
  const holdSeconds = useHoldSeconds(hold, lastT)
  const pipe = `cv2 5.0 · findContours + HoughCircles occupancy${frame?.board?.hole_source ? ` · holes: ${frame.board.hole_source}` : ''}${frame?.models?.hand ? ' · dnn hand' : ' · hand model off'}${frame?.proc_ms ? ` · ${Math.min(99, Math.round(1000 / Math.max(frame.proc_ms, 1)))} fps max` : ''}`

  const coachCard = (
    <SxCoach
      captions={ui.captions}
      caption={coach.caption?.text ?? label.coach ?? caption(frame, lost)}
      label={coach.caption ? coachLabel(coach.caption) : coach.ruleLabel}
      source={coach.captionSource}
    />
  )

  return (
    <div className="sx-root">
      <SessionHeader
        title={`Nine-Hole Peg Test · ${hand} hand`}
        sub={`Assessment · ${hold.open ? 'paused' : 'attempt 1 of 1'}`}
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
          note={live ? [`${hand} hand`, 'board tracking', handSeen].filter(Boolean).join(' · ') : label.feed}
          mono={pipe}
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
            prompt={hold.prompt ? <LivePrompt state={cp} running={{}} /> : null}
            resumeByPrompt={hold.resumeByPrompt}
          />
        </SxFeed>

        {traceOpen ? (
          <div className="sx-panel sx-trace">
            <TracePanel events={events} sessionId={sessionId} replay={!!replay} pipeline={[pipe, latencyLine(latency)]} />
          </div>
        ) : (
          <SxRef
            dim={hold.open}
            tag={hold.open ? 'Reference · paused' : 'Reference'}
            footer={
              <div className="sx-board-inset">
                <BoardView
                  occupancy={frame?.board?.occupancy ?? {}}
                  nextHole={nextHole}
                  onSampleHole={replay ? undefined : (k) => send({ cmd: 'sample_colour', hole: k })}
                  sampled={!!frame?.board?.colour}
                />
              </div>
            }
          >
            <AvatarPanel bare overlayTop={40} clip="nhpt" />
          </SxRef>
        )}

        {cp.prompt && !hold.prompt ? (
          <div className="flex min-h-0 flex-col gap-3">
            <LivePrompt state={cp} running={{}} />
            {coachCard}
          </div>
        ) : (
          coachCard
        )}

        <SxStats
          metricLabel="Elapsed"
          metric={elapsed.toFixed(1)}
          unit="s"
          metricSub={started ? 'from first peg lift' : 'waits for first peg lift'}
          head={`${pegsDone} of 9 seated`}
          headRight={nextHole != null ? `next: hole ${nextHole + 1}` : !frame?.calibrated ? 'sheet not in view' : pegsDone >= 9 ? 'board full' : 'any hole'}
          dots={{ label: `${pegsDone} of 9 pegs seated`, items: Array.from({ length: 9 }, (_, i) => (i < pegsDone ? 'done' : i === pegsDone && started ? 'now' : 'todo')) }}
          extra={<ExertionChip exertion={coach.exertion} compact />}
          verified={pegsDone - unv}
          unverified={unv}
          sub={lastSplit != null ? `last peg ${lastSplit.toFixed(1)} s` : undefined}
        />
      </main>

      <FeedbackOverlay open={flow.feedbackOpen} early={flow.early} onSave={flow.save} onSkip={flow.skip} />
      <SessionOverlay overlay={stopped && !flow.feedbackOpen ? coach.overlay : null} onResume={() => { send({ cmd: 'resume' }); coach.clearOverlay() }} onEnd={() => finish(true)} />
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
        done={pegsDone - unv}
        noun="peg"
        onClose={ui.closeEnd}
        onPain={() => { ui.closeEnd(); setPainOpen(true) }}
        onEnd={(reason) => { ui.closeEnd(); finish(true, reason) }}
      />
    </div>
  )
}

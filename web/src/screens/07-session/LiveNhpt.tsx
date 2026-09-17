import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AvatarPanel } from '../../avatar/AvatarPanel'
import { Card } from '../../design/Card'
import { Pill } from '../../design/Pill'
import { ProgressDots } from '../../design/ProgressDots'
import { Stat } from '../../design/Stat'
import { SESSION_WS_URL } from '../../lib/config'
import type { PraxisEvent } from '../../lib/events'
import { liveStatus, statusLabel } from '../../session/liveStatus'
import type { FrameEvent } from '../../session/OverlayCanvas'
import { useWebcamStream } from '../../session/useWebcamStream'
import { BoardView } from './BoardView'
import { browserSpeak, useCoach } from '../../session/useCoach'
import { useSessionFlow } from '../../session/useSessionFlow'
import { FeedbackOverlay } from '../08-feedback/FeedbackOverlay'
import { COACH_LABEL, CoachCard, LiveFeed, SessionHeader } from './LiveShell'
import { ExertionChip, PainCheck, SessionOverlay } from './SessionOverlays'
import { SessionControls } from './SessionControls'
import { TracePanel } from './TracePanel'

type NhptComplete = PraxisEvent & { total_s: number; splits_s: number[]; pegs: unknown[] }

function caption(f: FrameEvent | null, lost: boolean): string {
  if (lost) return 'I lost the board. Keep all four corner markers in view.'
  if (!f) return 'Getting the camera ready.'
  if (!f.nhpt?.started) return 'Pick up the first peg when you are ready. The timer starts on your first lift.'
  if (f.nhpt?.completed) return 'All nine seated. Nicely done.'
  return 'Nice and steady. Timer is running — no need to rush.'
}

/** Screen 07 · Live session, Nine-Hole Peg Test (assessment mode). Timer starts at the first
 *  peg lift and stops at the ninth seated peg; reps are verified from OpenCV events only. */
export function LiveNhpt() {
  const [sp] = useSearchParams()
  const hand = sp.get('hand') ?? 'left'
  const replay = sp.get('replay')
  const params = useMemo(() => ({ sheet: 'nhpt_board' }), [])
  const { camActive, connected, events, error, start, stop, send, videoRef } = useWebcamStream({
    wsUrl: SESSION_WS_URL,
    mode: 'nhpt',
    params,
    replay,
  })
  const [traceOpen, setTraceOpen] = useState(false)
  const [painOpen, setPainOpen] = useState(false)
  const coach = useCoach(events, { speak: browserSpeak })
  const flow = useSessionFlow(events, send, stop, connected)
  const [reference, setReference] = useState<'avatar' | 'board'>('board')

  useEffect(() => {
    void start()
    return stop
  }, [start, stop])

  const frame = ([...events].reverse().find((e) => e.type === 'frame') as FrameEvent | undefined) ?? null
  const lost = (() => {
    const last = [...events].reverse().find((e) => e.type === 'perception_lost' || e.type === 'perception_regained')
    return last?.type === 'perception_lost'
  })()
  const status = liveStatus({ connected, camActive, error, replay: !!replay, frame, lost, overlay: coach.overlay, ended: flow.feedbackOpen })
  const label = statusLabel(status, 'nhpt')
  const live = status === 'tracking' || status === 'replay'
  const complete = events.find((e) => e.type === 'nhpt_complete') as NhptComplete | undefined

  const finish = (endedEarly: boolean) => {
    flow.finish({
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
  const nextHole = frame?.overlay.next_hole ?? null
  const elapsed = frame?.nhpt?.elapsed_s ?? 0
  const handSeen = frame?.models?.hand ? (frame.hand?.present ? 'hand tracked' : 'hand not in view') : null

  return (
    <div className="grid h-screen grid-rows-[4rem_minmax(0,1fr)_5rem] overflow-hidden bg-bg text-ink">
      <SessionHeader title={`Nine-Hole Peg Test · ${hand} hand`} subtitle="Assessment · attempt 1 of 1" status={status} label={label} />

      <div className="grid min-h-0 grid-cols-[5fr_3fr_3fr] gap-4 p-4">
        <LiveFeed
          className="min-h-0 self-start"
          replay={!!replay}
          camActive={camActive}
          status={status}
          videoRef={videoRef}
          frame={frame}
          feedLabel={replay ? `recorded session · ${hand} hand` : `${hand} hand · ${label.feed}`}
          tracking={live ? ['board tracking', handSeen].filter(Boolean).join(' · ') : undefined}
          cvLine={
            <>
              cv2 5.0 · findContours + HoughCircles occupancy{frame?.board?.hole_source ? ` · holes: ${frame.board.hole_source}` : ''}
              {frame?.models?.hand ? ' · dnn hand' : ' · hand model off'}
              {frame?.proc_ms ? ` · ${Math.min(99, Math.round(1000 / Math.max(frame.proc_ms, 1)))} fps max` : ''}
            </>
          }
          onRetry={() => { stop(); void start() }}
        />

        <Card
          className="flex min-h-0 flex-col gap-4 overflow-hidden"
          padding="sm"
          title={<span className="text-lg font-body font-normal text-muted">Reference</span>}
          action={
            <Pill
              size="sm"
              ariaLabel="Reference view"
              value={reference}
              onChange={setReference}
              options={[
                { value: 'avatar', label: 'Avatar' },
                { value: 'board', label: 'Board view' },
              ]}
            />
          }
        >
          {reference === 'avatar' ? (
            <div className="mx-auto w-full max-w-[288px]"><AvatarPanel clip="nhpt" compact /></div>
          ) : (
            <BoardView occupancy={frame?.board?.occupancy ?? {}} nextHole={nextHole} />
          )}
          <div className="mt-auto">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <span className="text-xl">
                <b>{pegsDone} of 9</b> seated
              </span>
              <span className="text-lg text-muted">{nextHole != null ? `next: hole ${nextHole + 1}` : frame?.calibrated ? 'board full' : 'sheet not in view'}</span>
            </div>
            <ProgressDots total={9} done={pegsDone} current={nextHole ?? undefined} />
          </div>
        </Card>

        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
          <Card>
            <div className="flex flex-col items-center">
              <Stat size="xl" value={elapsed.toFixed(1)} unit="s" label={frame?.nhpt?.started ? 'started at first peg lift' : 'waiting for first peg lift'} />
            </div>
          </Card>
          {traceOpen ? (
            <div className="min-h-0 flex-1"><TracePanel events={events} replay={!!replay} /></div>
          ) : (
            <>
              <CoachCard text={coach.caption?.text ?? label.coach ?? caption(frame, lost)} label={coach.caption?.label ?? COACH_LABEL} />
              <ExertionChip exertion={coach.exertion} />
            </>
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

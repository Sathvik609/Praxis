import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Chip } from '../../design/Chip'
import { ProgressDots } from '../../design/ProgressDots'
import { SESSION_WS_URL } from '../../lib/config'
import type { PraxisEvent } from '../../lib/events'
import { LiveIndicator } from '../../session/LiveIndicator'
import { OverlayCanvas, type FrameEvent } from '../../session/OverlayCanvas'
import { useWebcamStream } from '../../session/useWebcamStream'
import { BoardView } from './BoardView'
import { SessionControls } from './SessionControls'
import { TracePanel } from './TracePanel'

type NhptComplete = PraxisEvent & { total_s: number; splits_s: number[]; pegs: unknown[] }

function caption(f: FrameEvent | null, lost: boolean): string {
  if (lost) return 'I lost the board. Keep all four corner markers in view.'
  if (!f) return 'Getting the camera ready.'
  if (!f.nhpt.started) return 'Pick up the first peg when you are ready. The timer starts on your first lift.'
  if (f.nhpt.completed) return 'All nine seated. Nicely done.'
  return 'Nice and steady. Timer is running — no need to rush.'
}

/** Screen 07 · Live session, Nine-Hole Peg Test (assessment mode). Timer starts at the first
 *  peg lift and stops at the ninth seated peg; reps are verified from OpenCV events only. */
export function LiveNhpt() {
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const hand = sp.get('hand') ?? 'left'
  const params = useMemo(() => ({ sheet: 'nhpt_board' }), [])
  const { camActive, events, error, start, stop, videoRef } = useWebcamStream({
    wsUrl: SESSION_WS_URL,
    mode: 'nhpt',
    params,
  })
  const [traceOpen, setTraceOpen] = useState(false)
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
  const complete = events.find((e) => e.type === 'nhpt_complete') as NhptComplete | undefined

  const finish = (endedEarly: boolean) => {
    stop()
    nav('/report', {
      state: {
        kind: 'nhpt',
        hand,
        total_s: complete?.total_s ?? frame?.nhpt.total_s ?? null,
        splits_s: complete?.splits_s ?? [],
        pegs: complete?.pegs ?? [],
        pegs_done: frame?.nhpt.pegs_done ?? 0,
        ended_early: endedEarly,
      },
    })
  }

  useEffect(() => {
    if (complete) finish(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete?.id])

  const pegsDone = frame?.nhpt.pegs_done ?? 0
  const nextHole = frame?.overlay.next_hole ?? null
  const elapsed = frame?.nhpt.elapsed_s ?? 0

  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <header className="flex h-20 items-center gap-6 border-b border-line bg-surface px-6">
        <span className="font-heading text-2xl font-semibold text-teal">Praxis</span>
        <span className="text-xl font-bold">Nine-Hole Peg Test · {hand} hand</span>
        <span className="text-muted">Assessment · attempt 1 of 1</span>
        <span className="ml-auto flex items-center gap-4">
          <LiveIndicator active={camActive} />
          <Chip tone={lost ? 'amber' : 'mint'}>{lost ? 'Tracking lost' : 'Tracking ready'}</Chip>
        </span>
      </header>

      <div className="grid flex-1 grid-cols-[5fr_3fr_3fr] gap-6 p-6">
        <div className="relative overflow-hidden rounded-3xl bg-[var(--stage-a)] text-white">
          <div className="absolute left-4 top-3 z-10 text-white/80">
            <span className="mr-2 inline-block h-3 w-3 rounded-full bg-red" />
            <b>You</b> · {hand} hand · board tracking
          </div>
          <video ref={videoRef} muted playsInline className="aspect-4/3 w-full -scale-x-100 object-cover" />
          <OverlayCanvas width={640} height={480} calibration={null} frame={frame} />
          <div className="absolute bottom-3 left-4 text-white/80">
            cv2 5.0 · findContours + HoughCircles occupancy{frame?.board?.hole_source ? ` · holes: ${frame.board.hole_source}` : ''}
            {frame?.models?.hand ? ` · dnn hand${frame.hand?.present ? ' ✓' : ''}` : ' · hand model off'}
            {frame?.proc_ms ? ` · ${Math.min(99, Math.round(1000 / Math.max(frame.proc_ms, 1)))} fps max` : ''}
          </div>
          {error && <div className="absolute inset-x-4 top-12 rounded-xl bg-red p-3">{error}</div>}
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-center gap-2">
            <span className="text-muted">Reference</span>
            <div className="ml-auto flex gap-1 rounded-full border border-line p-1">
              {(['avatar', 'board'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={reference === r}
                  onClick={() => setReference(r)}
                  className={`h-10 rounded-full px-4 font-bold ${reference === r ? 'bg-teal text-white' : 'text-ink'}`}
                >
                  {r === 'avatar' ? 'Avatar' : 'Board view'}
                </button>
              ))}
            </div>
          </div>
          {reference === 'avatar' ? (
            <div className="flex aspect-square items-center justify-center rounded-2xl bg-[var(--stage-a)] p-6 text-center text-white/70">
              Avatar reference arrives in Phase 6. It never scores you; reps are verified from the camera.
            </div>
          ) : (
            <BoardView occupancy={frame?.board?.occupancy ?? {}} nextHole={nextHole} />
          )}
          {traceOpen && <TracePanel events={events} />}
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-line bg-surface p-6 text-center">
            <div className="text-muted">Elapsed</div>
            <div className="font-heading text-6xl">
              <span>{elapsed.toFixed(1)}</span>
              <span className="text-2xl"> s</span>
            </div>
            <div className="text-muted">{frame?.nhpt.started ? 'started at first peg lift' : 'waiting for first peg lift'}</div>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-6">
            <div className="mb-3 flex justify-between">
              <span>
                <b>{pegsDone} of 9</b> seated
              </span>
              <span className="text-muted">{nextHole != null ? `next: hole ${nextHole + 1}` : frame?.calibrated ? 'board full' : 'sheet not in view'}</span>
            </div>
            <ProgressDots total={9} done={pegsDone} current={nextHole ?? undefined} />
          </div>
          <div className="rounded-2xl border-l-8 border-teal bg-mint/10 p-6">
            <div className="text-muted">Coach</div>
            <p className="text-2xl">{caption(frame, lost)}</p>
            <div className="mt-2 text-sm text-muted">Rule-based captions · coach pending (Phase 7)</div>
          </div>
        </div>
      </div>

      <SessionControls
        onPause={() => stop()}
        onRest={() => stop()}
        onPain={() => finish(true)}
        onEnd={() => finish(true)}
        traceOpen={traceOpen}
        onToggleTrace={() => setTraceOpen((v) => !v)}
      />
    </div>
  )
}

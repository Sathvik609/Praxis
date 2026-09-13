import { useState } from 'react'
import { CamOnIndicator } from './CamOnIndicator'
import { HoleOverlay } from './HoleOverlay'
import type { FrameEvent, PerceptionLostEvent, SessionEvent } from '../lib/events'
import { formatElapsed, humanState } from '../lib/format'

export interface SessionViewProps {
  mode: 'calibrate' | 'pegboard' | 'nhpt'
  frame: FrameEvent | null
  events: SessionEvent[]
  camActive: boolean
  videoRef: React.RefObject<HTMLVideoElement | null>
  videoSize: { width: number; height: number }
  onStop: () => void
  onPain: () => void
  connectionError?: string | null
}

function lastLost(events: SessionEvent[]): PerceptionLostEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'perception_lost') return e as PerceptionLostEvent
  }
  return null
}

/** Screen 08 Session, v0. Body text >= 24px in session. Stop / pain controls are always visible. */
export function SessionView(props: SessionViewProps) {
  const { mode, frame, events, camActive, videoRef, videoSize, onStop, onPain, connectionError } = props
  const [showTrace, setShowTrace] = useState(false)
  const f = frame
  const calibrated = !!f?.calibrated && !f?.paused
  const lost = f?.paused ? lastLost(events) : null
  const nhpt = f?.nhpt ?? null
  const state = f?.fsm?.state ?? null
  const trace = events.filter((e) => e.type !== 'frame' && e.type !== 'heartbeat').slice(-100).reverse()

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 pb-40 text-2xl">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold">{mode === 'nhpt' ? 'Nine-Hole Peg Test' : mode === 'pegboard' ? 'Pegboard transfer' : 'Calibration'}</h1>
          {state && (
            <span data-testid="state-badge" className="rounded-full bg-blue-100 px-4 py-1 text-xl font-semibold text-blue-900">
              {humanState(state)}
            </span>
          )}
        </div>
        <CamOnIndicator active={camActive} />
      </header>

      {f?.paused && (
        <div role="alert" className="rounded-2xl border-2 border-amber-500 bg-amber-50 p-4 text-amber-900">
          <b>Tracking lost.</b>{' '}
          {lost ? `Markers ${lost.missing_ids.join(', ')} are out of view. ` : ''}
          Session paused until all four corner markers are visible.
        </div>
      )}
      {!f?.paused && f && !f.calibrated && (
        <div className="rounded-2xl border-2 border-slate-300 bg-white p-4 text-slate-800">
          Show all four corner markers to the camera to start.
        </div>
      )}
      {connectionError && (
        <div role="alert" className="rounded-2xl border-2 border-red-500 bg-red-50 p-4 text-red-900">{connectionError}</div>
      )}

      <section className="grid gap-4 md:grid-cols-[3fr_2fr]">
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video ref={videoRef} muted playsInline className="aspect-4/3 w-full object-fill" />
          <HoleOverlay overlay={f?.overlay ?? null} frameSize={videoSize} occupancy={f?.occupancy} />
        </div>
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-baseline justify-between">
            <span>Reps</span>
            <span data-testid="rep-count" className="text-5xl font-bold tabular-nums">{f?.fsm?.reps ?? 0}</span>
          </div>
          {nhpt && (
            <div className="flex items-baseline justify-between">
              <span>Time</span>
              <span data-testid="nhpt-timer" className="text-5xl font-bold tabular-nums">
                {formatElapsed(nhpt.completed && nhpt.total_s !== null ? nhpt.total_s : nhpt.elapsed_s)}
              </span>
            </div>
          )}
          {nhpt?.completed && <div className="text-green-800 font-semibold">NHPT complete · {nhpt.pegs_done} pegs</div>}
          {f?.fsm?.target !== null && f?.fsm?.target !== undefined && (
            <div className="flex items-baseline justify-between">
              <span>Target hole</span>
              <span className="text-4xl font-bold text-yellow-600">{f.fsm.target}</span>
            </div>
          )}
          <div className="text-lg text-slate-600">
            {calibrated ? 'Board locked' : 'Not calibrated'} · frame {f?.frame_index ?? '—'}
          </div>
          <button
            onClick={() => setShowTrace((v) => !v)}
            className="min-h-14 rounded-xl border border-slate-300 text-xl"
            aria-expanded={showTrace}
          >
            {showTrace ? 'Hide trace' : 'Show trace'}
          </button>
        </div>
      </section>

      {showTrace && (
        <section data-testid="trace-panel" className="rounded-2xl border border-slate-200 bg-slate-900 p-4 font-mono text-sm text-slate-100">
          <div className="mb-2 text-slate-400">OpenCV event → decision → action (newest first)</div>
          <ul className="max-h-72 overflow-auto">
            {trace.map((e, i) => (
              <li key={`${e.t}-${i}`} className="border-b border-slate-800 py-1">
                <span className="text-slate-400">{e.t.toFixed(3)}</span> <b>{e.type}</b>{' '}
                {JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'type' && k !== 't')))}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-14 z-10 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-3">
          <button onClick={onPain} className="min-h-14 rounded-2xl bg-red-600 text-2xl font-bold text-white">
            I'm in pain
          </button>
          <button onClick={onStop} className="min-h-14 rounded-2xl bg-slate-800 text-2xl font-bold text-white">
            Stop session
          </button>
        </div>
      </div>
    </div>
  )
}

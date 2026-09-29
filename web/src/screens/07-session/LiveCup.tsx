import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AvatarPanel } from '../../avatar/AvatarPanel'
import { Card } from '../../design/Card'
import { Chip } from '../../design/Chip'
import { SESSION_WS_URL } from '../../lib/config'
import type { PraxisEvent } from '../../lib/events'
import { latencyLine, useLatency } from '../../session/latency'
import { liveStatus, statusLabel } from '../../session/liveStatus'
import type { FrameEvent } from '../../session/OverlayCanvas'
import { useWebcamStream } from '../../session/useWebcamStream'
import { coachLabel, isWhy, type Prompt } from '../../session/agent'
import { browserSpeak, useCoach } from '../../session/useCoach'
import { useCoachPrompt } from '../../session/useCoachPrompt'
import { useSessionFlow } from '../../session/useSessionFlow'
import { FeedbackOverlay } from '../08-feedback/FeedbackOverlay'
import { CoachCard, LiveFeed, SessionHeader, VerifiedTally } from './LiveShell'
import { CoachPrompt } from './CoachPrompt'
import { LivePrompt, pausedNote } from './LivePrompt'
import { readGuidance } from '../../session/guidance'
import { useRestBreak } from '../../session/useRestBreak'
import { ExertionChip, PainCheck, RestOverlay, SessionOverlay } from './SessionOverlays'
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
  if (c.state === 'placed' || c.state === 'over_dot') return `Cup on dot ${c.dot + 1} — good. Let your hand come back to your lap${c.expected_next != null ? `, then reach for dot ${c.expected_next + 1}` : ''}.`
  if (c.expected_next != null) return `Reach and move the cup to dot ${c.expected_next + 1}, one at a time.`
  return 'Nice and steady.'
}

/** The screen's own progression prompt (wireframe 07b) for a service that has not sent one. */
const LOCAL_PROGRESSION: Prompt = { id: 'progression', kind: 'progression', title: 'Coach suggests: try the fast arcs', text: '', options: ['Yes, go faster', 'Keep pace', 'Why?'], within_prescription: true }
const LOCAL_WHY =
  'Your program (Hospital GRASP L2) assigns 2 slow arcs then 2 fast arcs. The camera verified the slow arcs, so the fast arcs are the next step your therapist planned. Nothing goes above the prescribed level.'

/** Where the cup is on the five-dot sheet and where it goes next, from the same snapshot that
 *  draws the ring on the video (one source; a count of dots visited used to disagree with the
 *  reach count). Numbers inside the dots carry the meaning, not the fill. */
function CupDots({ dot, next }: { dot: number | null; next: number | null }) {
  const label = dot == null ? 'Cup not on a dot yet' : `Cup on dot ${dot + 1}${next != null ? `, next dot ${next + 1}` : ''}`
  return (
    <div role="img" aria-label={label} className="flex gap-2">
      {[0, 1, 2, 3, 4].map((k) => (
        <span
          key={k}
          aria-hidden
          className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-base font-bold ${k === dot ? 'border-teal-fill bg-teal-fill text-white' : k === next ? 'border-amber-ink bg-tint-amber text-amber-ink' : 'border-line bg-surface text-muted'}`}
        >
          {k + 1}
        </span>
      ))}
    </div>
  )
}

/** Screen 07b · Live session, Waiter – cup (GRASP coordination). Reps are verified from the
 *  camera; the avatar is a pacing reference only. */
export function LiveCup() {
  const [sp] = useSearchParams()
  const side = sp.get('side') ?? 'left'
  const replay = sp.get('replay')
  const params = useMemo(() => ({ sheet: 'cup_targets' }), [])
  const { camActive, connected, events, error, start, stop, send, videoRef } = useWebcamStream({ wsUrl: SESSION_WS_URL, mode: 'cup', params, replay })
  const [traceOpen, setTraceOpen] = useState(false)
  const [painOpen, setPainOpen] = useState(false)
  // Spoken cues follow Settings > Spoken instructions; captions are always on screen.
  const [spoken] = useState(() => readGuidance().spoken)
  const coach = useCoach(events, { speak: browserSpeak, voice: spoken })
  const rest = useRestBreak(send, coach.clearOverlay)
  const stopped = coach.overlay?.kind === 'stopped'
  const flow = useSessionFlow(events, send, stop, connected)
  const latency = useLatency(events)
  const cp = useCoachPrompt(events, coach.prompt, coach.dismissPrompt, send)
  const [localWhy, setLocalWhy] = useState(false)
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
  // The service's prompt when there is one; otherwise the screen's own progression prompt once
  // the slow arcs are verified (kept from before the coach sent prompts).
  const localProgression = !coach.prompt && !!cup?.awaiting_phase && cup.phase === 'slow' && !declined
  const overlayShown = rest.since != null && !stopped ? null : coach.overlay
  const promptInOverlay = !!cp.prompt && !!overlayShown && overlayShown.kind !== 'stopped'

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
  const unverified = cup?.unverified_total ?? 0
  const reaches = cup?.reaches_total ?? 0

  return (
    <div className="grid h-screen grid-rows-[4rem_minmax(0,1fr)_5rem] overflow-hidden bg-bg text-ink">
      <SessionHeader title={`Waiter – cup · ${side} side`} subtitle={`Coordination · ${arcLabel}`} status={status} label={label} agent={coach.agent} />

      <div className="grid min-h-0 grid-cols-[5fr_3fr_3fr] gap-4 p-4">
        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
          <LiveFeed
          errorDetail={error}
            replay={!!replay}
            camActive={camActive}
            status={status}
            videoRef={videoRef}
            frame={frame}
            feedLabel={replay ? `recorded session · ${side} side` : `${side} side · ${label.feed}`}
            tracking={live ? `${frame?.hand?.present ? 'hand tracked' : 'hand not in view'} · ${frame?.overlay.cup_px ? 'cup tracked' : 'cup not seen'}` : undefined}
            onRetry={() => { stop(); void start() }}
          />
          <Card padding="sm" className="flex items-center gap-4">
            <CupDots dot={cup?.dot ?? null} next={cup?.expected_next ?? null} />
            <span className="ml-auto text-lg text-muted">
              {cup?.dot != null ? `Cup on dot ${cup.dot + 1}` : 'Cup not on a dot yet'}{cup?.expected_next != null ? ` · next: dot ${cup.expected_next + 1}` : ''} · {unverified} unverified{unverified ? ' (hand covered cup or markers lost)' : ''}
            </span>
          </Card>
        </div>

        <Card
          className="flex min-h-0 flex-col gap-4 overflow-hidden"
          padding="sm"
          title={<span className="text-lg font-body font-normal text-muted">Reference</span>}
          action={<Chip tone="neutral">Pacing only</Chip>}
        >
          <div className="mx-auto w-full max-w-[288px]"><AvatarPanel clip="cup" compact /></div>
          <p className="text-center text-lg text-muted">ideal path · dot {cup?.dot != null ? cup.dot + 1 : 1} → {cup?.expected_next != null ? cup.expected_next + 1 : 2}</p>
        </Card>

        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
          {cp.prompt && !promptInOverlay && (
            <LivePrompt
              state={cp}
              running={{ phase: cup?.phase }}
              onChoose={(c, i) => {
                // an answered progression never falls back to the screen's own prompt
                if (!isWhy(c) && cp.prompt?.kind === 'progression') setDeclined(true)
                cp.choose(c, i)
              }}
            />
          )}
          {localProgression && (
            <CoachPrompt
              prompt={{
                ...LOCAL_PROGRESSION,
                text: `Two clean slow arcs${lastArc?.mean_reach_ms ? `, mean reach ${(lastArc.mean_reach_ms / 1000).toFixed(1)} s` : ''}${lastArc?.unverified ? `, ${lastArc.unverified} unverified` : ', no unverified reaches'}.`,
              }}
              onChoose={(_c, i) => {
                if (i === 0) send({ cmd: 'set_phase', phase: 'fast' })
                else if (i === 1) setDeclined(true)
                else setLocalWhy((v) => !v)
              }}
              whyOpen={localWhy}
              whyText={LOCAL_WHY}
            />
          )}
          {/* Captions for all speech (CLAUDE.md §1): the coach card stays with the trace open. */}
          <CoachCard text={coach.caption?.text ?? label.coach ?? caption(frame, lost)} label={coach.caption ? coachLabel(coach.caption) : coach.ruleLabel} source={coach.captionSource} />
          {traceOpen ? (
            <>
              <VerifiedTally compact total={reaches} unverified={unverified} noun="reach" />
              <div className="min-h-0 flex-1">
                <TracePanel
                  events={events}
                  replay={!!replay}
                  pipeline={[`cv2 5.0 · HSV cup on the warped sheet${!live ? '' : cup?.dot != null ? ` · cup over dot ${cup.dot + 1} · hand ${cup.hand_clear ? 'clear' : 'not clear'}` : ' · place the cup on dot 1'}`, latencyLine(latency)]}
                />
              </div>
            </>
          ) : (
            <>
              <VerifiedTally total={reaches} unverified={unverified} noun="reach" note={`${cup?.arcs_done ?? 0} of ${planned.slow + planned.fast} arcs done · counts come from the camera, never the avatar`} />
              <ExertionChip exertion={coach.exertion} />
            </>
          )}
        </div>
      </div>

      <FeedbackOverlay open={flow.feedbackOpen} onSave={flow.save} onSkip={flow.skip} />
      <SessionOverlay
        overlay={overlayShown}
        note={pausedNote(coach.decisions, overlayShown)}
        prompt={promptInOverlay ? <LivePrompt state={cp} running={{ phase: cup?.phase }} /> : null}
        resumeByPrompt={promptInOverlay && cp.prompt?.kind === 'resume'}
        onResume={() => { send({ cmd: 'resume' }); coach.clearOverlay() }} onEnd={() => finish(true)} />
      <RestOverlay since={stopped || flow.feedbackOpen ? null : rest.since} onResume={rest.end} onEnd={() => { rest.cancel(); finish(true) }} />
      <PainCheck open={painOpen} onSubmit={(p) => { send({ cmd: 'pain', pain: p }); setPainOpen(false) }} onCancel={() => setPainOpen(false)} />
      <SessionControls
        onPause={() => send({ cmd: 'pause' })}
        onRest={rest.start}
        onPain={() => setPainOpen(true)}
        onEnd={() => finish(true)}
        traceOpen={traceOpen}
        onToggleTrace={() => setTraceOpen((v) => !v)}
      />
    </div>
  )
}

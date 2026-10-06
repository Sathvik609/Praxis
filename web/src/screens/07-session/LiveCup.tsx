import { useEffect, useId, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CupRef, type CupRefMode } from '../../avatar/CupRef'
import { SESSION_WS_URL } from '../../lib/config'
import { demoUrl, nextExercise, readDay } from '../../lib/day'
import type { PraxisEvent } from '../../lib/events'
import { readCheckinPain, tierFor } from '../../lib/plan'
import { plural } from '../../lib/plural'
import { exerciseById } from '../../lib/seed'
import { coachLabel, isWhy, promptKind, type Prompt } from '../../session/agent'
import { latencyLine, useLatency } from '../../session/latency'
import { liveStatus, statusLabel } from '../../session/liveStatus'
import type { FrameEvent } from '../../session/OverlayCanvas'
import { browserSpeak, useCoach } from '../../session/useCoach'
import { useCoachPrompt } from '../../session/useCoachPrompt'
import { useRestBreak } from '../../session/useRestBreak'
import { useSessionFlow, type EndReason, type Then } from '../../session/useSessionFlow'
import { useWebcamStream } from '../../session/useWebcamStream'
import { FeedbackOverlay } from '../08-feedback/FeedbackOverlay'
import { cupActiveS, cupArc, cupBand, cupDots, cupProgressFacts } from './cupView'
import { LivePrompt } from './LivePrompt'
import { SessionHeader, SxBar, SxCoach, SxEndDialog, SxFeed, SxHold, SxStats, sxClock, sxHold, useHoldSeconds, useSxSession, type DotState } from './SessionChrome'
import { ExertionChip, PainCheck, SessionOverlay } from './SessionOverlays'
import { TracePanel } from './TracePanel'

type CupComplete = PraxisEvent & { arcs: number; reaches: { verified?: boolean }[] }

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

/** The screen's own progression prompt for a service that has not sent one. */
const LOCAL_PROGRESSION: Prompt = { id: 'progression', kind: 'progression', title: 'Coach suggests: try the fast arcs', text: '', options: ['Yes, go faster', 'Keep pace', 'Why?'], within_prescription: true }
/** Seconds a coach correction keeps the coach card amber and the figure dimmed. */
const CUE_S = 4

/** "Ready to go faster?" in the artifact's cup modal (`cup-modal`). It says what the camera saw
 *  (verified slow reaches, how much faster the second slow arc was, the check-in pain) and the
 *  real rule the coach follows (`coach/rules.py` `cup_progress`). The fast arcs start only on
 *  yes; the session is not blocked meanwhile (`awaiting_phase` does not stop counting), so the
 *  artifact's "won't start until you answer" line is not shown. */
function ProgressionModal({ prompt, basis, whyOpen, whyText, onChoose }: { prompt: Prompt; basis: string; whyOpen: boolean; whyText: string | null; onChoose: (choice: string, index: number) => void }) {
  const id = useId()
  return (
    <div className="sx-scrim cup-scrim">
      <div className="sx-modal cup-modal" role="dialog" aria-modal aria-labelledby={`${id}-t`}>
        <div className="cup-modal-h">
          <h2 id={`${id}-t`}>Ready to go faster?</h2>
          <span className="cup-tag">Inside your program</span>
        </div>
        <p className="cup-modal-p">Two slow arcs done. The fast arcs are the next step your therapist planned at this level.</p>
        <p className="cup-basis">{basis}</p>
        {whyOpen && (
          <ul className="cup-why">
            {whyText ? (
              <li>{whyText}</li>
            ) : (
              <>
                <li>Both slow arcs are done, with at most one unverified reach in the last one</li>
                <li>Your prescription allows the fast arcs (Hospital GRASP L2 · Waiter – cup)</li>
                <li>Nothing goes above the prescribed level; you can keep the slow pace</li>
              </>
            )}
          </ul>
        )}
        <div className="cup-modal-actions">
          {prompt.options.map((o, i) => (
            <button key={o} type="button" className={`sx-btn ${i === 0 ? 'sx-btn-primary' : 'sx-btn-secondary'}`} aria-expanded={isWhy(o) ? whyOpen : undefined} onClick={() => onChoose(o, i)}>
              {o}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Screen 07b · Live session, Waiter – cup (GRASP coordination), in the designers' 6 Oct cup
 *  look (`sx-*` + `cup-*`) on the real cup FSM: camera with the placement band, the cup
 *  reference figure pointing at the next dot, coach card (correction tone), progress card, the
 *  progression modal from the coach's prompt (or the screen's fallback) and the done modal.
 *  Placements are verified from the camera only; the figure never scores. */
export function LiveCup() {
  const [sp] = useSearchParams()
  const side = sp.get('side') === 'right' ? 'right' : 'left'
  const replay = sp.get('replay')
  const params = useMemo(() => ({ sheet: 'cup_targets' }), [])
  const { camActive, connected, events, sessionId, error, start, stop, send, videoRef } = useWebcamStream({ wsUrl: SESSION_WS_URL, mode: 'cup', params, replay })
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
  const [localWhy, setLocalWhy] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [doneClosed, setDoneClosed] = useState(false)

  useEffect(() => {
    void start()
    return stop
  }, [start, stop])

  const frame = ([...events].reverse().find((e) => e.type === 'frame') as FrameEvent | undefined) ?? null
  const cup = frame?.cup
  const lastT = events.length ? events[events.length - 1].t : null
  const lost = (() => {
    const last = [...events].reverse().find((e) => e.type === 'perception_lost' || e.type === 'perception_regained')
    return last?.type === 'perception_lost'
  })()
  const status = liveStatus({ connected, camActive, error, replay: !!replay, frame, lost, overlay: coach.overlay, ended: flow.feedbackOpen })
  const label = statusLabel(status, 'cup')
  const live = status === 'tracking' || status === 'replay'
  const complete = events.find((e) => e.type === 'cup_complete') as CupComplete | undefined

  const finish = (endedEarly: boolean, reason?: EndReason, next?: Then) => {
    flow.finish(endedEarly, reason, { kind: 'cup', side, arcs: complete?.arcs ?? cup?.arcs_done ?? 0, reaches: complete?.reaches ?? [], ended_early: endedEarly }, next)
  }
  const hold = sxHold(coach, rest, stopped, flow.feedbackOpen, finish, send, cp)
  const holdSeconds = useHoldSeconds(hold, lastT)

  const arc = cupArc(events, frame)
  const dots = cupDots(events, frame)
  const band = cupBand(events, frame)
  const unverified = cup?.unverified_total ?? 0
  const reaches = cup?.reaches_total ?? 0
  const verifiedReaches = Math.max(0, reaches - unverified)
  const dotNow = cup?.dot ?? null
  const dotNext = cup?.expected_next ?? null
  const marked = dots.filter((d) => d.state === 'done' || d.state === 'amber').length
  const activeS = cupActiveS(events, frame)
  const lastReach = [...events].reverse().find((e) => e.type === 'reach_complete')
  const lastCorrect = [...events].reverse().find((e) => e.type === 'coach' && e.action === 'correct')
  const correcting = !!lastCorrect && lastT != null && lastT - lastCorrect.t < CUE_S
  const lastWrong = [...events].reverse().find((e) => e.type === 'wrong_dot')
  const wrongRecent = !!lastWrong && lastT != null && lastT - lastWrong.t < CUE_S
  const pipe = `cv2 5.0 · HSV cup on the warped sheet${!live ? '' : dotNow != null ? ` · cup over dot ${dotNow + 1} · hand ${cup?.hand_clear ? 'clear' : 'not clear'}` : ' · place the cup on dot 1'}`

  // coach card: a correction is amber, a verified placement in the last 2 s mint, else neutral
  const coachTone = correcting ? 'amber' : lastReach?.verified && lastT != null && lastT - lastReach.t < 2 ? 'mint' : 'neutral'
  const eyebrow = correcting ? 'Coach · Correction' : 'Coach'

  const refMode: CupRefMode = hold.open || !!complete || !cup ? 'idle' : lost || wrongRecent || correcting ? 'dim' : 'point'
  const refLabel = refMode === 'idle' ? 'idle' : lost ? 'waiting for you' : refMode === 'dim' ? 'listen to the coach' : dotNext != null ? `dot ${dotNext + 1} is next` : 'idle'

  const pain = readCheckinPain()
  const facts = cupProgressFacts(events, frame)
  const basis = `Based on: ${facts.verified} of ${facts.total} verified${facts.fasterPct != null ? ` · reach time ${Math.abs(facts.fasterPct)}% ${facts.fasterPct >= 0 ? 'faster' : 'slower'} than arc 1` : ''}${pain != null ? ` · pain ${pain} before you started` : ''}`
  const serviceProgression = !!cp.prompt && promptKind(cp.prompt) === 'progression' && !hold.prompt
  // the screen's own progression prompt once the slow arcs are verified, when the service sent none
  const localProgression = !coach.prompt && !!cup?.awaiting_phase && cup.phase === 'slow' && !declined
  const showModal = !flow.feedbackOpen && !hold.open && !complete && (serviceProgression || localProgression)

  const nextId = complete ? nextExercise(readDay()) : null
  const nextEx = nextId && nextId !== 'cup' ? exerciseById(nextId) : null
  const nextDose = nextEx ? (tierFor(pain) === 'gentle' ? (nextEx.gentleDose ?? nextEx.dose) : nextEx.dose).split(' · ')[0] : ''
  const doneVerified = complete ? complete.reaches.filter((r) => r.verified).length : verifiedReaches
  const doneUnverified = complete ? complete.reaches.length - doneVerified : unverified
  const doneOpen = !!complete && !doneClosed && !flow.feedbackOpen

  const stats = (() => {
    if (complete) return { metricLabel: 'Active time', metric: sxClock(activeS ?? frame?.t), metricSub: 'this exercise', head: 'All arcs complete', dots: { label: 'complete', items: dots.map((): DotState => 'done') } }
    const items = dots.map((d): DotState => (d.state === 'next' ? 'now' : d.state))
    const head = `${marked} of 5 dots · ${arc.dir}`
    if (activeS == null) return { metricLabel: 'Arc', metric: String(arc.arc), unit: `of ${arc.of}`, metricSub: `${arc.phase} pace`, head, sub: 'The clock starts on your first lift', dots: { label: head, items } }
    const sub = lastReach ? `Reach time ${(Number(lastReach.reach_ms) / 1000).toFixed(2)} s` : undefined
    if (arc.phase === 'fast') return { metricLabel: `Arc ${arc.arc} of ${arc.of}`, metric: 'Fast', metricSub: `pace · ${sxClock(activeS)} active`, head, sub, dots: { label: head, items } }
    return { metricLabel: 'Active time', metric: sxClock(activeS), metricSub: 'from your first lift', head, sub, dots: { label: head, items } }
  })()

  const coachCard = (
    <SxCoach
      captions={ui.captions}
      eyebrow={eyebrow}
      tone={coachTone}
      caption={coach.caption?.text ?? label.coach ?? caption(frame, lost)}
      label={coach.caption ? coachLabel(coach.caption) : coach.ruleLabel}
      source={coach.captionSource}
    />
  )
  // an agent prompt that is not the progression (e.g. a dose adjustment) sits in the coach slot
  const otherPrompt = !!cp.prompt && !hold.prompt && !serviceProgression

  return (
    <div className="sx-root cup-root">
      <SessionHeader
        title={`Waiter – cup · ${side} side`}
        sub={`Coordination · ${hold.open ? 'paused' : complete ? 'exercise complete' : `arc ${arc.arc} of ${arc.of} ${arc.phase} · ${arc.dir}`}`}
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
          note={live ? `${frame?.hand?.present ? 'hand tracked' : 'hand not in view'} · ${frame?.overlay.cup_px ? 'cup tracked' : 'cup not seen'}` : label.feed}
          band={live && band ? band.text : null}
          bandTone={band?.tone}
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
            prompt={hold.prompt ? <LivePrompt state={cp} running={{ phase: cup?.phase }} /> : null}
            resumeByPrompt={hold.resumeByPrompt}
          />
        </SxFeed>

        {traceOpen ? (
          <div className="sx-panel sx-trace">
            <TracePanel events={events} sessionId={sessionId} replay={!!replay} pipeline={[pipe, latencyLine(latency)]} />
          </div>
        ) : (
          <CupRef side={side} target={dotNext != null ? { k: dotNext, dir: arc.dir } : null} dots={dots.map((d) => d.state)} mode={refMode} label={refLabel} pace={arc.phase} />
        )}

        {otherPrompt ? (
          <div className="flex min-h-0 flex-col gap-3">
            <LivePrompt state={cp} running={{ phase: cup?.phase }} />
            {coachCard}
          </div>
        ) : (
          coachCard
        )}

        <SxStats {...stats} extra={<ExertionChip exertion={coach.exertion} compact />} verified={verifiedReaches} unverified={unverified} />
      </main>

      {showModal && (
        <ProgressionModal
          prompt={serviceProgression && cp.prompt ? cp.prompt : LOCAL_PROGRESSION}
          basis={basis}
          whyOpen={serviceProgression ? cp.whyOpen : localWhy}
          whyText={serviceProgression ? cp.whyText : null}
          onChoose={(c, i) => {
            if (serviceProgression) {
              // an answered progression never falls back to the screen's own prompt
              if (!isWhy(c)) setDeclined(true)
              cp.choose(c, i)
              return
            }
            if (isWhy(c)) setLocalWhy((v) => !v)
            else if (i === 0) send({ cmd: 'set_phase', phase: 'fast' })
            else setDeclined(true)
          }}
        />
      )}

      {doneOpen && (
        <div className="sx-scrim cup-scrim">
          <div className="sx-modal cup-modal cup-done" role="dialog" aria-modal aria-labelledby="cup-done-t">
            <div className="cup-modal-h">
              <h2 id="cup-done-t">Waiter – cup, done</h2>
              <span className="cup-tag cup-tag-mint">{`All ${complete.arcs} arcs complete`}</span>
            </div>
            <div className="cup-nums">
              <div><b>{doneVerified}</b><span>verified placements</span></div>
              <div><b>{doneUnverified}</b><span>unverified</span></div>
              <div><b>{sxClock(activeS ?? frame?.t)}</b><span>active time</span></div>
              <div><b>{complete.arcs}</b><span>{plural(complete.arcs, 'arc')}</span></div>
            </div>
            <p className="cup-modal-p">
              {nextEx ? (
                <>Next in today&apos;s plan: <b>{nextEx.name}</b>, {nextDose}. You can also stop here and come back to it.</>
              ) : (
                "That's everything in today's plan."
              )}
            </p>
            <div className="cup-modal-actions">
              {nextEx && (
                <button type="button" className="sx-btn sx-btn-primary" onClick={() => { setDoneClosed(true); finish(false, undefined, { url: demoUrl(nextEx.id, side), mode: 'cup' }) }}>Next exercise</button>
              )}
              <button type="button" className={`sx-btn ${nextEx ? 'sx-btn-secondary' : 'sx-btn-primary sx-btn-wide'}`} onClick={() => { setDoneClosed(true); finish(false) }}>Finish for today</button>
            </div>
          </div>
        </div>
      )}

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
        done={verifiedReaches}
        noun="reach"
        onClose={ui.closeEnd}
        onPain={() => { ui.closeEnd(); setPainOpen(true) }}
        onEnd={(reason) => { ui.closeEnd(); finish(true, reason) }}
      />
    </div>
  )
}

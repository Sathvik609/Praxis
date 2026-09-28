import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FlowBar } from '../../app/FlowBar'
import { AvatarPanel } from '../../avatar/AvatarPanel'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Checkbox } from '../../design/Checkbox'
import { Activity, AlertTriangle, Flag } from '../../design/Icon'
import { Panel } from '../../design/Panel'
import { api } from '../../lib/api'
import { markDemoSeen, readDay, sessionUrl as liveUrl, sideOr, startExercise } from '../../lib/day'
import { doseFor, readCheckinPain, tierFor } from '../../lib/plan'
import { EXERCISES, exerciseById } from '../../lib/seed'
import { DayStrip } from '../04-choose/DayStrip'

/** Screen 06 · Demonstration. The same avatar performs the clinician-reviewed clip on a
 *  dark stage (16:10 AvatarPanel capped at 640 px wide, so ~400 px tall inside the 800 px
 *  budget); the numbered step list follows the clip; the patient confirms readiness before
 *  practice starts. Rehearsal runs the live screen with scoring off.
 *
 *  Demo-only exercises (Rotate out / Rotate in, locked set of 23 Sep) end here: there is no
 *  practice session, the patient ticks each set, and the tick goes to `/api/self_report`, which
 *  traces it as self-reported, never as a camera-verified rep.
 *
 *  Day flow (`lib/day.ts`): Start practice records the demo as seen today (setup then offers
 *  "Skip demo") and marks the exercise as the day's current one, so its report can offer the
 *  next exercise. The side falls back to the patient's saved side, never a silent "left". A day
 *  stopped at check-in shows the demonstration but nothing can start. */
export function Demonstration() {
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const id = sp.get('exercise') ?? 'cup'
  const [day] = useState(readDay)
  const side = sp.get('side') === 'right' || sp.get('side') === 'left' ? sideOr(sp.get('side')) : (day.checkin?.side ?? sideOr(null))
  const stopped = day.stopped != null
  const ex = exerciseById(id) ?? EXERCISES.find((e) => e.id === 'cup')!
  const demo = ex.mode === 'demo'
  const [ready, setReady] = useState(false)
  const [step, setStep] = useState(1)
  const [ticked, setTicked] = useState(0)
  const [tickError, setTickError] = useState<string | null>(null)
  const tick = () => {
    setTickError(null)
    api
      .selfReport(ex.serviceId)
      .then((r) => (r.ok ? setTicked(r.sets_today ?? ticked + 1) : setTickError(r.error ?? 'not saved')))
      .catch(() => setTickError('the session service is not reachable'))
  }
  const sessionUrl = liveUrl(ex, side)
  const practise = () => {
    markDemoSeen(ex.id)
    startExercise(ex.id)
    nav(sessionUrl)
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="grid flex-1 grid-cols-[3fr_2fr] gap-6 p-6">
        <div className="mx-auto w-full max-w-[640px]">
          <Panel className="p-3">
            <AvatarPanel clip={ex.clip} side={side === 'right' ? 'right' : 'left'} onStep={setStep} className="[&>p]:text-base [&>p]:text-white/80" />
          </Panel>
          {demo && (
            <Card tone="watch" as="div" className="mt-4">
              <p className="text-lg"><b>Demo only.</b> Follow the figure and tick each set yourself. The camera does not score this one: one webcam cannot measure a forearm turning toward it honestly.</p>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-5">
          <div>
            <DayStrip day={day} active={ex.id} className="mb-2" />
            <h1 className="text-3xl">{ex.name}</h1>
            <p className="text-muted">{ex.category} · {side} side</p>
          </div>
          <Card padding="none" as="div">
            <ol className="divide-y divide-line px-5">
              {ex.steps.map((s, i) => {
                const current = step === i + 1
                return (
                  <li key={i} data-testid="step" className="flex min-h-14 items-center gap-4 py-2">
                    <span
                      aria-current={current ? 'step' : undefined}
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-bold tabular-nums ${
                        current ? 'bg-teal-fill text-white' : 'border-2 border-line text-muted'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className={`text-lg ${current ? 'font-bold' : ''}`}>{s}</span>
                  </li>
                )
              })}
            </ol>
          </Card>
          <Card padding="sm" as="div">
            <dl className="space-y-2 text-lg">
              <div className="flex items-start gap-3">
                <Activity aria-hidden className="mt-1 h-5 w-5 shrink-0 text-teal-ink" />
                <dt className="w-24 shrink-0 font-bold">Assigned</dt>
                <dd>{doseFor(ex, tierFor(readCheckinPain()))}</dd>
              </div>
              {ex.watchFor && (
                <div className="flex items-start gap-3">
                  <AlertTriangle aria-hidden className="mt-1 h-5 w-5 shrink-0 text-amber-ink" />
                  <dt className="w-24 shrink-0 font-bold">Watch for</dt>
                  <dd>{ex.watchFor}</dd>
                </div>
              )}
              {ex.stopIf && (
                <div className="flex items-start gap-3">
                  <Flag aria-hidden className="mt-1 h-5 w-5 shrink-0 text-red-ink" />
                  <dt className="w-24 shrink-0 font-bold">Stop if</dt>
                  <dd>{ex.stopIf}</dd>
                </div>
              )}
            </dl>
          </Card>
          {stopped ? (
            <Card tone="watch" as="div" padding="sm">
              <p className="text-lg">No exercises today: you can watch, but nothing starts until your next check-in allows it.</p>
            </Card>
          ) : demo ? (
            <p role="status" className="text-lg">
              {tickError
                ? `Could not save the tick: ${tickError}.`
                : ticked > 0
                  ? `${ticked} set${ticked === 1 ? '' : 's'} ticked today · self-reported, not checked by the camera`
                  : 'No sets ticked yet today.'}
            </p>
          ) : (
            <Checkbox label="I understand the movement and I'm ready" checked={ready} onChange={setReady} />
          )}
        </div>
      </div>
      <FlowBar
        step={3}
        label="Demonstration"
        left={
          <>
            <Button variant="secondary" onClick={() => nav('/details/coach')}>Ask a question</Button>
            {demo ? (
              <Button variant="secondary" onClick={() => nav('/details/choose')}>Back to exercises</Button>
            ) : (
              <Button
                variant="secondary"
                disabled={stopped}
                onClick={() => {
                  markDemoSeen(ex.id)
                  nav(`${sessionUrl}&rehearse=1`)
                }}
              >
                Rehearse without scoring
              </Button>
            )}
          </>
        }
        right={demo ? <Button disabled={stopped} onClick={tick}>I did a set</Button> : <Button disabled={!ready || stopped} onClick={practise}>Start practice</Button>}
      />
    </div>
  )
}

import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FlowBar } from '../../app/FlowBar'
import { AvatarPanel } from '../../avatar/AvatarPanel'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Checkbox } from '../../design/Checkbox'
import { Activity, AlertTriangle, Flag } from '../../design/Icon'
import { Panel } from '../../design/Panel'
import { EXERCISES } from '../../lib/seed'

/** Screen 06 · Demonstration. The same avatar performs the clinician-reviewed clip on a
 *  dark stage (16:10 AvatarPanel capped at 640 px wide, so ~400 px tall inside the 800 px
 *  budget); the numbered step list follows the clip; the patient confirms readiness before
 *  practice starts. Rehearsal runs the live screen with scoring off. */
export function Demonstration() {
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const id = sp.get('exercise') ?? 'cup'
  const side = sp.get('side') ?? 'left'
  const ex = EXERCISES.find((e) => e.id === id) ?? EXERCISES[1]
  const [ready, setReady] = useState(false)
  const [step, setStep] = useState(1)
  const sessionUrl = `/session?exercise=${ex.id}&${ex.id === 'nhpt' ? `hand=${side}` : `side=${side}`}`

  return (
    <div className="flex min-h-full flex-col">
      <div className="grid flex-1 grid-cols-[3fr_2fr] gap-6 p-6">
        <div className="mx-auto w-full max-w-[640px]">
          {ex.clip ? (
            <Panel className="p-3">
              <AvatarPanel clip={ex.clip} onStep={setStep} className="[&>p]:text-base [&>p]:text-white/80" />
            </Panel>
          ) : (
            <Card className="text-lg text-muted">This exercise is instructions-only; there is no camera demonstration. Follow the steps and log it yourself.</Card>
          )}
        </div>
        <div className="flex flex-col gap-5">
          <div>
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
                <dd>{ex.dose}</dd>
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
          <Checkbox label="I understand the movement and I'm ready" checked={ready} onChange={setReady} />
        </div>
      </div>
      <FlowBar
        step={3}
        label="Demonstration"
        left={
          <>
            <Button variant="secondary" onClick={() => nav('/coach')}>Ask a question</Button>
            <Button variant="secondary" onClick={() => nav(`${sessionUrl}&rehearse=1`)}>Rehearse without scoring</Button>
          </>
        }
        right={<Button disabled={!ready} onClick={() => nav(sessionUrl)}>Start practice</Button>}
      />
    </div>
  )
}

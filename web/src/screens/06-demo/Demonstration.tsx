import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FlowBar } from '../../app/FlowBar'
import { AvatarPanel } from '../../avatar/AvatarPanel'
import { Button } from '../../design/Button'
import { EXERCISES } from '../../lib/seed'

/** Screen 06 · Demonstration. The same avatar performs the clinician-reviewed clip; the
 *  patient confirms readiness before practice starts. Rehearsal runs the live screen
 *  with scoring off. */
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
    <div className="flex min-h-[calc(100vh-5rem)] flex-col">
      <div className="grid flex-1 grid-cols-[3fr_2fr] gap-8 p-8">
        <div>
          {ex.clip ? (
            <AvatarPanel clip={ex.clip} onStep={setStep} />
          ) : (
            <div className="rounded-2xl border border-line bg-surface p-8 text-muted">This exercise is instructions-only; there is no camera demonstration.</div>
          )}
        </div>
        <div className="flex flex-col gap-5">
          <div><h1 className="text-3xl">{ex.name}</h1><p className="text-muted">{ex.category} · GRASP Level 2 · {side} side</p></div>
          <ol className="divide-y divide-line rounded-2xl border border-line bg-surface px-5">
            {ex.steps.map((s, i) => (
              <li key={i} data-testid="step" className="flex items-start gap-4 py-3">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-bold ${step === i + 1 ? 'bg-teal text-white' : 'bg-bg text-muted'}`}>{i + 1}</span>
                <span className={step === i + 1 ? 'font-bold' : ''}>{s}</span>
              </li>
            ))}
          </ol>
          <div className="rounded-2xl border border-line bg-surface p-5 leading-relaxed">
            <div><b>Assigned</b> {ex.dose}</div>
            {ex.watchFor && <div><b>Watch for</b> {ex.watchFor}</div>}
            {ex.stopIf && <div><b>Stop if</b> {ex.stopIf}</div>}
          </div>
          <label className="flex min-h-14 cursor-pointer items-center gap-3 text-lg">
            <input type="checkbox" checked={ready} onChange={(e) => setReady(e.target.checked)} className="h-7 w-7 accent-teal" aria-label="I understand the movement and I'm ready" />
            I understand the movement and I'm ready
          </label>
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

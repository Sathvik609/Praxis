import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../../design/Button'
import { Chip } from '../../design/Chip'

type Result = {
  kind: 'nhpt'
  hand: string
  total_s: number | null
  splits_s: number[]
  pegs: { peg: number; hole: number }[]
  pegs_done?: number
  ended_early: boolean
}

/** Screen 09 variant · Assessment result for the Nine-Hole Peg Test. */
export function AssessmentResult() {
  const { state } = useLocation() as { state: Result | null }
  const nav = useNavigate()
  if (!state || state.kind !== 'nhpt') {
    return (
      <div className="mx-auto max-w-4xl p-8">
        <h1 className="text-4xl">Assessment result</h1>
        <p className="mt-2 text-muted">No result to show. Run the peg test from Home.</p>
        <Button className="mt-6" onClick={() => nav('/')}>Back to Home</Button>
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="flex items-center gap-4">
        <h1 className="text-4xl">Nine-Hole Peg Test · {state.hand} hand</h1>
        <Chip tone={state.ended_early ? 'amber' : 'mint'}>{state.ended_early ? 'Ended early' : 'Complete'}</Chip>
      </div>
      <p className="mt-2 text-muted">insertion-only · timing aid, not a clinical instrument</p>
      <div className="mt-6 rounded-2xl border border-line bg-surface p-8">
        <div className="text-muted">Total time</div>
        <div className="font-heading text-7xl">
          {state.total_s != null ? <span>{state.total_s.toFixed(1)}</span> : <span>—</span>}
          <span className="text-2xl"> s</span>
        </div>
        {state.total_s == null && <div className="text-muted">Timer did not complete ({state.pegs_done ?? 0} of 9 seated).</div>}
      </div>
      {state.splits_s.length > 0 && (
        <div className="mt-6 rounded-2xl border border-line bg-surface p-8">
          <h2 className="mb-3 text-2xl">Per-peg splits</h2>
          <ol className="grid grid-cols-3 gap-2">
            {state.splits_s.map((s, i) => (
              <li key={i} data-testid="split" className="flex justify-between rounded-xl bg-bg px-4 py-2">
                <span>Peg {i + 1}{state.pegs[i] ? ` · hole ${state.pegs[i].hole + 1}` : ''}</span>
                <b>{s.toFixed(1)} s</b>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="mt-8 flex justify-end">
        <Button onClick={() => nav('/')}>Done — back to Home</Button>
      </div>
    </div>
  )
}

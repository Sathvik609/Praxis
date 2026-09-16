import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../../design/Button'
import { Chip } from '../../design/Chip'

type NhptResult = {
  kind: 'nhpt'
  hand: string
  total_s: number | null
  splits_s: number[]
  pegs: { peg: number; hole: number }[]
  pegs_done?: number
  ended_early: boolean
}
type Reach = { rep: number; from_dot: number; to_dot: number; reach_ms: number; verified: boolean; reason: string | null; arc: number; phase: string }
type CupResult = { kind: 'cup'; side: string; arcs: number; reaches: Reach[]; ended_early: boolean }
type ArmRep = { set: number; rep: number; peak_deg: number; hold_s: number; verified: boolean; reason: string | null; lean: boolean; hike: boolean }
type ArmResult = { kind: 'arm'; side: string; sets: number; reps: ArmRep[]; ended_early: boolean; lean_count: number; hike_count: number; ceiling_deg: number }
type Result = NhptResult | CupResult | ArmResult

function ArmReport({ r, onDone }: { r: ArmResult; onDone: () => void }) {
  const verified = r.reps.filter((x) => x.verified).length
  const unverified = r.reps.length - verified
  const best = r.reps.filter((x) => x.verified).reduce((m, x) => Math.max(m, x.peak_deg), 0)
  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="flex items-center gap-4">
        <h1 className="text-4xl">Arm to the front · {r.side} side</h1>
        <Chip tone={r.ended_early ? 'amber' : 'mint'}>{r.ended_early ? 'Ended early' : 'Complete'}</Chip>
      </div>
      <p className="mt-2 text-muted">Camera-relative angles, not goniometry. Ceiling {r.ceiling_deg}° enforced in code.</p>
      <div className="mt-6 grid grid-cols-4 gap-4">
        {[[`${r.sets}`, 'sets'], [`${verified} verified`, 'lifts'], [`${unverified} unverified`, 'missed target or short hold'], [`${r.lean_count} lean events`, `${r.hike_count} shoulder-hike events`]].map(([v, l]) => (
          <div key={l} className="rounded-2xl border border-line bg-surface p-5">
            <div className="text-2xl font-bold">{v}</div>
            <div className="text-muted">{l}</div>
          </div>
        ))}
      </div>
      {r.reps.length > 0 && (
        <div className="mt-6 rounded-2xl border border-line bg-surface p-8">
          <h2 className="mb-3 text-2xl">Peak angle per rep · ceiling {r.ceiling_deg}° · best {Math.round(best)}° · amber = unverified</h2>
          <div className="flex h-40 items-end gap-1">
            {r.reps.map((x, i) => (
              <div key={i} data-testid="arm-rep" title={`set ${x.set} rep ${x.rep}: ${x.peak_deg}° hold ${x.hold_s}s${x.reason ? ` · ${x.reason}` : ''}`}
                className={`flex-1 rounded-t ${x.verified ? 'bg-teal' : 'bg-amber'}`} style={{ height: `${Math.min(100, (x.peak_deg / r.ceiling_deg) * 100)}%` }} />
            ))}
          </div>
        </div>
      )}
      <div className="mt-8 flex justify-end">
        <Button onClick={onDone}>Done — back to Home</Button>
      </div>
    </div>
  )
}

function CupReport({ r, onDone }: { r: CupResult; onDone: () => void }) {
  const verified = r.reaches.filter((x) => x.verified).length
  const unverified = r.reaches.length - verified
  const mean = (phase: string) => {
    const xs = r.reaches.filter((x) => x.verified && x.phase === phase).map((x) => x.reach_ms)
    return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length / 1000).toFixed(2) : '—'
  }
  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="flex items-center gap-4">
        <h1 className="text-4xl">Waiter – cup · {r.side} side</h1>
        <Chip tone={r.ended_early ? 'amber' : 'mint'}>{r.ended_early ? 'Ended early' : 'Complete'}</Chip>
      </div>
      <p className="mt-2 text-muted">What the camera measured. Unverified reaches are counted, never scored.</p>
      <div className="mt-6 grid grid-cols-4 gap-4">
        {[[`${r.arcs}`, 'arcs'], [`${verified} verified`, 'reaches'], [`${unverified} unverified`, 'hand covered cup or markers lost'], [`${mean('slow')} / ${mean('fast')} s`, 'mean reach slow / fast']].map(([v, l]) => (
          <div key={l} className="rounded-2xl border border-line bg-surface p-5">
            <div className="text-2xl font-bold">{v}</div>
            <div className="text-muted">{l}</div>
          </div>
        ))}
      </div>
      {r.reaches.length > 0 && (
        <div className="mt-6 rounded-2xl border border-line bg-surface p-8">
          <h2 className="mb-3 text-2xl">Reach time per dot · amber = unverified</h2>
          <ol className="grid grid-cols-4 gap-2">
            {r.reaches.map((x) => (
              <li key={x.rep} data-testid="reach" className={`flex justify-between rounded-xl px-4 py-2 ${x.verified ? 'bg-bg' : 'bg-amber/15 text-amber'}`}>
                <span>{x.phase} · dot {x.from_dot + 1}→{x.to_dot + 1}</span>
                <b>{(x.reach_ms / 1000).toFixed(1)} s</b>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="mt-8 flex justify-end">
        <Button onClick={onDone}>Done — back to Home</Button>
      </div>
    </div>
  )
}

/** Screen 09 variant · Assessment result for the Nine-Hole Peg Test. */
export function AssessmentResult() {
  const { state } = useLocation() as { state: Result | null }
  const nav = useNavigate()
  if (state?.kind === 'cup') return <CupReport r={state} onDone={() => nav('/')} />
  if (state?.kind === 'arm') return <ArmReport r={state} onDone={() => nav('/')} />
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

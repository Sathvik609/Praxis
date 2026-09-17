import { useState } from 'react'
import { Button } from '../../design/Button'
import { Chip } from '../../design/Chip'
import { api, useApi } from '../../lib/api'

/** Screen 11 · Therapist dashboard (read-only for the competition build; Cognito roles in W6). */
export function Therapist() {
  const { data: patients } = useApi(() => api.therapistPatients())
  const { data: flags, reload } = useApi(() => api.flags())
  const { data: rx } = useApi(() => api.prescription())
  const { data: sessions } = useApi(() => api.sessions())
  const [trace, setTrace] = useState<{ session: string | null; rows: Record<string, unknown>[] } | null>(null)
  const me = patients?.[0]
  const open = (flags ?? []).filter((f) => !f.reviewed)
  return (
    <div className="grid min-h-[calc(100vh-5rem)] grid-cols-[1fr_3fr] gap-6 p-6">
      <aside className="rounded-2xl border border-line bg-surface p-4">
        <div className="mb-3 flex items-center gap-2"><Chip tone="mint">Clinician view</Chip><span className="text-muted">Patients</span></div>
        <input placeholder="Search patients" className="mb-3 w-full rounded-xl border border-line p-3" />
        <ul className="divide-y divide-line">
          {(patients ?? []).map((p, i) => (
            <li key={p.id} className={`flex items-center justify-between py-3 ${i === 0 ? 'rounded-xl bg-bg px-2' : ''}`}>
              <div><div className="font-bold">{p.name}{p.illustrative ? ' ·' : ''}</div><div className="text-base text-muted">{p.program}{p.illustrative ? ' (illustrative)' : ''}</div></div>
              {p.open_flags > 0 && <Chip tone="red">{p.open_flags} flag{p.open_flags > 1 ? 's' : ''}</Chip>}
            </li>
          ))}
        </ul>
      </aside>
      <main className="space-y-6">
        {me && (
          <div className="flex items-start gap-4">
            <div><h1 className="text-4xl">{me.name}</h1><p className="text-muted">Hospital GRASP, Level {rx?.level ?? 2} · {rx?.side ?? 'left'} side · program v{rx?.version ?? 3} · next visit Thu 18 Sep</p></div>
            <div className="ml-auto flex gap-3"><Button variant="secondary" title="Editing arrives with clinician accounts (W6)">Edit prescription</Button><Button>Review flags</Button></div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-6">
          <section className="rounded-2xl border-2 border-red/50 bg-surface p-5">
            <div className="flex items-center justify-between"><h2 className="text-2xl">Open flags</h2><Chip tone="red">{open.length}</Chip></div>
            <ul className="mt-2 divide-y divide-line">
              {open.map((f) => (
                <li key={f.id} className="py-3"><b>{f.date.slice(5)}</b> · {f.rule === 'pain' ? 'Session ended by stop rule: ' : ''}{f.detail}<div className="mt-2"><Button variant="secondary" className="min-h-10 px-3 text-base" onClick={() => api.markReviewed(f.id).then(reload)}>Mark reviewed</Button></div></li>
              ))}
              {open.length === 0 && <li className="py-3 text-muted">No open flags.</li>}
            </ul>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-2xl">Prescription (v{rx?.version ?? 3})</h2>
            <ul className="mt-2 divide-y divide-line text-lg">
              <li className="flex justify-between py-2"><span>Nine-Hole Peg Test</span><Chip tone="neutral">weekly</Chip></li>
              <li className="flex justify-between py-2"><span>Waiter – cup · {String(rx?.exercises.cup?.slow_arcs ?? 2)} slow + {String(rx?.exercises.cup?.fast_arcs ?? 2)} fast arcs</span><Chip tone="mint">camera</Chip></li>
              <li className="flex justify-between py-2"><span>Arm to the front · {String(rx?.exercises.arm?.sets ?? 2)}×{String(rx?.exercises.arm?.reps ?? 8)} · hold {String(rx?.exercises.arm?.hold_s ?? 3)} · ≤{String(rx?.exercises.arm?.ceiling_deg ?? 90)}°</span><Chip tone="mint">camera</Chip></li>
              <li className="flex justify-between py-2"><span>Block towers · 3×5</span><Chip tone="neutral">instructions</Chip></li>
            </ul>
            <p className="mt-3 text-muted">Allowed adaptations: fast arcs · hold 3→2 s</p>
            <p className="text-muted">Stop rules: pain ≥{rx?.stop_rules.pain_max ?? 5} · new symptoms · lean &gt;{rx?.stop_rules.lean_deg ?? 12}° ×{rx?.stop_rules.lean_events ?? 3}</p>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-2xl">Adherence and NHPT</h2>
            <div className="mt-2 flex gap-8"><div><div className="text-3xl font-bold">{me?.adherence_pct ?? '—'}%</div><div className="text-muted">planned sessions done</div></div><div><div className="text-3xl font-bold">{me?.nhpt_last_s ?? '—'} s</div><div className="text-muted">NHPT · {me?.nhpt_first_s ?? '—'} s at wk 1</div></div></div>
            <p className="mt-3 text-muted">Pain before/after: stable at 2, one spike to 5 on 8 Sep.</p>
          </section>
        </div>
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-2xl">Session summaries</h2>
          <ul className="mt-2 divide-y divide-line">
            {(sessions ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-4 py-3">
                <span className="w-20 text-muted">{s.date.slice(5)}</span>
                <span className="flex-1 text-lg">{s.title}</span>
                <span className="text-muted">{s.summary.camera.verified ?? 0} verified · {s.summary.camera.unverified ?? 0} unverified · {s.summary.camera.coverage_pct ?? '—'}% coverage</span>
                <Chip tone={s.status === 'complete' ? 'mint' : 'amber'}>{s.mode === 'nhpt' ? 'Assessment' : s.tracking === 'limited' ? 'Limited' : s.status === 'complete' ? 'Complete' : 'Ended early'}</Chip>
                <Button variant="secondary" className="min-h-10 px-3 text-base" onClick={() => api.trace(s.id).then(setTrace)}>Open trace</Button>
              </li>
            ))}
          </ul>
        </section>
        {trace && (
          <section className="rounded-2xl bg-[var(--stage-a)] p-5 font-mono text-sm text-white/85">
            <div className="mb-2 flex justify-between"><span className="font-bold text-mint">Decision trace · {trace.session ?? 'no live trace for this session'}</span><button type="button" className="text-white/70" onClick={() => setTrace(null)}>close</button></div>
            {trace.rows.length === 0 && <div className="text-white/50">Traces are kept for live sessions of this service run (traces/*.jsonl on disk for all sessions).</div>}
            {trace.rows.map((r, i) => <div key={i}>{String(r.kind)} {Object.entries(r).filter(([k]) => !['kind', 'seq', 'ts', 'session'].includes(k)).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' ').slice(0, 160)}</div>)}
          </section>
        )}
      </main>
    </div>
  )
}

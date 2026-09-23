import { useRef, useState } from 'react'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Chip } from '../../design/Chip'
import { Field } from '../../design/Field'
import { X } from '../../design/Icon'
import { Stat } from '../../design/Stat'
import { api, useApi } from '../../lib/api'
import { PROGRAM } from '../../lib/seed'

type Trace = { session: string | null; rows: Record<string, unknown>[] }

/** Screen 11 · Therapist dashboard (read-only for the competition build; clinician accounts
 *  arrive with Cognito in W6). Rendered outside the patient Shell with its own clinician
 *  header. Editing scrolls to the prescription card; nothing here changes the prescription. */
export function Therapist() {
  const { data: patients, error: pError } = useApi(() => api.therapistPatients())
  const { data: flags, reload } = useApi(() => api.flags())
  const { data: rx } = useApi(() => api.prescription())
  const { data: sessions } = useApi(() => api.sessions())
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [trace, setTrace] = useState<Trace | null>(null)
  const [traceNote, setTraceNote] = useState<string | null>(null)
  const rxRef = useRef<HTMLElement>(null)
  const flagsRef = useRef<HTMLElement>(null)

  const me = patients?.find((p) => p.id === selectedId) ?? patients?.[0]
  const shown = (patients ?? []).filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
  const open = (flags ?? []).filter((f) => !f.reviewed)
  const scrollTo = (ref: { current: HTMLElement | null }) => ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  const openTrace = (id: string) =>
    api
      .trace(id)
      .then((t) => {
        setTrace(t)
        setTraceNote(null)
      })
      .catch(() => setTraceNote('Could not load the trace — the session service is not reachable.'))

  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <header className="flex h-16 items-center gap-3 border-b border-line bg-surface px-6">
        <span className="font-heading text-2xl font-semibold text-teal-ink">Praxis</span>
        <span className="text-muted">·</span>
        <Chip tone="mint">Clinician view</Chip>
        <span className="ml-auto text-muted">{PROGRAM.clinician}</span>
        <Chip tone="neutral">Read-only</Chip>
      </header>

      <div className="grid flex-1 grid-cols-[minmax(280px,1fr)_3fr] gap-6 p-6">
        <Card as="div" padding="sm" className="self-start">
          <h2 className="mb-2 text-2xl">Patients</h2>
          <Field label="Search patients" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name" className="mb-2" />
          {!patients && !pError && <p className="py-3 text-muted" role="status">Loading patients…</p>}
          {pError && <p className="py-3 text-red-ink" role="alert">Could not load patients: {pError}</p>}
          <ul className="divide-y divide-line">
            {shown.map((p) => {
              const on = p.id === me?.id
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSelectedId(p.id)}
                    className={`flex min-h-14 w-full items-center justify-between gap-2 rounded-[var(--r-control)] px-2 py-2 text-left transition-colors hover:bg-tint-mint focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--focus)]/40 ${on ? 'bg-tint-mint' : ''}`}
                  >
                    <span className="min-w-0">
                      <span className="block font-bold">{p.name}</span>
                      <span className="block text-base text-muted">{p.program}</span>
                    </span>
                    <span className="flex shrink-0 gap-1">
                      {p.illustrative && <Chip tone="neutral">Sample</Chip>}
                      {p.open_flags > 0 && <Chip tone="red">{p.open_flags} flag{p.open_flags > 1 ? 's' : ''}</Chip>}
                    </span>
                  </button>
                </li>
              )
            })}
            {patients && shown.length === 0 && <li className="py-3 text-muted">No patient matches “{query}”.</li>}
          </ul>
        </Card>

        <div className="space-y-6">
          {me && (
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-0 flex-1">
                <h1 className="text-4xl">{me.name}</h1>
                <p className="text-muted">Hospital GRASP, Level {rx?.level ?? 2} · {rx?.side ?? 'left'} side · program v{rx?.version ?? 3} · next visit {PROGRAM.nextVisit}</p>
              </div>
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => scrollTo(rxRef)}>Edit prescription</Button>
                <Button onClick={() => scrollTo(flagsRef)}>Review flags</Button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-6">
            <Card title="Open flags" action={<Chip tone="red">{open.length}</Chip>} className="scroll-mt-6">
              <section ref={flagsRef} aria-label="Open flags">
                <ul className="divide-y divide-line">
                  {open.map((f) => (
                    <li key={f.id} className="py-3">
                      <b>{f.date.slice(5)}</b> · {f.rule === 'pain' ? 'Session ended by stop rule: ' : ''}{f.detail}
                      <div className="mt-2"><Button variant="secondary" onClick={() => api.markReviewed(f.id).then(reload)}>Mark reviewed</Button></div>
                    </li>
                  ))}
                  {flags && open.length === 0 && <li className="py-3 text-muted">No open flags.</li>}
                  {!flags && <li className="py-3 text-muted">Loading flags…</li>}
                </ul>
              </section>
            </Card>
            <Card title={`Prescription (v${rx?.version ?? 3})`} action={<Chip tone="neutral">Read-only</Chip>}>
              <section ref={rxRef} aria-label="Prescription" className="scroll-mt-6">
                <ul className="divide-y divide-line text-lg">
                  <li className="flex justify-between gap-2 py-2"><span>Pendulum · {String(rx?.exercises.pendulum?.sets ?? 2)}×{String(rx?.exercises.pendulum?.reps ?? 10)} swings</span><Chip tone="mint">camera</Chip></li>
                  <li className="flex justify-between gap-2 py-2"><span>Arm to the front · {String(rx?.exercises.arm?.sets ?? 2)}×{String(rx?.exercises.arm?.reps ?? 8)} · hold {String(rx?.exercises.arm?.hold_s ?? 3)} · ≤{String(rx?.exercises.arm?.ceiling_deg ?? 90)}°</span><Chip tone="mint">camera</Chip></li>
                  <li className="flex justify-between gap-2 py-2"><span>Arm out to the side · {String(rx?.exercises.abduction?.sets ?? 2)}×{String(rx?.exercises.abduction?.reps ?? 8)} · hold {String(rx?.exercises.abduction?.hold_s ?? 3)} · ≤{String(rx?.exercises.abduction?.ceiling_deg ?? 90)}°</span><Chip tone="mint">camera</Chip></li>
                  <li className="flex justify-between gap-2 py-2"><span>Waiter – cup · {String(rx?.exercises.cup?.slow_arcs ?? 2)} slow + {String(rx?.exercises.cup?.fast_arcs ?? 2)} fast arcs</span><Chip tone="mint">camera</Chip></li>
                  <li className="flex justify-between gap-2 py-2"><span>Nine-Hole Peg Test</span><Chip tone="neutral">weekly</Chip></li>
                  <li className="flex justify-between gap-2 py-2"><span>Rotate out · Rotate in · 2×8</span><Chip tone="neutral">demo only · self-ticked</Chip></li>
                </ul>
                <p className="mt-3 text-muted">Pain tier at check-in: 0–3 full · 4–6 gentle (swings 8, lifts 2×6 hold 2 s, side lift ≤60°, no fast arcs) · ≥{Math.min(7, rx?.stop_rules.pain_max ?? 7)} rest</p>
                <p className="text-muted">Stop rules: pain ≥{rx?.stop_rules.pain_max ?? 7} · new symptoms · lean &gt;{rx?.stop_rules.lean_deg ?? 12}° ×{rx?.stop_rules.lean_events ?? 3}</p>
                <p className="mt-3 text-base text-muted">Prescription edits arrive with clinician accounts. Until then this card is the reference the coach is clamped to.</p>
              </section>
            </Card>
            <Card title="Adherence and NHPT">
              <div className="flex flex-wrap gap-8">
                <Stat value={me?.adherence_pct ?? '—'} unit="%" label="planned sessions done" />
                <Stat value={me?.nhpt_last_s ?? '—'} unit="s" label={`NHPT · ${me?.nhpt_first_s ?? '—'} s at wk 1`} />
              </div>
              <p className="mt-3 text-muted">Pain before/after: stable at 2, one spike to 5 on 8 Sep.</p>
            </Card>
          </div>
          <Card title="Session summaries">
            {!sessions && <p className="text-muted">Loading sessions…</p>}
            <ul className="divide-y divide-line">
              {(sessions ?? []).map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="w-16 text-muted">{s.date.slice(5)}</span>
                  <span className="min-w-0 flex-1 text-lg">{s.title}</span>
                  <span className="text-muted">{s.summary.camera.verified ?? 0} verified · {s.summary.camera.unverified ?? 0} unverified · {s.summary.camera.coverage_pct ?? '—'}% coverage</span>
                  <Chip tone={s.status === 'complete' ? 'mint' : 'amber'}>{s.mode === 'nhpt' ? 'Assessment' : s.tracking === 'limited' ? 'Limited' : s.status === 'complete' ? 'Complete' : 'Ended early'}</Chip>
                  <Button variant="secondary" onClick={() => openTrace(s.id)}>Open trace</Button>
                </li>
              ))}
            </ul>
            {traceNote && <p className="mt-2 text-red-ink" role="alert">{traceNote}</p>}
          </Card>
          {trace && (
            <section aria-label="Decision trace" className="rounded-[var(--r-card)] bg-[var(--stage-a)] p-5 font-mono text-base text-white/85">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="font-bold text-[var(--mint)]">Decision trace · {trace.session ?? 'no live trace for this session'}</span>
                <Button variant="link" className="min-h-14 w-14 px-0 text-white!" aria-label="Close trace" icon={<X />} onClick={() => setTrace(null)} />
              </div>
              {trace.rows.length === 0 && <div className="text-white/70">No trace rows for this session in the running service. Rule-based coach · LLM agent pending.</div>}
              {trace.rows.map((r, i) => (
                <div key={i}>
                  {String(r.kind)} {Object.entries(r).filter(([k]) => !['kind', 'seq', 'ts', 'session'].includes(k)).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' ').slice(0, 160)}
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

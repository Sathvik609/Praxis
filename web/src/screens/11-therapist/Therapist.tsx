import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Chip } from '../../design/Chip'
import { Field } from '../../design/Field'
import { X } from '../../design/Icon'
import { Stat } from '../../design/Stat'
import { api, isReplaySession, isTherapistOnly, useApi } from '../../lib/api'
import { WEEKDAYS, daysLabel, visitText } from '../../lib/calendar'
import { upcomingVisit } from '../../lib/seed'
import { fmtV } from '../../lib/trend'
import { ruleCoachLabel } from '../../session/agent'
import { DEFAULT_SCHEDULE, ScheduleDialog, THERAPIST_ONLY } from './ScheduleDialog'

type Trace = { session: string | null; rows: Record<string, unknown>[] }

/** Screen 11 · Therapist dashboard. Rendered outside the patient Shell with its own clinician
 *  header. The dose is read-only for the competition build (clinician accounts arrive with
 *  Cognito in W6); since 28 Sep the practice days, peg-test day and next clinic visit can be
 *  edited ("Edit practice days", saved as prescription v(N+1)), which drives screen 12. */
export function Therapist() {
  const { data: patients, error: pError } = useApi(() => api.therapistPatients())
  const { data: flags, reload } = useApi(() => api.flags())
  const { data: rx, reload: reloadRx } = useApi(() => api.prescription())
  const [editing, setEditing] = useState(false)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const schedule = rx?.schedule ?? DEFAULT_SCHEDULE
  const { data: sessions } = useApi(() => api.sessions())
  const { data: health } = useApi(() => api.health())
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [trace, setTrace] = useState<Trace | null>(null)
  const [traceNote, setTraceNote] = useState<string | null>(null)
  const flagsRef = useRef<HTMLElement>(null)
  // 21 Oct: Mark reviewed is therapist only on the service; a refusal is said, the flag stays open.
  const [flagNote, setFlagNote] = useState<string | null>(null)
  const markReviewed = (id: number) =>
    api
      .markReviewed(id)
      .then(() => {
        setFlagNote(null)
        reload()
      })
      .catch((e) => setFlagNote(isTherapistOnly(e) ? THERAPIST_ONLY : 'Could not mark it reviewed: the session service is not reachable. The flag stays open.'))

  const me = patients?.find((p) => p.id === selectedId) ?? patients?.[0]
  const visitSample = !!schedule.next_visit?.sample
  const upcoming = upcomingVisit(schedule.next_visit ? visitText(schedule.next_visit.at) : null)
  const nextVisit = upcoming && visitSample ? `${upcoming} (sample)` : upcoming
  // Pain before → after from the stored sessions (newest first), never a fixed sentence.
  const painRows = (sessions ?? []).filter((s) => !isReplaySession(s) && typeof s.feedback?.pain_after === 'number').slice(0, 4) // replays never count (same rule as Progress)
  const painSample = painRows.some((s) => s.illustrative)
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
      <header className="th-head flex h-16 items-center gap-3 border-b border-line bg-surface px-6">
        <span className="font-heading text-2xl font-semibold text-teal-ink">Praxis</span>
        <span className="text-muted">·</span>
        <Chip tone="mint">Clinician view</Chip>
        <span className="ml-auto text-muted">Therapist view</span>
        <Chip tone="neutral">No clinician sign-in yet</Chip>
        <Link
          to="/details"
          className="flex h-14 items-center rounded-[var(--r-control)] border-2 border-teal-ink px-4 text-lg font-bold text-teal-ink hover:bg-tint-mint focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--focus)]/40"
        >
          Back to patient app
        </Link>
      </header>

      <div role="main" className="th-grid grid flex-1 grid-cols-[minmax(280px,1fr)_3fr] gap-6 p-6">
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
                <p className="text-muted">Hospital GRASP, Level {rx?.level ?? 2} · {rx?.side ?? 'left'} side · program v{rx?.version ?? 3} · next visit {nextVisit ?? 'not booked'}</p>
              </div>
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setEditing(true)}>Edit practice days</Button>
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
                      <div className="mt-2"><Button variant="secondary" onClick={() => markReviewed(f.id)}>Mark reviewed</Button></div>
                    </li>
                  ))}
                  {flags && open.length === 0 && <li className="py-3 text-muted">No open flags.</li>}
                  {flagNote && <li role="status" className="py-3 text-lg text-red-ink">{flagNote}</li>}
                  {!flags && <li className="py-3 text-muted">Loading flags…</li>}
                </ul>
              </section>
            </Card>
            <Card title={`Prescription (v${rx?.version ?? 3})`} action={<Chip tone="neutral">Dose read-only</Chip>}>
              <section aria-label="Prescription">
                <ul className="divide-y divide-line text-lg">
                  <li className="flex justify-between gap-2 py-2"><span>Arm out to the side · {String(rx?.exercises.abduction?.sets ?? 2)}×{String(rx?.exercises.abduction?.reps ?? 8)} · hold {String(rx?.exercises.abduction?.hold_s ?? 3)} · ≤{String(rx?.exercises.abduction?.ceiling_deg ?? 90)}°</span><Chip tone="mint">Arm strengthening</Chip></li>
                  <li className="flex justify-between gap-2 py-2"><span>Waiter – cup · {String(rx?.exercises.cup?.slow_arcs ?? 2)} slow + {String(rx?.exercises.cup?.fast_arcs ?? 2)} fast arcs</span><Chip tone="mint">Coordination</Chip></li>
                  <li className="flex justify-between gap-2 py-2"><span>Nine-Hole Peg Test</span><Chip tone="mint">Assessment</Chip></li>
                  <li className="py-2">Practice days · {daysLabel(schedule.practice_days)} · peg test {WEEKDAYS[schedule.nhpt_day]}</li>
                  <li className="flex items-center justify-between gap-2 py-2">
                    <span>Next visit · {schedule.next_visit ? `${visitText(schedule.next_visit.at)} · ${schedule.next_visit.with}` : 'not booked'}</span>
                    {visitSample && <Chip tone="neutral">Sample</Chip>}
                  </li>
                </ul>
                {savedNote && <p className="mt-2 font-bold text-mint-ink" role="status">{savedNote}</p>}
                <p className="mt-3 text-muted">Pain tier at check-in: 0–3 full · 4–6 gentle (side lift 2×6 hold 2 s ≤60°, no fast arcs) · ≥{Math.min(7, rx?.stop_rules.pain_max ?? 7)} rest</p>
                <p className="text-muted">Stop rules: pain ≥{rx?.stop_rules.pain_max ?? 7} · new or worse symptoms · lean &gt;{rx?.stop_rules.lean_deg ?? 12}° ×{rx?.stop_rules.lean_events ?? 3}</p>
                <p className="mt-3 text-base text-muted">Doses are read-only here, and the coach never goes beyond them. Practice days and the next visit can be changed with Edit practice days.</p>
              </section>
            </Card>
            <Card title="Adherence and NHPT">
              <div className="flex flex-wrap gap-8">
                {/* 24 Oct: plain words instead of "— %" and "— s" before there is anything to count */}
                {me?.adherence_pct == null ? <p className="text-muted">No practice days yet.</p> : <Stat value={me.adherence_pct} unit="%" label="planned days practised" />}
                {me?.nhpt_last_s == null ? <p className="text-muted">No peg test yet.</p> : <Stat value={fmtV(me.nhpt_last_s)} unit="s" label={`NHPT · ${me.nhpt_first_s == null ? '—' : fmtV(me.nhpt_first_s)} s at wk 1${me.nhpt_sample ? ' · sample' : ''}`} />}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-muted">
                {painRows.length ? (
                  <span>Pain before → after · {painRows.map((s) => `${s.date.slice(5)}: ${String(s.checkin?.pain_before ?? '—')} → ${String(s.feedback.pain_after)}`).join(' · ')}</span>
                ) : (
                  <span>{sessions ? 'No pain reports yet.' : 'Loading pain reports…'}</span>
                )}
                {painSample && <Chip tone="neutral">Sample</Chip>}
              </div>
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
                  {s.illustrative && <Chip tone="neutral">Sample</Chip>}
                  {isReplaySession(s) && <Chip tone="amber">Replay</Chip>}
                  <Chip tone={s.status === 'complete' ? 'mint' : 'amber'}>{s.mode === 'nhpt' ? 'Assessment' : s.tracking === 'limited' ? 'Limited' : s.status === 'complete' ? 'Complete' : 'Ended early'}</Chip>
                  <Button variant="secondary" onClick={() => openTrace(s.id)}>Open trace</Button>
                </li>
              ))}
            </ul>
            {(sessions ?? []).some(isReplaySession) && <p className="mt-2 text-base text-muted">Replays are recorded clips run through the same pipeline: listed here, never counted in adherence, NHPT or pain.</p>}
            {traceNote && <p className="mt-2 text-red-ink" role="alert">{traceNote}</p>}
          </Card>
          {trace && (
            <section aria-label="Decision trace" className="rounded-[var(--r-card)] bg-[var(--stage-a)] p-5 font-mono text-base text-white/85">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="font-bold text-[var(--mint)]">Decision trace · {trace.session ?? 'no live trace for this session'}</span>
                <Button variant="link" className="min-h-14 w-14 px-0 text-white!" aria-label="Close trace" icon={<X />} onClick={() => setTrace(null)} />
              </div>
              {trace.rows.length === 0 && <div className="text-white/70">{`No trace rows for this session in the running service. ${ruleCoachLabel(health?.agent)}.`}</div>}
              {trace.rows.map((r, i) => (
                <div key={i}>
                  {String(r.kind)} {Object.entries(r).filter(([k]) => !['kind', 'seq', 'ts', 'session'].includes(k)).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' ').slice(0, 160)}
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
      {editing && rx && (
        <ScheduleDialog
          schedule={schedule}
          version={rx.version}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false)
            setSavedNote(`Saved as prescription v${saved.version} · practice days ${daysLabel(saved.schedule?.practice_days ?? [])}.`)
            reloadRx()
          }}
        />
      )}
    </div>
  )
}

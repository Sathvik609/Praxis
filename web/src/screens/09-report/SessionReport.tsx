import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../design/Button'
import { Chip } from '../../design/Chip'
import { api, useApi, type SessionRecord } from '../../lib/api'

const conf = { high: 'mint', medium: 'amber', low: 'neutral' } as const

function Bars({ values, verified, label, ceiling }: { values: number[]; verified?: boolean[]; label: string; ceiling?: number }) {
  const max = ceiling ?? Math.max(...values, 1)
  return (
    <div>
      <div className="text-muted">{label}</div>
      <div className="mt-2 flex h-24 items-end gap-1">
        {values.map((v, i) => <div key={i} title={String(v)} className={`flex-1 rounded-t ${verified?.[i] === false ? 'bg-amber' : 'bg-teal'}`} style={{ height: `${Math.min(100, (v / max) * 100)}%` }} />)}
      </div>
    </div>
  )
}

/** Screen 09 · Session report. Camera measurements are separated from what the patient
 *  reported; coach notes carry confidence; next-session changes are proposals; delivery to
 *  the clinician is shown as queued until confirmed. */
export function SessionReport() {
  const { id } = useParams()
  const nav = useNavigate()
  const { data, error } = useApi(() => api.session(id ?? ''), [id])
  if (error) return <div className="p-8 text-muted">Could not load this report ({error}).</div>
  if (!data) return <div className="p-8 text-muted">Loading report…</div>
  const s = data as SessionRecord
  const cam = s.summary.camera
  const told = s.feedback ?? {}
  const ck = s.checkin ?? {}
  const active = cam.active_s ? `${Math.floor(cam.active_s / 60)}:${String(Math.round(cam.active_s % 60)).padStart(2, '0')}` : '—'
  const dl = () => {
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `praxis-session-${s.id}.json`
    a.click()
  }
  return (
    <div className="p-8">
      <div className="flex items-start gap-4">
        <div>
          <h1 className="text-5xl">Your practice report</h1>
          <p className="text-muted">{s.date} · {s.title} · {s.summary.mode === 'nhpt' ? 'assessment' : 'left side'} · <Chip tone={s.status === 'complete' ? 'mint' : 'amber'}>{s.status === 'complete' ? 'Complete' : 'Ended early'}</Chip></p>
        </div>
        <div className="ml-auto flex gap-3"><Button variant="secondary" onClick={dl}>Download</Button><Button variant="secondary" title="Sharing arrives with cloud mode">Sharing</Button><Button onClick={() => nav('/')}>Done — back to Home</Button></div>
      </div>
      <div className="mt-6 grid grid-cols-[3fr_2fr] gap-6">
        <div className="space-y-6">
          <section className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="text-2xl">What the camera measured</h2>
            <div className="mt-3 grid grid-cols-5 gap-3">
              {[[active, 'active · rest excluded'], [String(cam.verified ?? 0), 'verified movements'], [String(cam.unverified ?? 0), 'unverified (hand hid cup or markers lost)'], [`${cam.coverage_pct ?? Math.round(100 * (cam.verified ?? 0) / Math.max(1, cam.reps_total ?? 1))}%`, 'tracking coverage'], [String(cam.posture_cues ?? cam.corrections ?? 0), 'posture cues']].map(([v, l]) => (
                <div key={l}><div className="text-3xl font-bold">{v}</div><div className="text-sm text-muted">{l}</div></div>
              ))}
            </div>
            {cam.nhpt_total_s != null && <p className="mt-4 text-xl">Nine-Hole Peg Test: <b>{cam.nhpt_total_s.toFixed(1)} s</b> · insertion-only · timing aid, not a clinical instrument</p>}
            <div className="mt-5 grid grid-cols-2 gap-6">
              {cam.reach_ms && <Bars values={cam.reach_ms} verified={cam.reach_verified} label="Waiter – cup · reach time per dot, ms · amber = unverified" />}
              {cam.peak_deg && <Bars values={cam.peak_deg} verified={cam.peak_verified} label="Arm to the front · peak angle per rep · ceiling 90°" ceiling={90} />}
              {cam.splits_s && <Bars values={cam.splits_s} label="Per-peg splits, s" />}
            </div>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-6">
            <div className="flex items-center gap-3"><h2 className="text-2xl">Coach notes for Dr. Rao</h2><Chip tone="neutral">{s.summary.coach.label} · confidence shown</Chip></div>
            <ul className="mt-3 divide-y divide-line">
              {s.summary.coach.notes.length === 0 && <li className="py-3 text-muted">No coach notes: nothing needed correcting or changing.</li>}
              {s.summary.coach.notes.map((n, i) => (
                <li key={i} className="flex items-start justify-between gap-4 py-3"><span className="text-lg">{n.text}</span><Chip tone={conf[n.confidence] ?? 'neutral'}>{n.confidence[0].toUpperCase() + n.confidence.slice(1)}</Chip></li>
              ))}
            </ul>
          </section>
        </div>
        <div className="space-y-6">
          <section className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="text-2xl">What you told us</h2>
            <div className="mt-3 flex gap-8">
              <div><div className="text-3xl font-bold">{String(ck.pain_before ?? '—')} → {String(told.pain_after ?? '—')}</div><div className="text-muted">pain before → after</div></div>
              <div><div className="text-3xl font-bold">{told.effort != null ? `${String(told.effort)}/10` : 'not recorded'}</div><div className="text-muted">effort</div></div>
            </div>
            <p className="mt-2">{told.compared ? `Felt ${told.compared === 'same' ? 'about the same as' : told.compared === 'first' ? 'like a first time —' : `${String(told.compared)} than`} last time.` : 'Comparison not recorded.'}</p>
            <p className="mt-2 text-sm text-muted">Exertion: {s.summary.exertion.level} · behavioural index</p>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="text-2xl">Next practice</h2>
            <p className="mt-2">{s.next_practice.text}</p>
            <div className="mt-3 flex items-center justify-between gap-3"><span className="text-muted">Proposed: {s.next_practice.proposal}</span><Chip tone="neutral">Proposal</Chip></div>
          </section>
          <section className="flex items-center justify-between rounded-2xl border border-line bg-surface p-6">
            <span className="text-lg">Report to Dr. Rao</span>
            <Chip tone="amber">{s.delivery.charAt(0).toUpperCase() + s.delivery.slice(1)}</Chip>
          </section>
          {s.summary.flags.length > 0 && (
            <section className="rounded-2xl border-2 border-red/40 bg-surface p-6">
              <h2 className="text-2xl">Therapist flags</h2>
              <ul className="mt-2 text-lg">{s.summary.flags.map((f, i) => <li key={i}>{f.rule}: {f.detail}</li>)}</ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../design/Button'
import { Chip } from '../../design/Chip'
import { api, useApi } from '../../lib/api'

function Line({ points, label, lowerIsBetter }: { points: { date: string; total_s: number }[]; label: string; lowerIsBetter?: boolean }) {
  if (!points.length) return <p className="text-muted">No assessments yet.</p>
  const xs = points.map((_, i) => (i / Math.max(1, points.length - 1)) * 300 + 10)
  const max = Math.max(...points.map((p) => p.total_s))
  const min = Math.min(...points.map((p) => p.total_s))
  const ys = points.map((p) => 90 - ((p.total_s - min) / Math.max(1e-6, max - min)) * 70)
  return (
    <div>
      <svg viewBox="0 0 320 110" className="h-32 w-full" role="img" aria-label={label}>
        <polyline fill="none" stroke="#1F5F5B" strokeWidth="3" points={xs.map((x, i) => `${x},${ys[i]}`).join(' ')} />
        {xs.map((x, i) => <circle key={i} cx={x} cy={ys[i]} r="5" fill="#1F5F5B" />)}
        <text x={xs[0]} y="105" fontSize="10" fill="#5C6B68">{points[0].date.slice(5)}</text>
        <text x={xs[xs.length - 1] - 30} y="105" fontSize="10" fill="#5C6B68">{points[points.length - 1].date.slice(5)}</text>
      </svg>
      <div className="text-muted">{points.length} assessments · same board and camera setup{lowerIsBetter ? ' · lower is better' : ''}</div>
    </div>
  )
}

/** Screen 10 · Progress and history. Limited-tracking sessions are greyed and excluded from
 *  comparison. Pain and effort are patient-reported. No recovery score. */
export function Progress() {
  const nav = useNavigate()
  const { data: p } = useApi(() => api.progress())
  const { data: sessions } = useApi(() => api.sessions())
  const [range] = useState('Last 4 weeks')
  const last = p?.nhpt_trend.at(-1)
  const comparable = p?.verified_per_session.filter((v) => !v.limited) ?? []
  return (
    <div className="p-8">
      <div className="flex items-center gap-4">
        <h1 className="text-4xl">Progress and history</h1>
        <div className="ml-auto flex gap-2">
          {[range, 'Waiter – cup', 'Left', 'Compare same setup'].map((f, i) => <span key={f} className={`rounded-full border-2 px-4 py-2 font-bold ${i === 0 ? 'border-teal bg-teal text-white' : 'border-line'}`}>{f}</span>)}
        </div>
      </div>
      <div className="mt-6 grid grid-cols-[1fr_1fr_1fr] gap-6">
        <section className="rounded-2xl border border-line bg-surface p-6">
          <div className="flex items-baseline justify-between"><h2 className="text-2xl">Nine-Hole Peg Test</h2><span className="text-muted">left · lower is better</span></div>
          {last && <div className="mt-2 text-3xl font-bold">{last.total_s.toFixed(1)} s</div>}
          <Line points={p?.nhpt_trend ?? []} label="NHPT trend" lowerIsBetter />
          <p className="mt-1 text-muted">Run separately from practice.</p>
        </section>
        <section className="rounded-2xl border border-line bg-surface p-6">
          <div className="flex items-baseline justify-between"><h2 className="text-2xl">Waiter – cup</h2><span className="text-muted">verified reaches per session</span></div>
          <div className="mt-4 flex h-32 items-end gap-2">
            {(p?.verified_per_session ?? []).map((v, i) => (
              <div key={i} data-testid="verified-bar" title={`${v.date}: ${v.verified} verified${v.limited ? ' · limited tracking' : ''}`} className={`flex-1 rounded-t ${v.limited ? 'bg-line' : 'bg-teal'}`} style={{ height: `${Math.min(100, (v.verified / Math.max(1, ...(p?.verified_per_session.map((x) => x.verified) ?? [1]))) * 100)}%` }} />
            ))}
          </div>
          <p className="mt-2 text-muted">{p?.verified_per_session.length ?? 0} sessions · grey = limited tracking, not comparable</p>
          {comparable.length >= 2 && <p className="text-lg">{comparable[0].verified} → {comparable[comparable.length - 1].verified} verified · same task, side and setup</p>}
        </section>
        <div className="space-y-6">
          <section className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="text-2xl">Practice</h2>
            <div className="mt-2 flex gap-8"><div><div className="text-3xl font-bold">{p?.practice.done ?? '—'}/{p?.practice.planned ?? '—'}</div><div className="text-muted">planned sessions done</div></div><div><div className="text-3xl font-bold">{p?.practice.hours ?? '—'} h</div><div className="text-muted">active time, 4 weeks</div></div></div>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="text-2xl">Pain and effort</h2>
            <p className="text-muted">What you reported, per session</p>
            <ul className="mt-2 text-lg">{(p?.pain_effort ?? []).slice(-6).map((x, i) => <li key={i} className={x.ended_early ? 'text-red' : ''}>{x.date.slice(5)} · pain after {x.pain_after ?? 'not recorded'} · effort {x.effort ?? 'not recorded'}{x.ended_early ? ' · session ended' : ''}</li>)}</ul>
          </section>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-[2fr_1fr] gap-6">
        <section className="rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-2xl">Session list</h2>
          <ul className="mt-2 divide-y divide-line">
            {(sessions ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-4 py-3">
                <span className="w-24 text-muted">{s.date.slice(5)}</span>
                <span className="flex-1 text-lg">{s.title}</span>
                <Chip tone={s.status === 'complete' ? 'mint' : 'amber'}>{s.status === 'ended_early' ? `Ended early · pain ${String(s.feedback?.pain_after ?? '')}` : s.mode === 'nhpt' ? 'Assessment' : 'Complete'}</Chip>
                <Chip tone={s.tracking === 'usable' ? 'mint' : 'amber'}>{s.tracking === 'usable' ? 'Usable tracking' : 'Limited tracking'}</Chip>
                <Button variant="secondary" className="min-h-11 px-4 text-base" onClick={() => nav(`/report/${s.id}`)}>Open</Button>
              </li>
            ))}
          </ul>
        </section>
        <div className="space-y-6">
          <section className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="text-2xl">Everyday goal log</h2>
            <p className="text-lg">Used a cup with my left hand — {p?.goal_log_count ?? 0} times this month</p>
            <Button variant="secondary" className="mt-3" onClick={() => api.logGoal('cup').then(() => window.location.reload())}>Log an attempt</Button>
          </section>
          <p className="rounded-2xl border border-line bg-surface p-5 text-muted">No recovery score is calculated. Different tasks are never combined.</p>
        </div>
      </div>
    </div>
  )
}

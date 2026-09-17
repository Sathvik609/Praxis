import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Checkbox } from '../../design/Checkbox'
import { Chip } from '../../design/Chip'
import { Pill } from '../../design/Pill'
import { Stat } from '../../design/Stat'
import { Bars } from '../../design/charts/Bars'
import { Line } from '../../design/charts/Line'
import { api, useApi } from '../../lib/api'

type Range = '4w' | '12w' | 'all'
type Task = 'cup' | 'arm'
const TASK_NAME: Record<Task, string> = { cup: 'Waiter – cup', arm: 'Arm to the front' }
const WEEKS: Record<Range, number | null> = { '4w': 4, '12w': 12, all: null }

/** Dates on or after `weeks` before the newest date in the data (not today, so a replayed or
 *  older store still shows something). */
function since(dates: string[], weeks: number | null): string | null {
  if (weeks == null || dates.length === 0) return null
  const newest = dates.reduce((a, b) => (a > b ? a : b))
  const d = new Date(newest)
  d.setDate(d.getDate() - weeks * 7)
  return d.toISOString().slice(0, 10)
}

/** Screen 10 · Progress and history. Limited-tracking sessions are hatched and labeled
 *  unverified; "Compare same setup only" drops them. Pain and effort are patient-reported.
 *  No recovery score; tasks are never combined. */
export function Progress() {
  const nav = useNavigate()
  const { data: p, error: pError, reload } = useApi(() => api.progress())
  const { data: sessions, error: sError } = useApi(() => api.sessions())
  const [range, setRange] = useState<Range>('4w')
  const [task, setTask] = useState<Task>('cup')
  const [sameSetup, setSameSetup] = useState(false)
  const [logNote, setLogNote] = useState<string | null>(null)

  if (!p && !pError) return <p className="p-8 text-xl text-muted" role="status">Loading your progress…</p>
  if (!p) return <p className="p-8 text-xl text-red-ink" role="alert">Could not load progress: {pError}. Is the session service running?</p>

  const allDates = [...p.verified_per_session.map((v) => v.date), ...(sessions ?? []).map((s) => s.date), ...p.nhpt_trend.map((t) => t.date)]
  const from = since(allDates, WEEKS[range])
  const inRange = (date: string) => !from || date >= from
  const perSession = p.verified_per_session.filter((v) => v.mode === task && inRange(v.date) && (!sameSetup || !v.limited))
  const comparable = perSession.filter((v) => !v.limited)
  const list = (sessions ?? []).filter((s) => s.mode === task && inRange(s.date))
  const trend = p.nhpt_trend // the weekly assessment history is always shown whole
  const last = p.nhpt_trend.at(-1)

  const logAttempt = () =>
    api
      .logGoal('cup')
      .then(() => {
        setLogNote('Logged.')
        reload()
      })
      .catch(() => setLogNote('Could not log — the session service is not reachable.'))

  return (
    <div className="p-8">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-4xl">Progress and history</h1>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Pill ariaLabel="Range" size="sm" value={range} onChange={setRange} options={[{ value: '4w', label: 'Last 4 weeks' }, { value: '12w', label: 'Last 12 weeks' }, { value: 'all', label: 'All time' }]} />
          <Pill ariaLabel="Task" size="sm" value={task} onChange={setTask} options={[{ value: 'cup', label: 'Waiter – cup' }, { value: 'arm', label: 'Arm to the front' }]} />
          <Checkbox label="Compare same setup only" checked={sameSetup} onChange={setSameSetup} />
        </div>
      </div>
      <div className="mt-6 grid grid-cols-3 gap-6">
        <Card title="Nine-Hole Peg Test" action={<Chip tone="neutral">lower is better</Chip>}>
          {last ? <Stat value={last.total_s.toFixed(1)} unit="s" label={`latest · ${last.date.slice(5)}`} /> : <p className="text-muted">No assessments yet.</p>}
          {trend.length > 0 && (
            <div className="mt-3">
              <Line title="Nine-Hole Peg Test" unit="s" points={trend.map((t) => ({ x: t.date.slice(5), y: t.total_s }))} />
            </div>
          )}
          <p className="mt-2 text-base text-muted">{trend.length} assessment{trend.length === 1 ? '' : 's'} · same board and camera setup · run separately from practice.</p>
        </Card>
        <Card title={TASK_NAME[task]} action={<Chip tone="neutral">verified per session</Chip>}>
          {perSession.length === 0 ? (
            <p className="text-muted">No {TASK_NAME[task]} sessions in this range.</p>
          ) : (
            <Bars title={TASK_NAME[task]} unit="reaches" values={perSession.map((v) => v.verified)} labels={perSession.map((v) => v.date.slice(5))} verified={perSession.map((v) => !v.limited)} />
          )}
          <p className="mt-2 text-base text-muted">{perSession.length} session{perSession.length === 1 ? '' : 's'} · limited tracking counts as unverified and is never compared.</p>
          {comparable.length >= 2 && <p className="mt-1 text-lg">{comparable[0].verified} → {comparable[comparable.length - 1].verified} verified · same task, side and setup</p>}
        </Card>
        <div className="space-y-6">
          <Card title="Practice">
            <div className="flex flex-wrap gap-8">
              {p.practice.planned == null ? (
                <Stat value={p.practice.done} label="sessions recorded here" />
              ) : (
                <Stat value={`${p.practice.done}/${p.practice.planned}`} label="planned sessions done" />
              )}
              <Stat value={p.practice.hours} unit="h" label="active time · rests excluded" />
            </div>
            {p.sample && (
              <p className="mt-3 flex flex-wrap items-center gap-2 text-base text-muted">
                <Chip tone="neutral">Sample</Chip>
                <span>{`${p.sample.done}/${p.sample.planned}`}</span>
                <span>planned · {p.sample.hours} h · illustrative history, not added to yours</span>
              </p>
            )}
          </Card>
          <Card title="Pain and effort">
            <p className="-mt-3 text-muted">What you reported, per session</p>
            <ul className="mt-2 text-lg">
              {p.pain_effort.slice(-6).map((x, i) => (
                <li key={i} className={x.ended_early ? 'font-bold text-red-ink' : ''}>
                  {x.date.slice(5)} · pain after {x.pain_after ?? 'not recorded'} · effort {x.effort ?? 'not recorded'}
                  {x.ended_early ? ' · session ended early' : ''}
                </li>
              ))}
              {p.pain_effort.length === 0 && <li className="text-muted">Nothing reported yet.</li>}
            </ul>
          </Card>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-[2fr_1fr] gap-6">
        <Card title="Session list" action={<Chip tone="neutral">{TASK_NAME[task]}</Chip>}>
          {sError && <p className="text-red-ink">Could not load sessions: {sError}</p>}
          {sessions && list.length === 0 && <p className="text-muted">No sessions yet for {TASK_NAME[task]} in this range.</p>}
          <ul className="divide-y divide-line">
            {list.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="w-16 text-muted">{s.date.slice(5)}</span>
                <span className="min-w-0 flex-1 text-lg">{s.title}</span>
                <Chip tone={s.status === 'complete' ? 'mint' : 'amber'}>{s.status === 'ended_early' ? `Ended early · pain ${String(s.feedback?.pain_after ?? '')}` : s.mode === 'nhpt' ? 'Assessment' : 'Complete'}</Chip>
                <Chip tone={s.tracking === 'usable' ? 'mint' : 'amber'}>{s.tracking === 'usable' ? 'Usable tracking' : 'Limited tracking'}</Chip>
                <Button variant="secondary" aria-label={`Open ${s.title} · ${s.date}`} onClick={() => nav(`/report/${s.id}`)}>Open</Button>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-6">
          <Card title="Everyday goal log">
            <p className="text-lg">Used a cup with my left hand — {p.goal_log_count} times this month</p>
            {logNote && <p className="text-base text-muted" role="status">{logNote}</p>}
            <Button variant="secondary" className="mt-3" onClick={logAttempt}>Log an attempt</Button>
          </Card>
          <Card padding="sm"><p className="text-muted">No recovery score is calculated. Different tasks are never combined.</p></Card>
        </div>
      </div>
    </div>
  )
}

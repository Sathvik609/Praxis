import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '../../design/Card'
import { Chip } from '../../design/Chip'
import { Pill } from '../../design/Pill'
import { Stat } from '../../design/Stat'
import { api, isReplaySession, useApi, type Progress as ProgressData, type SessionRecord } from '../../lib/api'
import { countOf, plural } from '../../lib/plural'
import { exerciseOfSession, isHiddenSession } from '../../lib/seed'

type Range = '4w' | 'all'
const WEEKS: Record<Range, number | null> = { '4w': 4, all: null }
/** One Waiter – cup bar: verified reaches, plus the unverified ones (hatched) when the session
 *  recorded them (`verified_per_session` does not). */
type CupRow = { date: string; verified: number; unverified: number | null; limited: boolean; illustrative: boolean }
type ArmRow = { date: string; deg: number; sample: boolean }

/** Dates on or after `weeks` before the newest date in the data (not today, so a replayed or
 *  older store still shows something). */
function since(dates: string[], weeks: number | null): string | null {
  if (weeks == null || dates.length === 0) return null
  const newest = dates.reduce((a, b) => (a > b ? a : b))
  const d = new Date(newest)
  d.setDate(d.getDate() - weeks * 7)
  return d.toISOString().slice(0, 10)
}

/** Waiter – cup rows, oldest first. The session list carries the exercise and the unverified
 *  count, so it is the source when it loaded; `verified_per_session` is the fallback. Replays
 *  and hidden exercises are never charted. */
function cupRowsOf(counted: SessionRecord[] | null, perSession: ProgressData['verified_per_session']): CupRow[] {
  const rows: CupRow[] = counted
    ? counted.filter((s) => exerciseOfSession(s)?.id === 'cup').map((s) => ({ date: s.date, verified: s.summary.camera.verified ?? 0, unverified: s.summary.camera.unverified ?? null, limited: s.tracking !== 'usable', illustrative: !!s.illustrative }))
    : perSession.filter((v) => v.source !== 'replay' && exerciseOfSession({ mode: v.mode, exercise: v.exercise })?.id === 'cup').map((v) => ({ date: v.date, verified: v.verified, unverified: null, limited: v.limited, illustrative: !!v.illustrative }))
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** A "first → last" comparison only within one kind: the patient's own full-tracking sessions
 *  when there are two, else an all-sample range; never across sample and real. */
function comparableRun(rows: CupRow[]): CupRow[] {
  const usable = rows.filter((v) => !v.limited)
  const own = usable.filter((v) => !v.illustrative)
  if (own.length >= 2) return own
  return usable.length >= 2 && usable.every((v) => v.illustrative) ? usable : []
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtD = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? '')
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]}` : d
}
/** Upper median, as the designers' build computes it. */
const med = (a: number[]) => {
  const b = [...a].sort((x, y) => x - y)
  return b.length ? b[Math.floor(b.length / 2)] : null
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const utcMs = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime()

const W = 400
const H = 150
type Pt = [number, number | null]
const line = (vals: (number | null)[], lo: number, hi: number, padT = 24, padB = 22): Pt[] =>
  vals.map((v, i) => [vals.length < 2 ? W / 2 : 18 + (i * (W - 36)) / (vals.length - 1), v == null ? null : padT + (1 - (v - lo) / Math.max(1e-6, hi - lo)) * (H - padT - padB)])
const path = (pts: Pt[]) =>
  pts
    .filter((q) => q[1] != null)
    .map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${(q[1] as number).toFixed(1)}`)
    .join(' ')
const dot = (q: Pt | undefined, cls: string, k: string | number) => (q && q[1] != null ? <i key={k} className={`pg-dot ${cls}`} style={{ left: `${(q[0] / W) * 100}%`, top: `${(q[1] / H) * 100}%` }} /> : null)
const plot = (svg: ReactNode, dots: ReactNode[], sm = false) => (
  <div className={`pg-plot ${sm ? 'pg-plot-sm' : ''}`}>
    {svg}
    {dots}
  </div>
)
const tt = (name: string, sub?: string) => (
  <span className="pg-t">
    {name}
    {sub && <small>{sub}</small>}
  </span>
)
const sampleChip = (on: boolean) => (on ? <span className="pg-sample" title="Illustrative history, not yours">Sample</span> : null)

/** Screen 10 · Progress and history (design v2, 6 Oct). Every chart is the patient's own data:
 *  sample history is drawn hollow/outlined and labelled Sample; replays are listed with a badge
 *  and never charted; unverified movements are shown next to verified ones; the arm limit is the
 *  prescription's ceiling; a clinician flag is named only when a flag row exists. Tasks are never
 *  combined and there is no recovery score. Design review 21 Oct removed the everyday goal log:
 *  the camera only sees in-session activity, so the session list takes its height. */
export function Progress() {
  const nav = useNavigate()
  const { data: p, error: pError } = useApi(() => api.progress())
  const { data: sessions, error: sError } = useApi(() => api.sessions())
  const { data: me } = useApi(() => api.me())
  const { data: rx } = useApi(() => api.prescription())
  const { data: flags } = useApi(() => api.flags())
  const [range, setRange] = useState<Range>('4w')

  if (!p && !pError) return <p className="p-8 text-xl text-muted" role="status">Loading your progress…</p>
  if (!p) return <p className="p-8 text-xl text-red-ink" role="alert">Could not load progress: {pError}. Is the session service running?</p>

  const shown = (sessions ?? []).filter((s) => !isHiddenSession(s))
  const counted = shown.filter((s) => !isReplaySession(s))
  const allDates = [...p.verified_per_session.map((v) => v.date), ...counted.map((s) => s.date), ...p.nhpt_trend.map((t) => t.date)]
  const from = since(allDates, WEEKS[range])
  const inRange = (date: string) => !from || date >= from

  // Nine-Hole Peg Test: the weekly history is always shown whole; each point is sample or own.
  const ownNhptDates = new Set(counted.filter((s) => s.mode === 'nhpt' && !s.illustrative).map((s) => s.date))
  const trend = p.nhpt_trend.map((t) => ({ ...t, kind: t.kind ?? (sessions && !ownNhptDates.has(t.date) ? 'sample' : 'live') }))
  const ownTrend = trend.filter((t) => t.kind === 'live')
  const sampleTrend = trend.filter((t) => t.kind === 'sample')
  const trendNote =
    ownTrend.length && sampleTrend.length
      ? `${countOf(ownTrend.length, 'assessment')} of yours · ${sampleTrend.length} sample · same board and camera setup · run separately from practice.`
      : ownTrend.length
        ? `${countOf(ownTrend.length, 'assessment')} · same board and camera setup · run separately from practice.`
        : trend.length
          ? `${countOf(sampleTrend.length, 'sample assessment')} · illustrative, not yours · run separately from practice.`
          : 'Run weekly, separately from practice.'
  const nhVals = trend.map((t) => t.total_s)
  const nhPts = line(nhVals, Math.min(...nhVals) - 4, Math.max(...nhVals) + 4)

  // Waiter – cup
  const cupRows = cupRowsOf(sessions ? counted : null, p.verified_per_session).filter((r) => inRange(r.date))
  const run = comparableRun(cupRows)
  const cupMax = Math.max(10, ...cupRows.map((r) => r.verified + (r.unverified ?? 0)))
  const cupLabel = (r: CupRow) => `${fmtD(r.date)} ${r.verified} verified${r.unverified != null ? `, ${r.unverified} unverified` : ''}${r.limited ? ' (limited tracking)' : ''}${r.illustrative ? ' · Sample' : ''}`

  // Arm out to the side: median verified peak per session (camera-relative), limit = prescription ceiling
  const armLimit = num(rx?.exercises?.abduction?.ceiling_deg)
  const armRows: ArmRow[] = counted
    .filter((s) => exerciseOfSession(s)?.id === 'abduction' && inRange(s.date))
    .map((s) => {
      const peaks = s.summary.camera.peak_deg ?? []
      const ok = s.summary.camera.peak_verified
      const m = med(peaks.filter((_, i) => ok?.[i] !== false))
      return { date: s.date, deg: m == null ? 0 : Math.round(m), sample: !!s.illustrative }
    })
    .filter((r) => r.deg > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const armLo = Math.min(30, ...armRows.map((r) => r.deg))
  const armHi = Math.max(armLimit ?? 0, ...armRows.map((r) => r.deg)) + 4
  const armPts = line(armRows.map((r) => r.deg), armLo, armHi)
  const limY = armLimit != null ? 24 + (1 - (armLimit - armLo) / Math.max(1e-6, armHi - armLo)) * (H - 46) : null
  const armOver = armLimit != null ? armRows.filter((r) => r.deg > armLimit).length : 0
  const armLimitNote = armLimit == null ? '' : armOver ? ` · ${armOver} ${plural(armOver, 'session')} above the therapist's ${armLimit}° limit` : ` · stays within the therapist's ${armLimit}° limit`

  // Session list: every exercise, newest first; replays carry a badge, sample rows a chip.
  const clinician = me?.program.clinician ?? rx?.clinician ?? 'your therapist'
  const flagOf = (s: SessionRecord) => {
    const row = (flags ?? []).find((f) => f.session_id === s.id)
    if (row) return row.reviewed ? 'reviewed' : 'queued'
    return s.summary?.flags?.length ? 'queued' : null
  }
  const listRows = shown.filter((s) => inRange(s.date)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const subOf = (s: SessionRecord) => {
    const c = s.summary?.camera ?? {}
    if (s.mode === 'nhpt') {
      const total = num(c.nhpt_total_s)
      return total != null && !s.title.includes(' s') ? `${total.toFixed(1)} s · lower is better` : 'Timed assessment · lower is better'
    }
    const pain = num(s.feedback?.pain_after)
    if (s.status === 'ended_early') {
      const flag = flagOf(s)
      return `Stopped early${pain != null ? ` · pain ${pain}` : ''}${flag ? ` · flag for ${clinician} · ${flag}` : ''}`
    }
    const v = num(c.verified)
    const u = num(c.unverified)
    const active = num(c.active_s)
    return [v != null ? `${v} verified ${plural(v, 'movement')}` : null, u != null ? `${u} unverified` : null, active != null ? `${Math.max(1, Math.round(active / 60))} active min` : null, s.tracking === 'limited' ? 'limited tracking' : null].filter(Boolean).join(' · ')
  }

  // Practice: the patient's own; the sample is a labelled secondary line. Streak from live sessions only.
  const pr = p.practice
  const liveDates = [...new Set(counted.filter((s) => !s.illustrative).map((s) => s.date))].sort()
  let streak = 0
  let best = 0
  let prev: number | null = null
  for (const d of liveDates) {
    const t = utcMs(d)
    streak = prev != null && t - prev === 864e5 ? streak + 1 : 1
    best = Math.max(best, streak)
    prev = t
  }

  // Pain and effort: what the patient reported; sample rows drawn hollow, never in the narrative.
  const pe = p.pain_effort.filter((x) => x.source !== 'replay' && inRange(x.date))
  const peOwn = pe.filter((x) => !x.illustrative)
  const painVals = peOwn.map((x) => x.pain_after).filter((v): v is number => v != null)
  const painMode = med(painVals)
  const spikes = painMode == null ? 0 : painVals.filter((v) => v - painMode >= 2).length
  const effortVals = peOwn.map((x) => x.effort).filter((v): v is number => v != null)
  const peP = line(pe.map((x) => x.pain_after), 0, 10, 26, 14)
  const peE = line(pe.map((x) => x.effort), 0, 10, 26, 14)
  const spike = pe.findIndex((x) => x.ended_early && !x.illustrative)

  return (
    <div className="pg">
      <div className="pg-head">
        <h1 className="text-4xl">Progress and history</h1>
        <Pill ariaLabel="Range" size="sm" value={range} onChange={setRange} options={[{ value: '4w', label: 'Last 4 weeks' }, { value: 'all', label: 'All activities' }]} />
      </div>
      <div className="pg-row1">
        <Card className="pg-card" title={tt('Nine-Hole Peg Test', `${me?.side ? `${me.side} · ` : ''}lower is better`)} action={sampleChip(sampleTrend.length > 0)}>
          {trend.length ? (
            plot(
              <svg className="pg-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Nine-Hole Peg Test: ${trend.map((t) => `${fmtD(t.date)} ${t.total_s} s${t.kind === 'sample' ? ' sample' : ''}`).join(', ')}`}>
                <line x1={0} x2={W} y1={H - 22} y2={H - 22} className="pg-axis" />
                <path d={path(nhPts)} className="pg-line" />
              </svg>,
              nhPts.map((q, i) => dot(q, trend[i].kind === 'sample' ? 'pg-dot-s' : '', i)),
            )
          ) : (
            <p className="pg-empty">No assessments yet.</p>
          )}
          {trend.length > 0 && (
            <div className="pg-xl">
              <span>{`${fmtD(trend[0].date)} · ${trend[0].total_s} s`}</span>
              <span>{`${fmtD(trend[trend.length - 1].date)} · ${trend[trend.length - 1].total_s} s`}</span>
            </div>
          )}
          <p className="pg-note">{trendNote}</p>
        </Card>
        <Card className="pg-card" title={tt('Waiter – cup', 'verified reaches per session')} action={sampleChip(cupRows.some((r) => r.illustrative))}>
          {cupRows.length ? (
            <div className="pg-bars" role="img" aria-label={`Waiter – cup per session: ${cupRows.map(cupLabel).join('; ')}`}>
              {cupRows.map((r, i) => {
                const total = r.verified + (r.unverified ?? 0)
                return (
                  <i key={i} className={r.limited ? 'pg-bar-l' : r.illustrative ? 'pg-bar-s' : 'pg-bar-live'} style={{ height: `${Math.max(6, (total / cupMax) * 100)}%` }} title={cupLabel(r)}>
                    {r.unverified ? <b className="pg-bar-u" style={{ height: `${(r.unverified / Math.max(1, total)) * 100}%` }} /> : null}
                  </i>
                )
              })}
            </div>
          ) : (
            <p className="pg-empty">No Waiter – cup sessions in this range.</p>
          )}
          {cupRows.length > 0 && (
            <div className="pg-xl">
              <span>{countOf(cupRows.length, 'session')}</span>
              <span>{fmtD(cupRows[cupRows.length - 1].date)}</span>
            </div>
          )}
          <p className="pg-note">
            {run.length >= 2
              ? `${run[0].verified} → ${run[run.length - 1].verified} verified · same task, side and setup.${run[0].illustrative ? ' Sample history, not yours.' : ''}${cupRows.some((r) => r.limited) ? ' The pale bar is a session the camera could not see well enough to compare.' : ''}`
              : 'Verified placements per session; hatched tops are unverified. Limited-tracking sessions show pale and are never compared.'}
          </p>
        </Card>
        <Card className="pg-card" title={tt('Arm out to the side', 'peak angle per session')} action={sampleChip(armRows.some((r) => r.sample))}>
          {armRows.length ? (
            plot(
              <svg className="pg-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Arm out to the side, peak angle: ${armRows.map((r) => `${fmtD(r.date)} ${r.deg}°${r.sample ? ' sample' : ''}`).join(', ')}`}>
                {limY != null && <line x1={0} x2={W} y1={limY} y2={limY} className="pg-limit" />}
                <line x1={0} x2={W} y1={H - 22} y2={H - 22} className="pg-axis" />
                <path d={path(armPts)} className="pg-line" />
              </svg>,
              armPts.map((q, i) => dot(q, armRows[i].sample ? 'pg-dot-s' : '', i)),
            )
          ) : (
            <p className="pg-empty">No arm sessions in this range.</p>
          )}
          {armRows.length > 0 && (
            <div className="pg-xl">
              <span>{`${armRows[0].deg}° · ${fmtD(armRows[0].date)}`}</span>
              <span className="pg-xl-lim">{`${armLimit != null ? `${armLimit}° limit · ` : ''}axis starts at ${armLo}° · camera estimate`}</span>
              <span>{`${armRows[armRows.length - 1].deg}° · ${fmtD(armRows[armRows.length - 1].date)}`}</span>
            </div>
          )}
          <p className="pg-note">
            {armRows.length >= 2 ? `${armRows[0].deg}° → ${armRows[armRows.length - 1].deg}° · median verified peak per session${armLimitNote}` : 'Median verified peak angle per session, estimated by the camera.'}
          </p>
        </Card>
      </div>
      <div className="pg-row2">
        <div className="pg-main">
          <Card className="pg-card pg-list" title="Session list">
            {sError && <p className="text-red-ink">Could not load sessions: {sError}</p>}
            <ul className="pg-rows">
              {listRows.map((s) => (
                <li key={s.id}>
                  <span className="pg-date">{fmtD(s.date)}</span>
                  <span className="pg-what">
                    <b>{s.title}</b>
                    <small>{subOf(s)}</small>
                  </span>
                  {s.illustrative && sampleChip(true)}
                  {isReplaySession(s) && <Chip tone="amber">Replay</Chip>}
                  <Chip tone={s.status === 'ended_early' ? 'amber' : 'mint'}>{s.status === 'ended_early' ? 'Ended early' : s.mode === 'nhpt' ? 'Assessment' : 'Complete'}</Chip>
                  <button type="button" className="pg-open" aria-label={`Open ${s.title} · ${fmtD(s.date)}`} onClick={() => nav(`/details/report/${s.id}`)}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
            {listRows.length === 0 && sessions && <p className="pg-empty">No sessions in this range.</p>}
          </Card>
        </div>
        <div className="pg-side">
          <Card className="pg-card" title="Practice">
            <div className="pg-two">
              {pr.planned == null ? (
                <Stat value={pr.done} label={`${plural(pr.done, 'session')} recorded`} />
              ) : (
                // Planned practice days from the prescription's schedule since the first live session.
                <Stat value={`${pr.days_done ?? pr.done}/${pr.planned}`} label="planned days practised" />
              )}
              <Stat value={pr.hours} unit="h" label="active time" />
            </div>
            <p className="pg-note">{best >= 2 ? `Longest run: ${best} practice days in a row` : `${liveDates.filter((d) => inRange(d)).length} practice days in this range · rests excluded`}</p>
            {p.sample && (
              <p className="pg-note">
                {sampleChip(true)} <span>{`${p.sample.done}/${p.sample.planned} planned · ${p.sample.hours} h · illustrative, not added to yours`}</span>
              </p>
            )}
          </Card>
          <Card className="pg-card pg-pe" title={tt('Pain and effort', 'you reported, per session')} action={sampleChip(pe.some((x) => x.illustrative))}>
            {pe.length ? (
              plot(
                <svg className="pg-chart pg-chart-sm" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Pain after and effort per session: ${pe.map((x) => `${fmtD(x.date)} pain ${x.pain_after ?? 'not recorded'}, effort ${x.effort ?? 'not recorded'}${x.illustrative ? ' (sample)' : ''}`).join('; ')}`}>
                  <line x1={0} x2={W} y1={H - 14} y2={H - 14} className="pg-axis" />
                  <path d={path(peE)} className="pg-line pg-eff" />
                  <path d={path(peP)} className="pg-line pg-pain" />
                </svg>,
                [...pe.map((x, i) => (x.illustrative ? dot(peP[i], 'pg-dot-s', `s${i}`) : null)), spike >= 0 ? dot(peP[spike], 'pg-dot-spike', 'sp') : null],
                true,
              )
            ) : (
              <p className="pg-empty">Nothing reported yet.</p>
            )}
            {spike >= 0 && <p className="pg-spike-l">{`${fmtD(pe[spike].date)} · pain ${pe[spike].pain_after} · session ended early`}</p>}
            <div className="pg-legend">
              <span>
                <i className="pg-lg-pain" />
                pain after
              </span>
              <span>
                <i className="pg-lg-eff" />
                effort
              </span>
            </div>
            <p className="pg-note">
              {painVals.length
                ? `Pain steady at ${painMode}${spikes ? ` except ${spikes === 1 ? 'once' : `${spikes} times`}` : ''}.${effortVals.length >= 2 ? ` Effort ${effortVals[effortVals.length - 1] < effortVals[0] ? 'drifting down' : effortVals[effortVals.length - 1] > effortVals[0] ? 'drifting up' : 'steady'}.` : ''}`
                : 'Pain is asked after each session.'}
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}

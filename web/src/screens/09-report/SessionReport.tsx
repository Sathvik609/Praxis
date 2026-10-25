import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Bars } from '../../design/charts/Bars'
import { Chip } from '../../design/Chip'
import { Check, Download, Share2 } from '../../design/Icon'
import { Overlay, OverlayActions } from '../../design/Overlay'
import { Stat } from '../../design/Stat'
import { capSentences, noteText } from '../../lib/coachNotes'
import { plural } from '../../lib/plural'
import { api, isReplaySession, useApi, type SessionCoach, type SessionRecord, type SessionSummary } from '../../lib/api'
import { processingPlace } from '../../lib/config'
import { dayPlan, demoUrl, nextExercise, sideOr } from '../../lib/day'
import { DAY_MINUTES, DAY_ORDER, doseFor } from '../../lib/plan'
import { EQUIPMENT, angleTarget, exerciseById, exerciseOfSession, isHiddenSession, libTags, sessionExerciseName, type ExerciseId } from '../../lib/seed'
import { FeedbackOverlay } from '../08-feedback/FeedbackOverlay'
import { useDayRun } from './DayNext'

const conf = { high: 'mint', medium: 'amber', low: 'neutral' } as const

function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/** `summary.latency` from the service (Sprint D, D-LAT): percentiles over the whole session,
 *  null when the browser sent no capture time (replay) or nothing happened. */
type LatencyBlock = {
  capture_to_event_p50: number | null
  capture_to_event_p95: number | null
  proc_p50: number | null
  proc_p95: number | null
  event_to_cue_p50: number | null
  event_to_cue_p95: number | null
  frames: number
  dropped: number
  cues: number
}

const pp = (a: number | null, b: number | null) => (a != null && b != null ? `${Math.round(a)} / ${Math.round(b)} ms` : '—')

function latencyText(l: LatencyBlock): string {
  // 25 Oct: a replay has no camera, so it has no capture time and its "event→cue —" read oddly.
  if (l.capture_to_event_p50 == null) return `Latency p50 / p95 · OpenCV processing ${pp(l.proc_p50, l.proc_p95)} · ${l.frames} frames · replay: no camera, so no capture or cue times`
  return `Latency p50 / p95 · capture→event ${pp(l.capture_to_event_p50, l.capture_to_event_p95)} · event→cue ${pp(l.event_to_cue_p50, l.event_to_cue_p95)} · ${l.frames} frames, ${l.dropped} dropped`
}

const mmss = (s: number | undefined) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '—')

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-09-12" → "Sat 12 Sep" (the artifact's meta-line date); anything else as stored. */
function prettyDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '')
  if (!m) return date
  const d = new Date(+m[1], +m[2] - 1, +m[3])
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

type Camera = SessionSummary['camera']
const coverageOf = (c: Camera) => c.coverage_pct ?? Math.round((100 * (c.verified ?? 0)) / Math.max(1, c.reps_total ?? 1))
const postureOf = (c: Camera) => c.posture_cues ?? c.corrections ?? 0
const ceilingOf = (c: Camera) => (typeof c.ceiling_deg === 'number' ? c.ceiling_deg : 90)

const DIFF: Record<string, string> = { too_easy: 'Too easy', just_right: 'Just right', hard: 'Hard', couldnt_finish: "Couldn't finish" }
const AGAIN: Record<string, string> = { yes_easily: 'Yes, easily', yes_probably: 'Yes, probably', not_sure: 'Not sure', no: 'No' }

/** "Dr. Anita Rao" → "Dr. Rao" (the artifact's short form); anything else as it is. */
const shortName = (c: string) => c.replace(/^Dr\.? [A-Z][a-z]+ /, 'Dr. ')

type Finished = { exercise: ExerciseId; reportId: string }

/** The rule coach's short name from the service label ("Rule-based coach · LLM agent pending" →
 *  "Rule-based coach"), for a rule note listed beside the agent's note. */
const ruleName = (c: SessionCoach) => c.label.split(' · ')[0]

// How long the report waits for a Claude agent's late session note: every 2 s for up to 20 s.
const NOTE_POLL_MS = 2000
const NOTE_POLLS = 10

/** Screen 09 · Session report (design v2, 6 Oct; designers' artifact `SessionReport`). Loads only
 *  `api.session(id)`, plus the other sessions of today's run from `readDay().finished[].reportId`.
 *  Camera measurements are separated from what the patient reported; in today's run each
 *  exercise column keeps its own verified · unverified counts and only active time is summed.
 *  The coach section is titled "Agent" only when the Claude agent's note is shown, else with the
 *  service's rule-coach label; notes are cut to NOTE_SENTENCES sentences. "Edit feedback" PATCHes
 *  the stored session (ruling R4). Kept from v1 (ruling R7): exertion chip, latency line,
 *  "Nothing here is combined into a score." Side comes from `summary.camera.side` only.
 *  Team design review (21 Oct): metrics first, one legend for the bars, less copy; therapist
 *  flags and the delivery card left this patient report (flags stay on screen 11, delivery
 *  status in Sharing). */
export function SessionReport() {
  const { id } = useParams()
  const nav = useNavigate()
  const { data: fetched, error, reload } = useApi(() => api.session(id ?? ''), [id])
  const { data: me } = useApi(() => api.me())
  const [edited, setEdited] = useState<SessionRecord | null>(null)
  const data = edited ?? fetched
  // The Claude agent writes its session note after the session is saved (10 Oct walkthrough: a
  // report opened right away missed it until a reload). While the summary says an agent was
  // active and has no note, ask again every NOTE_POLL_MS, at most NOTE_POLLS times; the page
  // shows nothing while waiting and the note appears when it lands.
  const [polls, setPolls] = useState(0)
  const fetchedCoach = (fetched as Partial<SessionRecord> | null)?.summary?.coach
  const notePending = !!fetchedCoach?.agent && !fetchedCoach.note?.text
  useEffect(() => {
    if (!notePending || polls >= NOTE_POLLS) return
    const h = setTimeout(() => {
      setPolls((n) => n + 1)
      reload()
    }, NOTE_POLL_MS)
    return () => clearTimeout(h)
  }, [notePending, polls, reload])
  const has = !!data?.summary && !isHiddenSession(data)
  const dayRun = useDayRun(data?.summary && !isReplaySession(data) ? data.id : undefined, data?.summary?.mode, data?.summary?.stopped) // day flow (Track C)
  const thisId = has ? (exerciseOfSession(data!)?.id ?? null) : null
  // The day block and per-exercise columns belong only to a report of today's run.
  const inDay = !!dayRun && !!thisId && DAY_ORDER.includes(thisId)
  // Other sessions of today's run: the latest report of each other day exercise.
  const others: Finished[] = inDay
    ? DAY_ORDER.filter((x) => x !== thisId)
        .map((x) => [...dayRun!.finished].reverse().find((f) => f.exercise === x && f.reportId !== data!.id))
        .filter((f): f is Finished => !!f)
    : []
  const othersKey = others.map((f) => `${f.exercise}:${f.reportId}`).join(',')
  const { data: otherRecs } = useApi(
    () => Promise.all(others.map((f) => api.session(f.reportId).then((r) => [f.exercise, r] as const).catch(() => null))),
    [othersKey],
  )
  const [sharing, setSharing] = useState(false)
  const [editFb, setEditFb] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const clinician = me?.program?.clinician?.split(',')[0] ?? 'your therapist'
  // The service answers unknown ids with 200 and `{ error }`, so a body without a summary is
  // an error too, not a record.
  const bodyError = data && !(data as Partial<SessionRecord>).summary ? String((data as { error?: string }).error ?? 'no session data') : null
  // 28 Sep: a session of a hidden exercise is never shown (the service does not serve it either).
  const hiddenError = data?.summary && isHiddenSession(data) ? 'this exercise is not part of your program' : null
  const problem = error ?? bodyError ?? hiddenError

  if (problem) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6">
        <Card tone="watch" title="Could not load this report">
          <p className="text-lg">The report could not be fetched ({problem}). Reports are kept in the Praxis session store until they are delivered.</p>
          <div className="mt-4">
            <Button variant="secondary" onClick={() => nav('/details')}>Back to Home</Button>
          </div>
        </Card>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6">
        <Card>
          <p role="status" className="text-lg text-muted">Loading report…</p>
        </Card>
      </div>
    )
  }
  const s = data
  const cam = s.summary.camera
  const told = s.feedback ?? {}
  const ck = s.checkin ?? {}
  const side = typeof cam.side === 'string' && cam.side ? cam.side : null
  const isCupSession = s.summary.mode === 'cup'
  // Arm out to the side: lifts past the in-code ceiling (`camera.above_ceiling`, service 10 Oct),
  // beside the posture cues; summaries saved before 10 Oct carry none and show nothing.
  const aboveCeiling = s.summary.mode === 'arm' && typeof cam.above_ceiling === 'number' ? cam.above_ceiling : undefined
  const dl = () => {
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `praxis-session-${s.id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  const compared = told.compared
    ? `Felt ${told.compared === 'same' ? 'about the same as' : told.compared === 'first' ? 'like a first time —' : `${String(told.compared)} than`} last time.`
    : null
  const toldLine =
    [
      typeof told.difficulty === 'string' ? `${DIFF[told.difficulty] ?? told.difficulty}.` : null,
      typeof told.again_tomorrow === 'string' ? `Again tomorrow: ${AGAIN[told.again_tomorrow] ?? told.again_tomorrow}.` : compared,
    ]
      .filter(Boolean)
      .join(' ') || 'Nothing else recorded.'
  const latency = (s.summary as { latency?: LatencyBlock }).latency ?? null
  // Peak angles belong to an arm exercise: the one this session ran, named from the registry
  // (or the service's own name); a combined sample session falls back to Arm out to the side.
  const ex = exerciseOfSession(s)
  const armEx = ex?.session === 'arm' ? ex : exerciseById('abduction')!
  const armName = ex?.session === 'arm' ? sessionExerciseName(s) : armEx.name
  const swings = armEx.id === 'pendulum'
  const peakTarget = angleTarget(s.summary as { target_deg?: number | null; ceiling_deg?: number | null }, armEx.id)

  // ---- today's run --------------------------------------------------------------------
  const otherOf = (x: ExerciseId) => otherRecs?.find((r) => r?.[0] === x)?.[1] ?? null
  const doneIds = inDay ? DAY_ORDER.filter((x) => x !== thisId && (dayRun!.done.includes(x) || dayRun!.finished.some((f) => f.exercise === x))) : []
  const pendingIds = inDay ? DAY_ORDER.filter((x) => x !== thisId && !doneIds.includes(x)) : []
  const doneCount = DAY_ORDER.length - pendingIds.length
  // Fix #16: a stop rule (or a finished short day) leaves nothing to start, so the day card shows.
  const next = inDay ? nextExercise(dayRun!) : null
  const canStart = !!next
  const daySide = dayRun?.checkin?.side ?? sideOr(null)
  const dayTitle = inDay ? DAY_ORDER.map((x) => exerciseById(x)?.name ?? x).join(' + ') : s.title
  const ctx = s.summary.mode === 'nhpt' ? 'assessment' : side ? `${side} side` : null
  // the service marks a peg test "limited" after any tracking loss: pegs seated while the board
  // was out of view cannot be verified, so the time is not a clean result (store.py)
  const nhptLimited = s.summary.mode === 'nhpt' && s.tracking === 'limited'
  const statusChip =
    s.status !== 'complete' ? <Chip tone="amber">Ended early</Chip> : canStart ? <Chip tone="amber">{`${doneCount} of ${DAY_ORDER.length} done`}</Chip> : <Chip tone="mint">Complete</Chip>
  // Only active time is summed across today's exercises; counts stay per exercise.
  const activeParts = [cam, ...(inDay ? doneIds.map((x) => otherOf(x)?.summary?.camera).filter((c): c is Camera => !!c) : [])]
  const activeSum = activeParts.reduce((a, c) => a + (Number(c.active_s) || 0), 0)

  const reportOf = (x: ExerciseId) => [...(dayRun?.finished ?? [])].reverse().find((f) => f.exercise === x)
  // The run's tier: the columns show the dose this day actually ran, as Next practice does.
  const runTier = dayRun?.checkin?.tier ?? 'full'
  const doseOf = (e: ReturnType<typeof exerciseById>) => (e ? doseFor(e, runTier) : undefined)
  const srcFor = (x: ExerciseId) => {
    const rec = x === thisId ? s : otherOf(x)
    if (!rec?.summary || isHiddenSession(rec)) return null
    const c = rec.summary.camera
    const isCup = rec.summary.mode === 'cup'
    return {
      c,
      isCup,
      vals: isCup ? (c.reach_ms ?? []) : (c.peak_deg ?? []).map((v) => Math.round(v)),
      ver: isCup ? c.reach_verified : c.peak_verified,
      tgt: isCup ? undefined : angleTarget(rec.summary as { target_deg?: number | null; ceiling_deg?: number | null }, x),
    }
  }
  const perfCol = (x: ExerciseId) => {
    const e = exerciseById(x)
    const src = srcFor(x)
    if (!src) {
      const rep = reportOf(x)
      return (
        <div className="rp-ex" key={x}>
          <div className="rp-ex-h"><b>{e?.name ?? x}</b><Chip tone="mint">Done</Chip></div>
          <p className="rp-ex-sub">{doseOf(e)}</p>
          <div className="rp-done-other">
            <Check aria-hidden size={18} />
            <span>Done today</span>
            {rep && <Button variant="link" onClick={() => nav(`/details/report/${rep.reportId}`)}>Open its report</Button>}
          </div>
        </div>
      )
    }
    const rep = x !== thisId ? reportOf(x) : undefined
    return barsCol(x, { name: e?.name ?? armName, dose: doseOf(e), c: src.c, counts: [src.c.verified ?? 0, src.c.unverified ?? 0], isCup: src.isCup, vals: src.vals, ver: src.ver, tgt: src.tgt, link: rep ? `/details/report/${rep.reportId}` : undefined })
  }
  /** One exercise column (artifact `rp-ex`): its own verified · unverified counts and per-rep bars. */
  const barsCol = (key: string, o: { name: string; dose?: string; c: Camera; counts: [number, number]; isCup: boolean; vals: number[]; ver?: boolean[] | null; tgt?: number | null; link?: string }) => {
    const { c, isCup, vals, ver, tgt } = o
    const max = Math.max(tgt ?? 0, ...vals, 1) * 1.08
    const posture = postureOf(c)
    const extras = [`${coverageOf(c)}% tracking coverage`, `${posture} ${plural(posture, 'posture cue')}`, ...(isCup && c.wrong_dot != null ? [`${c.wrong_dot} ${plural(c.wrong_dot, 'wrong dot')}`] : [])].join(' · ')
    return (
      <div className="rp-ex" key={key}>
        <div className="rp-ex-h">
          <b>{o.name}</b>
          {o.link && <Button variant="link" onClick={() => nav(o.link!)}>Its report</Button>}
        </div>
        {o.dose && <p className="rp-ex-sub">{o.dose}</p>}
        <p className="rp-ex-sub"><span>{`${o.counts[0]} verified · ${o.counts[1]} unverified`}</span>{` · ${extras}`}</p>
        <p className="rp-ex-sub">{isCup ? 'Reach time per dot, ms' : `${swings ? 'Swing size' : 'Peak angle'} per rep${tgt ? ` · target ${tgt}°` : ''}`}</p>
        {vals.length ? (
          <div className="rp-bars" role="img" aria-label={`${o.name} · ${isCup ? 'reach time per dot' : swings ? 'swing size per rep' : 'peak angle per rep'}: ${vals.map((val, i) => `${i + 1}: ${val}${isCup ? ' ms' : '°'}${ver && ver[i] === false ? ' unverified' : ''}`).join(', ')}`}>
            {tgt ? <div className="rp-ceil" style={{ bottom: `${(tgt / max) * 100}%` }} /> : null}
            {vals.map((val, i) => (
              <i key={i} className={ver && ver[i] === false ? 'rp-bar-u' : ''} style={{ height: `${Math.max(4, (val / max) * 100)}%` }} />
            ))}
          </div>
        ) : (
          <p className="rp-ex-sub">No per-rep data recorded.</p>
        )}
      </div>
    )
  }
  // A report opened from history: one column per exercise this session measured. A combined
  // (sample) session shares one camera block, so each column counts its own per-rep flags.
  const histCols = () => {
    const both = !!cam.reach_ms?.length && !!cam.peak_deg?.length
    const own = (ver: boolean[] | null | undefined, n: number): [number, number] => {
      if (!both || !ver) return [cam.verified ?? 0, cam.unverified ?? 0]
      const v = ver.slice(0, n).filter(Boolean).length
      return [v, ver.slice(0, n).length - v]
    }
    return [
      cam.reach_ms?.length ? barsCol('cup', { name: exerciseById('cup')?.name ?? 'Waiter – cup', c: cam, counts: own(cam.reach_verified, cam.reach_ms.length), isCup: true, vals: cam.reach_ms, ver: cam.reach_verified }) : null,
      cam.peak_deg?.length ? barsCol('arm', { name: armName, c: cam, counts: own(cam.peak_verified, cam.peak_deg.length), isCup: false, vals: cam.peak_deg.map((v) => Math.round(v)), ver: cam.peak_verified, tgt: peakTarget }) : null,
    ].filter(Boolean)
  }
  // One legend under the columns whenever per-rep bars are drawn (design review 21 Oct).
  const hasBars = inDay ? DAY_ORDER.some((x) => !pendingIds.includes(x) && !!srcFor(x)?.vals.length) : !!(cam.reach_ms?.length || cam.peak_deg?.length)
  const pendCol = (x: ExerciseId) => {
    const e = exerciseById(x)
    return (
      <div className="rp-ex rp-ex-pend" key={x}>
        <div className="rp-ex-h"><b>{e?.name ?? x}</b><Chip tone="neutral">Not done yet</Chip></div>
        <p className="rp-ex-sub">{doseOf(e)}</p>
        <div className="rp-empty">
          <div className="rp-ghost" aria-hidden>
            {[5, 7, 6, 8, 6, 7, 5, 8, 7, 6, 7, 8].map((h, i) => <i key={i} style={{ height: `${h * 10}%` }} />)}
          </div>
          <div className="rp-empty-c">
            <p>{dayRun?.stopped ? 'Not practised today: practice stopped.' : 'Results show here once you practise it today.'}</p>
          </div>
        </div>
      </div>
    )
  }

  let dayCard: ReactNode = null
  if (dayRun && !canStart) {
    const plan = DAY_ORDER.filter((x) => dayRun.done.includes(x) || dayPlan(dayRun).includes(x))
    const dn = plan.filter((x) => dayRun.done.includes(x)).length
    dayCard = (
      <Card as="div" className="rp-day">
        {dayRun.stopped ? (
          <p className="rp-day-msg">{dayRun.stopped === 'session' ? "A stop rule ended this session, so today's practice stops here. Rest the arm." : "Today's practice stops here. Rest the arm."}</p>
        ) : (
          <>
            <div className="rp-day-l">
              <b>{`Today · ${dn} of ${plan.length} done`}</b>
              {dn === plan.length && <p>That's everything for today.</p>}
            </div>
            <ul className="rp-day-tags" aria-label="Today's exercises">
              {plan.map((x) => {
                const d = dayRun.done.includes(x)
                return (
                  <li key={x}>
                    <Chip tone={d ? 'mint' : 'neutral'} icon={d ? <Check /> : undefined}>{`${exerciseById(x)?.name ?? x}${d ? ' · done' : ''}`}</Chip>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Card>
    )
  }

  const nx = next ? exerciseById(next) : undefined
  const need = (nx?.needs ?? []).map((n) => EQUIPMENT.find((e) => e.id === n)?.label).filter(Boolean).join(' · ')
  const exertion = s.summary.exertion
  // an edit of the feedback keeps the note that landed meanwhile on the fetched copy
  const lateNote = fetchedCoach?.note?.text ? fetchedCoach.note : null
  const agentNote = s.summary.coach.note?.text ? s.summary.coach.note : lateNote
  // The Pain / feel unwell answer (stored by the service) fills "after" when the patient skipped
  // the feedback screen, and is always listed so a stop-level report is never lost.
  const inSessionPain = typeof s.summary.reported_pain?.pain === 'number' ? s.summary.reported_pain.pain : null
  const painFromSession = told.pain_after == null && inSessionPain != null
  const painAfter = told.pain_after ?? inSessionPain

  return (
    <div className="rp p-6">
      <div className="rp-head">
        <div className="min-w-0">
          <h1 className="text-4xl">Your practice report</h1>
          <p className="rp-meta">
            <span>{[prettyDate(s.date), dayTitle, ctx].filter(Boolean).join(' · ')}</span>
            {statusChip}
            {nhptLimited && <Chip tone="amber">Limited tracking</Chip>}
            {isReplaySession(s) && <Chip tone="amber">Replay · not counted</Chip>}
          </p>
        </div>
        <div className="rp-actions">
          <Button variant="secondary" icon={<Download />} onClick={dl}>Download</Button>
          <Button variant="secondary" icon={<Share2 />} onClick={() => setSharing(true)}>Sharing</Button>
          <Button variant="secondary" onClick={() => nav('/details')}>Back to Home</Button>
        </div>
      </div>

      <Card title="What the camera measured" className={inDay || cam.reach_ms?.length || cam.peak_deg?.length || cam.splits_s ? 'rp-cam' : 'rp-cam rp-cam-flat'}>
        <div className="rp-stats">
          {inDay ? (
            <>
              <Stat value={mmss(activeSum)} label="active · all exercises today" />
              {/* each exercise's own counts, never summed across exercises */}
              {DAY_ORDER.filter((x) => !pendingIds.includes(x)).flatMap((x) => {
                const c = srcFor(x)?.c
                if (!c) return []
                const name = exerciseById(x)?.name ?? x
                return [
                  <Stat key={`${x}-v`} value={String(c.verified ?? 0)} label={`verified · ${name}`} />,
                  <Stat key={`${x}-u`} value={String(c.unverified ?? 0)} label={`unverified · ${name}`} tone={c.unverified ? 'amber' : 'default'} />,
                ]
              })}
            </>
          ) : (
            <>
              <Stat value={mmss(cam.active_s)} label="active · rest excluded" />
              <Stat value={String(cam.verified ?? 0)} label={`verified ${plural(cam.verified ?? 0, 'movement')}`} />
              <Stat value={String(cam.unverified ?? 0)} label={isCupSession ? 'unverified (hand or marker hidden)' : 'unverified'} tone={cam.unverified ? 'amber' : 'default'} />
              <Stat value={String(coverageOf(cam))} unit="%" label="tracking coverage" />
              <Stat value={String(postureOf(cam))} label={plural(postureOf(cam), 'posture cue')} />
              {aboveCeiling !== undefined && <Stat value={String(aboveCeiling)} label={`${plural(aboveCeiling, 'lift')} above ${ceilingOf(cam)}°`} tone={aboveCeiling ? 'amber' : 'default'} />}
              {isCupSession && cam.wrong_dot != null && <Stat value={String(cam.wrong_dot)} label={plural(cam.wrong_dot, 'wrong dot')} />}
            </>
          )}
        </div>
        {cam.nhpt_total_s != null && (
          <p className="mt-4 text-xl">
            Nine-Hole Peg Test: <b>{cam.nhpt_total_s.toFixed(1)} s</b> · putting the pegs in only · a timing aid, not a clinical instrument
            {nhptLimited && ' · the camera lost the board during the test, so this time is limited'}
          </p>
        )}
        {inDay ? (
          <div className="rp-exs">{DAY_ORDER.map((x) => (pendingIds.includes(x) ? pendCol(x) : perfCol(x)))}</div>
        ) : (
          <>
            {(cam.reach_ms?.length || cam.peak_deg?.length) ? <div className="rp-exs">{histCols()}</div> : null}
            {cam.splits_s && <div className="mt-5"><Bars title="Nine-Hole Peg Test · per-peg split" unit="s" values={cam.splits_s.map((v) => Math.round(v * 10) / 10)} labels={cam.splits_s.map((_, i) => `Peg ${i + 1}`)} height={140} /></div>}
          </>
        )}
        {hasBars && (
          <ul className="rp-legend" aria-label="Chart legend">
            <li><i aria-hidden />Verified</li>
            <li><i aria-hidden className="rp-bar-u" />Unverified</li>
          </ul>
        )}
        {/* Kept small (ruling R7): exertion chip, the no-score statement and the latency line. */}
        <div className="rp-cam-foot">
          <p className="rp-meta mt-3">
            Exertion
            <Chip tone={exertion.level === 'high' ? 'red' : exertion.level === 'moderate' ? 'amber' : 'mint'}>{cap(exertion.level)}</Chip>
            · behavioural index
          </p>
          <p className="rp-ex-sub">Nothing here is combined into a score.</p>
        </div>
        {latency && latency.frames > 0 && <p className="rp-ex-sub tabular-nums">{latencyText(latency)}</p>}
      </Card>
      {dayCard}

      <div className="rp-grid">
        <div className="rp-col">
          {/* "Agent" only when the Claude agent's note is on screen; otherwise the service's
              rule-coach label (CLAUDE.md §3 rule 3: no claim outruns the build). */}
          <Card title={agentNote ? 'Agent' : s.summary.coach.label} className="rp-notes-card">
            <ul className="rp-notes">
              {agentNote && (
                <li>
                  <span className="rp-note-b">{capSentences(agentNote.text)}</span>
                </li>
              )}
              {s.summary.coach.notes.length === 0 && !agentNote && <li className="text-muted">No coach notes: nothing needed correcting or changing.</li>}
              {s.summary.coach.notes.map((n, i) => (
                <li key={i}>
                  <span className="rp-note-b">
                    {(agentNote || n.cat) && <small>{[agentNote ? ruleName(s.summary.coach) : null, n.cat].filter(Boolean).join(' · ')}</small>}
                    {capSentences(noteText(n.text))}
                  </span>
                  <Chip tone={conf[n.confidence] ?? 'neutral'}>{`${cap(n.confidence)} confidence`}</Chip>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="rp-col">
          <Card title="What you told us" action={<Button variant="secondary" onClick={() => setEditFb(true)}>Edit feedback</Button>}>
            <div className="rp-told">
              <Stat value={`${String(ck.pain_before ?? '—')} → ${String(painAfter ?? '—')}`} label={painFromSession ? 'pain before → during the session' : 'pain before → after'} />
              <Stat value={told.effort != null ? String(told.effort) : '—'} unit="/10" label={told.effort != null ? 'effort' : 'effort · not recorded'} />
            </div>
            <p className="rp-told-line">{toldLine}</p>
            {inSessionPain != null && <p className="rp-told-line">{`You reported pain ${inSessionPain}/10 during the session.`}</p>}
            {typeof told.detail === 'string' && told.detail && <p className="rp-told-line text-muted">Your note: “{told.detail}”</p>}
            {saveError && <p role="alert" className="rp-told-line text-muted">We couldn't save your changes. What you told us before is kept.</p>}
          </Card>

          <Card title="Next practice" className="rp-next">
            {canStart && nx && (
              <div className="rp-nx">
                <div className="rp-nx-h">
                  <div>
                    <small>Still to do today</small>
                    <b>{nx.name}</b>
                  </div>
                  <span className="rp-nx-tag">{libTags(nx)[1]}</span>
                </div>
                <dl className="rp-nx-rows">
                  <div><dt>Your target</dt><dd>{doseFor(nx, runTier)}</dd></div>
                  {need && <div><dt>You'll need</dt><dd>{need}</dd></div>}
                  {nx.watchFor && <div><dt>Watch for</dt><dd>{nx.watchFor}</dd></div>}
                  <div><dt>Time</dt><dd>{`About ${Math.round(DAY_MINUTES / DAY_ORDER.length)} min · demonstration, then camera setup`}</dd></div>
                </dl>
                <Button full onClick={() => nav(demoUrl(nx.id, daySide))}>Start session</Button>
              </div>
            )}
            {!canStart && <p className="rp-p">{s.next_practice.text}</p>}
            <p className="rp-authority">{`Nothing in your plan changes until ${shortName(clinician)} approves it.`}</p>
          </Card>

        </div>
      </div>

      <FeedbackOverlay
        open={editFb}
        early={s.status !== 'complete'}
        onSave={(f) => {
          setEditFb(false)
          api
            .updateFeedback(s.id, f)
            .then((r) => {
              const ok = !!(r as Partial<SessionRecord> | null)?.summary
              if (ok) setEdited(r)
              setSaveError(!ok)
            })
            .catch(() => setSaveError(true))
        }}
        onSkip={() => setEditFb(false)}
      />

      <Overlay open={sharing} title="Who sees this report" description="How this report is shared." onClose={() => setSharing(false)} className="w-[min(640px,92vw)]">
        <ul className="mt-4 space-y-3 text-lg">
          <li>It goes to <b>{clinician}'s review queue</b> and nowhere else.</li>
          <li>It contains measurements, events, coach notes and what you told us — <b>never video</b>. Video is {processingPlace()}.</li>
          <li>
            Status right now: <Chip tone="amber">{cap(s.delivery)}</Chip>
          </li>
          <li>Download gives you the same record as a JSON file to keep or hand over yourself.</li>
        </ul>
        <OverlayActions className="justify-end">
          <Button onClick={() => setSharing(false)}>Close</Button>
        </OverlayActions>
      </Overlay>
    </div>
  )
}

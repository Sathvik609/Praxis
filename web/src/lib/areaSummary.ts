/** Home's affected-areas card, derived from real data (design v2, 6 Oct). The designers'
 *  artifact hard-coded every number (`REGION_DATA`); here each one comes from the store:
 *  - shoulder: verified peak angles of stored Arm out to the side sessions (replays never
 *    count), the ceiling from the prescription's allowed adaptations, posture cues this week;
 *  - hand: the peg-test trend from `/api/progress` (sample points stay labelled and never enter
 *    a delta), the last Waiter – cup session's verified reaches, the weekly test day;
 *  - elbow: nothing in the program measures it, so it says so.
 *  Status (Focus / Watch / Not measured) is set by the program (seed `REGIONS`); headlines are
 *  derived. Design review 21 Oct: no everyday goal, trend line or program list on the card. */
import { sessionSource, type Calendar, type Patient, type Prescription, type Progress, type SessionRecord } from './api'
import { WEEKDAYS, mondayOf, addDays } from './calendar'
import { REGIONS, exerciseOfSession } from './seed'
import { fmtV, trendDelta, type TrendPoint } from './trend'

export type AreaKey = 'lShoulder' | 'lElbow' | 'lWrist'
export type AreaStatus = 'focus' | 'watch' | 'stable'
export type AreaTile = { k: string; v: string; u?: string }
export type AreaQuality = { k: string; v: string; u?: string; c: string }
export type AreaView = {
  name: string
  status: AreaStatus
  word: string
  headline: string
  /** The headline number: shoulder best verified lift, hand latest peg-test time. */
  now?: { label: string; value: string; unit?: string; caption: string; detail: string; ring?: { now: number; max: number } }
  /** Shown instead of `now` when there is nothing measured yet. */
  empty?: string
  /** The card's two detail tiles. */
  tiles: AreaTile[]
  /** The two quality tiles on the stage (right rail). */
  quality: AreaQuality[]
  /** True when any value shown comes from sample history: the card shows "Sample". */
  sample: boolean
}
export type AreaEmpty = { empty: string }
export type AreaSources = { sessions?: SessionRecord[] | null; progress?: Progress | null; rx?: Prescription | null; calendar?: Calendar | null; me?: Patient | null }

/** `stable` is the elbow, which nothing in this program measures: its word says so (25 Oct
 *  review: "Stable" claimed a reading nobody took). The hotspot keeps its colour. */
export const STATUS_WORD: Record<AreaStatus, string> = { focus: 'Focus', watch: 'Watch', stable: 'Not measured' }
export const ELBOW_EMPTY = 'The camera does not measure the elbow in this program.'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-09-08" → "8 Sep". */
export const dayMonth = (iso: string): string => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const byDate = (a: SessionRecord, b: SessionRecord) => (a.started_at || a.date).localeCompare(b.started_at || b.date)
/** Stored sessions of one exercise that count as the patient's: replays never do. */
const ownSessions = (sessions: SessionRecord[], id: string) => sessions.filter((s) => exerciseOfSession(s)?.id === id && sessionSource(s) !== 'replay').sort(byDate)
const isSample = (s: SessionRecord) => sessionSource(s) === 'sample'

/** The highest peak the camera verified in a session, or undefined when none was verified. */
function bestVerifiedPeak(s: SessionRecord): number | undefined {
  const peaks = s.summary.camera.peak_deg ?? []
  const ok = s.summary.camera.peak_verified ?? []
  const v = peaks.filter((p, i) => ok[i] === true && Number.isFinite(p))
  return v.length ? Math.round(Math.max(...v)) : undefined
}

/** The patient's limit for the side lift: the top of the prescription's allowed range. */
function shoulderCeiling(rx: Prescription | null | undefined): number {
  const allowed = rx?.allowed_adaptations?.abduction?.target_deg
  const top = Array.isArray(allowed) ? num(allowed[1]) : undefined
  const ex = rx?.exercises?.abduction
  return top ?? num(ex?.ceiling_deg) ?? num(ex?.target_deg) ?? 90
}

/** This week's range: the calendar's (the service's clock), else Monday–Sunday of the latest session. */
function thisWeek(d: AreaSources, sessions: SessionRecord[]): { from: string; to: string } | null {
  if (d.calendar?.week) return { from: d.calendar.week.from, to: d.calendar.week.to }
  const last = sessions[sessions.length - 1]
  if (!last) return null
  const mon = mondayOf(last.date)
  return { from: mon, to: addDays(mon, 6) }
}

function base(k: AreaKey) {
  const r = REGIONS[k]
  return { name: r.title, status: r.status, word: STATUS_WORD[r.status] }
}

function shoulder(d: AreaSources): AreaView {
  const arm = ownSessions(d.sessions ?? [], 'abduction')
  const ceiling = shoulderCeiling(d.rx)
  const measured = arm.map((s) => ({ s, best: bestVerifiedPeak(s) })).filter((x): x is { s: SessionRecord; best: number } => x.best !== undefined)
  const last = measured[measured.length - 1]
  const lastArm = arm[arm.length - 1]
  const week = thisWeek(d, arm)
  const inWeek = week ? arm.filter((s) => s.date >= week.from && s.date <= week.to) : []
  const cues = inWeek.reduce((n, s) => n + (num(s.summary.camera.posture_cues) ?? 0), 0)
  const lifts = inWeek.reduce((n, s) => n + (num(s.summary.camera.reps_total) ?? 0), 0)
  // `hiking_cues` exists on summaries since the service split posture cues (6 Oct); older ones have none
  const hikingKnown = inWeek.filter((s) => num(s.summary.camera.hiking_cues) !== undefined)
  const hiking = hikingKnown.reduce((n, s) => n + (num(s.summary.camera.hiking_cues) ?? 0), 0)
  const ver = lastArm ? num(lastArm.summary.camera.verified) : undefined
  const unv = lastArm ? (num(lastArm.summary.camera.unverified) ?? 0) : 0
  const reps = lastArm ? num(lastArm.summary.camera.reps_total) : undefined
  return {
    ...base('lShoulder'),
    // An arm session whose lifts carry no verified angle is still a session: the card never says
    // "No arm session yet" beside that session's own lift counts (10 Oct walkthrough).
    headline: !last ? (lastArm ? 'No lift angle yet' : 'No arm session yet') : last.best >= ceiling - 3 ? "At today's safe limit" : 'Building range',
    now: last && {
      label: 'Best lift',
      value: String(last.best),
      unit: '°',
      caption: `of ${ceiling}° · last session`,
      detail: `Best verified lift in your last arm session, ${dayMonth(last.s.date)} · limit ${ceiling}°`,
      ring: { now: last.best, max: ceiling },
    },
    empty: last ? undefined : lastArm ? 'No verified lift angle in your last arm session.' : 'Your best lift angle shows here after your first Arm out to the side session.',
    tiles: [
      { k: 'Lifts with a posture cue', v: inWeek.length ? String(cues) : '—', u: inWeek.length ? `of ${lifts} · this week` : 'No arm session this week' },
      { k: 'Sessions logged', v: String(arm.length), u: arm.length ? `since ${dayMonth(arm[0].date)}` : undefined },
    ],
    quality: [
      { k: 'Verified lifts', v: ver === undefined ? '—' : String(ver), u: ver !== undefined && reps !== undefined ? `of ${reps}` : undefined, c: lastArm ? `${unv} unverified · last session` : 'Confirmed by the camera.' },
      { k: 'Shoulder hiking', v: !hikingKnown.length ? '—' : hiking ? String(hiking) : 'None', u: undefined, c: !hikingKnown.length ? 'Checked as you lift.' : hiking ? 'events this week' : 'this week' },
    ],
    // every shoulder value (tiles, counts) comes from these sessions
    sample: arm.some(isSample),
  }
}

function hand(d: AreaSources): AreaView {
  const points: TrendPoint[] = (d.progress?.nhpt_trend ?? []).filter((p) => num(p.total_s) !== undefined).map((p) => ({ date: p.date, value: p.total_s, sample: p.kind === 'sample' }))
  const live = points.filter((p) => !p.sample)
  const latest = live[live.length - 1] ?? points[points.length - 1]
  const delta = trendDelta(points, 'down')
  const best = live.length ? Math.min(...live.map((p) => p.value)) : undefined
  const cups = ownSessions(d.sessions ?? [], 'cup')
  const lastCup = cups[cups.length - 1]
  const nhptDay = d.calendar?.schedule?.nhpt_day ?? d.rx?.schedule?.nhpt_day
  return {
    ...base('lWrist'),
    headline: !points.length ? 'No peg test yet' : delta?.tone === 'good' ? 'Getting quicker' : 'Holding steady',
    now: latest && {
      label: 'Peg test',
      value: fmtV(latest.value),
      unit: 's',
      caption: `${dayMonth(latest.date)}${delta && delta.tone !== 'flat' ? ` · ${delta.text}` : ''}${latest.sample ? ' · sample' : ''}`,
      detail: delta && live.length > 1 ? `${delta.tone === 'flat' ? 'Same as' : `${delta.text} than`} your first test on ${dayMonth(live[0].date)}` : `Nine-Hole Peg Test · ${dayMonth(latest.date)}`,
    },
    empty: latest ? undefined : 'Your peg test time shows here after your first Nine-Hole Peg Test.',
    tiles: [
      { k: 'Verified reaches', v: lastCup ? String(num(lastCup.summary.camera.verified) ?? 0) : '—', u: lastCup ? `${num(lastCup.summary.camera.unverified) ?? 0} unverified · last session` : 'No cup session yet' },
      { k: 'Next test', v: nhptDay === undefined ? '—' : WEEKDAYS[nhptDay], u: 'weekly' },
    ],
    quality: [
      { k: 'Tests done', v: live.length ? String(live.length) : '—', c: live.length ? `since ${dayMonth(live[0].date)}` : 'Weekly, timed.' },
      { k: 'Best time', v: best === undefined ? '—' : fmtV(best), u: best === undefined ? undefined : 's', c: best === undefined ? 'Fastest time.' : 'fastest so far' },
    ],
    sample: points.some((p) => p.sample) || (!!lastCup && isSample(lastCup)),
  }
}

export function areaSummary(key: AreaKey, d: AreaSources): AreaView | AreaEmpty {
  if (key === 'lShoulder') return shoulder(d)
  if (key === 'lWrist') return hand(d)
  return { empty: ELBOW_EMPTY }
}

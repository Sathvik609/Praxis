/** Design preview only (`vite build --mode design`): the session service's HTTP API answered
 *  in the page from fixtures captured from the live service (`scripts/capture-design-fixtures.mjs`).
 *
 *  GETs return the captured bodies. Writes return what the service would return and change
 *  in-memory state for the page's lifetime (a reviewed flag stays reviewed, a schedule edit
 *  bumps the prescription version and redraws the calendar); a reload starts over. */
import type { Calendar, CalendarDay, CheckinBody, CheckinResult, Flag, Patient, Prescription, ScheduleBody, SessionRecord, TherapistPatient } from '../lib/api'
import calendarRaw from './fixtures/calendar.json?raw'
import httpRaw from './fixtures/http.json?raw'
import type { Recording } from './recordings'

export type MockResponse = { status: number; body: unknown }

type CalendarFixture = { default: Calendar; days: Record<string, CalendarDay> }

const http = JSON.parse(httpRaw) as Record<string, unknown>
const cal = JSON.parse(calendarRaw) as CalendarFixture

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T

const state = {
  me: clone(http['/api/patients/me'] as Patient),
  rx: clone(http['/api/prescription'] as Prescription),
  flags: clone((http['/api/flags'] as { flags: Flag[] }).flags),
  sessions: clone((http['/api/sessions'] as { sessions: SessionRecord[] }).sessions),
  details: new Map<string, SessionRecord>(),
  calendar: clone(cal.default),
  days: clone(cal.days),
  goalAttempts: (http['/api/patients/me'] as Patient).goal_attempts,
  traces: new Map<string, unknown>(),
}
for (const [k, v] of Object.entries(http)) {
  const m = /^\/api\/sessions\/([^/?]+)$/.exec(k)
  if (m) state.details.set(m[1], clone(v as SessionRecord))
}

// ---- calendar (a port of the service's calendar_view.build_calendar) --------------------------
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_EXERCISES = [
  { id: 'abduction', name: 'Arm out to the side' },
  { id: 'cup', name: 'Waiter – cup' },
]
const WEEKLY = [{ id: 'nhpt', name: 'Nine-Hole Peg Test' }]

const utc = (d: string) => new Date(`${d}T00:00:00Z`)
const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (d: string, n: number) => {
  const x = utc(d)
  x.setUTCDate(x.getUTCDate() + n)
  return isoDay(x)
}
const weekdayOf = (d: string) => (utc(d).getUTCDay() + 6) % 7
const hm = (at: string) => {
  const [h, m] = at.slice(11, 16).split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
const shortName = (full: string) => {
  const parts = full.split(',')[0].trim().split(/\s+/)
  return parts.length > 2 && parts[0].endsWith('.') ? `${parts[0]} ${parts.at(-1)}` : parts.join(' ')
}
const visitText = (at: string) => {
  const d = at.slice(0, 10)
  return `${WEEKDAYS[weekdayOf(d)]} ${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}, ${hm(at)}`
}

function visitFor(): Calendar['next_visit'] {
  const v = state.rx.schedule?.next_visit
  if (!v) return null
  return { at: v.at, with: v.with, with_short: shortName(v.with), time: hm(v.at), date: v.at.slice(0, 10), text: visitText(v.at), upcoming: v.at.slice(0, 10) >= state.calendar.today }
}

function buildDay(date: string): CalendarDay {
  const sched = state.rx.schedule!
  const today = state.calendar.today
  const since = state.calendar.tracking_since
  const seen = state.days[date]
  const sessions = seen?.sessions ?? []
  const live = sessions.filter((s) => s.source === 'live')
  const wd = weekdayOf(date)
  const planned = sched.practice_days.includes(wd)
  const nhptDue = wd === sched.nhpt_day
  const due = planned || nhptDue
  let status: CalendarDay['status']
  if (live.length) status = 'done'
  else if (date === today) status = 'today'
  else if (date > today) status = due ? 'planned' : 'rest'
  else if (!due) status = 'rest'
  else status = since && date >= since ? 'missed' : 'untracked'
  const visit = visitFor()
  return {
    date,
    weekday: wd,
    is_today: date === today,
    status,
    planned,
    nhpt_due: nhptDue,
    minutes: planned ? sched.minutes_per_day : 0,
    minutes_done: seen?.minutes_done ?? 0,
    exercises: [...(planned ? DAY_EXERCISES : []), ...(nhptDue ? WEEKLY : [])],
    sessions,
    sample: seen?.sample ?? false,
    clinic_visit: visit && visit.date === date ? { at: visit.at, with: visit.with, with_short: visit.with_short, time: visit.time } : null,
  }
}

function calendar(from?: string | null, to?: string | null): MockResponse {
  const c = state.calendar
  if ((from == null) !== (to == null)) return { status: 400, body: { detail: 'give both from and to, or neither' } }
  const start = from ?? c.week.from
  const end = to ?? c.week.to
  const days: CalendarDay[] = []
  for (let d = start; d <= end && days.length < 62; d = addDays(d, 1)) days.push(buildDay(d))
  const sched = state.rx.schedule!
  const week = { ...c.week, planned_days: sched.practice_days.length, minutes_planned: sched.practice_days.length * sched.minutes_per_day }
  return { status: 200, body: { ...c, from: start, to: end, days, week, schedule: sched, next_visit: visitFor() } satisfies Calendar }
}

// ---- writes ------------------------------------------------------------------------------------
function checkin(b: CheckinBody): CheckinResult {
  const pain = Number(b.pain ?? 0)
  const stop = state.rx.stop_rules.pain_max
  const tier: CheckinResult['tier'] = pain >= stop ? 'rest' : pain >= 4 ? 'gentle' : 'full'
  const reasons: string[] = []
  if (tier === 'rest') reasons.push(`pain ${pain}/10 is at your stop level (${stop}): rest today`)
  else if (tier === 'gentle') reasons.push(`pain ${pain}/10: gentle dose today`)
  if (b.new_symptoms) reasons.push('new or worse symptoms since last time')
  const flagged = tier === 'rest' || !!b.new_symptoms
  if (flagged) {
    const id = Math.max(0, ...state.flags.map((f) => f.id)) + 1
    state.flags.unshift({ id, session_id: 'checkin', rule: b.new_symptoms ? 'symptoms' : 'pain', detail: reasons.join('; '), t: 0, date: state.calendar.today, reviewed: false })
  }
  return { tier, flagged, reasons }
}

function putSchedule(b: ScheduleBody): MockResponse {
  const days = b.practice_days ?? []
  const errors: { loc: string[]; msg: string }[] = []
  if (!days.length) errors.push({ loc: ['practice_days'], msg: 'at least one practice day' })
  if (new Set(days).size !== days.length) errors.push({ loc: ['practice_days'], msg: 'practice days must be unique' })
  if (days.some((d) => d < 0 || d > 6)) errors.push({ loc: ['practice_days'], msg: 'practice days are weekdays 0 (Mon) to 6 (Sun)' })
  if (b.next_visit && (!b.next_visit.with?.trim() || Number.isNaN(Date.parse(b.next_visit.at)))) errors.push({ loc: ['next_visit'], msg: 'next visit needs a date and a clinician' })
  if (errors.length) return { status: 422, body: { detail: errors } }
  const from = state.rx.version
  const version = from + 1
  const schedule = { minutes_per_day: state.rx.schedule?.minutes_per_day ?? 10, practice_days: [...days].sort((a, c) => a - c), nhpt_day: b.nhpt_day, next_visit: b.next_visit ? { at: b.next_visit.at, with: b.next_visit.with.trim() } : null }
  state.rx = { ...state.rx, version, schedule, edited: { by: 'therapist', at: new Date().toISOString().slice(0, 19), what: 'schedule', from_version: from } }
  state.me = {
    ...state.me,
    program: { ...state.me.program, version, short: state.me.program.short.replace(/\bv\d+\b/, `v${version}`), next_visit: schedule.next_visit ? visitText(schedule.next_visit.at) : null },
  }
  state.calendar = { ...state.calendar, schedule }
  return { status: 200, body: state.rx }
}

const EXERCISE_NAMES: Record<string, string> = { abduction: 'Arm out to the side', cup: 'Waiter – cup', nhpt: 'Nine-Hole Peg Test' }

function selfReport(b: { exercise?: string }): unknown {
  // Mirrors the service: the three visible exercises are counted by the camera, never by a
  // tick; every demo-only exercise is hidden since 28 Sep, so nothing here is ever logged.
  const id = String(b.exercise ?? '')
  if (EXERCISE_NAMES[id]) return { ok: false, error: 'not_demo', exercise: id, text: `${EXERCISE_NAMES[id]} is counted by the camera, not by a tick.` }
  return { ok: false, error: 'not_offered', exercise: id, text: 'That exercise is not part of your program.' }
}

function nextPractice(summary: SessionRecord['summary']): SessionRecord['next_practice'] {
  const cam = summary.camera ?? {}
  if (summary.stopped) return { text: 'Session ended by a stop rule. Continue only after your therapist reviews the flag.', proposal: 'review with clinician', level_change: false }
  if (summary.mode === 'cup') return { text: 'Continue your assigned plan. Fast arcs stay on. No level change — that needs Dr. Rao.', proposal: 'keep 2 slow + 2 fast arcs; keep the hand clear after each placement', level_change: false }
  if (summary.mode === 'arm') return { text: 'Continue your assigned plan. No level change — that needs Dr. Rao.', proposal: cam.posture_cues ? 'keep hold at 3 s, watch leaning' : 'keep hold at 3 s', level_change: false }
  return { text: 'Assessment recorded. Practice continues on the assigned plan.', proposal: 'repeat the peg test weekly, same board and camera setup', level_change: false }
}

/** The session socket's `feedback` ack: store the recorded session the way the service's
 *  `store.save_session` would (as a replay: it is never the patient's own practice). */
export function savePreviewSession(rec: Recording, feedback: Record<string, unknown>, stop: { t: number; rule: string; detail: string } | null, checkin: Record<string, unknown>): SessionRecord['summary'] & { session_id: string } {
  const summary = { ...clone(rec.summary), stopped: !!stop || !!rec.summary.stopped, session_id: rec.session_id } as SessionRecord['summary'] & { session_id: string; t_start?: number; t_end?: number; exercise?: string }
  if (stop) {
    // A pain stop in the preview writes the therapist flag, as the service's stop rule does.
    summary.flags = [...(summary.flags ?? []), stop]
    const id = Math.max(0, ...state.flags.map((f) => f.id)) + 1
    state.flags.unshift({ id, session_id: rec.session_id, rule: stop.rule, detail: stop.detail, t: stop.t, date: state.calendar.today, reviewed: false })
  }
  // Dated on the fixtures' "today" (the service's clock when they were captured), so the report,
  // Home and the calendar agree however long after capture the preview is opened.
  const now = new Date()
  const dur = Math.max(0, Number(summary.t_end ?? 0) - Number(summary.t_start ?? 0))
  const local = (d: Date) => `${state.calendar.today}T${new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(11, 19)}`
  const cam = summary.camera ?? {}
  const total = Math.max(1, cam.reps_total ?? 0)
  const title = rec.mode === 'nhpt' ? `Nine-Hole Peg Test${cam.nhpt_total_s ? ` · ${cam.nhpt_total_s.toFixed(1)} s` : ''}` : (EXERCISE_NAMES[rec.exercise] ?? rec.exercise)
  const record: SessionRecord = {
    id: rec.session_id,
    mode: rec.mode,
    exercise: rec.mode === 'arm' ? rec.exercise : rec.mode,
    date: state.calendar.today,
    started_at: local(now),
    ended_at: local(new Date(now.getTime() + dur * 1000)),
    status: summary.stopped ? 'ended_early' : 'complete',
    tracking: (cam.unverified ?? 0) / total <= 0.3 ? 'usable' : 'limited',
    title,
    checkin,
    feedback,
    summary,
    next_practice: nextPractice(summary),
    delivery: 'queued · not yet delivered',
    illustrative: false,
    source: 'replay',
    replay: true,
    events: [],
  }
  state.details.set(record.id, record)
  state.sessions = [record, ...state.sessions.filter((s) => s.id !== record.id)]
  state.traces.set(record.id, rec.trace)
  return summary
}

export function registerTrace(sessionId: string, trace: unknown) {
  state.traces.set(sessionId, trace)
}

// ---- router ------------------------------------------------------------------------------------
export function handle(method: string, url: URL, body: unknown): MockResponse {
  const p = url.pathname
  const q = url.searchParams
  const ok = (b: unknown): MockResponse => ({ status: 200, body: b })
  if (method === 'GET') {
    if (p === '/health') return ok(http['/health'])
    if (p === '/api/patients/me') return ok({ ...state.me, goal_attempts: state.goalAttempts })
    if (p === '/api/prescription') return ok(state.rx)
    if (p === '/api/sessions') return ok({
        sessions: state.sessions.map((s) => {
          const row: Partial<SessionRecord> = { ...s }
          delete row.events
          return row
        }),
      })
    const sm = /^\/api\/sessions\/([^/]+)$/.exec(p)
    if (sm) return ok(state.details.get(decodeURIComponent(sm[1])) ?? { error: 'unknown session' })
    if (p === '/api/flags') return ok({ flags: state.flags })
    if (p === '/api/progress') return ok({ ...(http['/api/progress'] as object), goal_log_count: state.goalAttempts })
    if (p === '/api/therapist/patients') {
      const open = state.flags.filter((f) => !f.reviewed).length
      const pts = (http['/api/therapist/patients'] as { patients: TherapistPatient[] }).patients
      return ok({ patients: pts.map((x) => (x.id === state.me.id ? { ...x, open_flags: open } : x)) })
    }
    if (p === '/api/replay/list') return ok(http['/api/replay/list'])
    if (p === '/api/calendar') return calendar(q.get('from'), q.get('to'))
    if (p === '/api/trace') {
      const sid = q.get('session')
      if (sid) return ok(state.traces.get(sid) ?? { session: null, rows: [] })
      return ok(http['/api/trace?n=200'])
    }
    if (p === '/events') return ok({ count: 0, events: [] })
  }
  if (method === 'POST') {
    const fm = /^\/api\/flags\/(\d+)\/reviewed$/.exec(p)
    if (fm) {
      const f = state.flags.find((x) => x.id === Number(fm[1]))
      if (f) f.reviewed = true
      return ok({ ok: !!f })
    }
    if (p === '/api/goal-log') {
      state.goalAttempts += 1
      return ok({ ok: true, goal_attempts: state.goalAttempts })
    }
    if (p === '/api/self_report') return ok(selfReport((body ?? {}) as { exercise?: string }))
    if (p === '/api/checkin') return ok(checkin((body ?? {}) as CheckinBody))
  }
  if (method === 'PUT' && p === '/api/prescription/schedule') return putSchedule((body ?? {}) as ScheduleBody)
  console.warn(`[design preview] no fixture for ${method} ${p}${url.search}; answering 404`)
  return { status: 404, body: { detail: 'Not Found (design preview: no fixture)' } }
}

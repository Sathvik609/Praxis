import type { AgentHealth } from '../session/agent'
import { SESSION_API_URL } from './config'

export type Patient = { id: string; name: string; initial: string; side: string; goal: string; goal_attempts: number; program_code: string; program: { label: string; short: string; clinician: string; next_visit: string | null; level: number; version: number } }
/** Practice days live in the prescription (screen 12, 28 Sep): weekdays 0 = Mon … 6 = Sun. */
/** `sample`: the seed's visit, served relative to today until the therapist books one. */
export type NextVisit = { at: string; with: string; sample?: boolean }
export type Schedule = { practice_days: number[]; nhpt_day: number; next_visit: NextVisit | null; minutes_per_day: number }
export type Prescription = { program: string; version: number; level: number; side: string; clinician: string; exercises: Record<string, Record<string, unknown>>; allowed_adaptations: Record<string, Record<string, unknown>>; stop_rules: { pain_max: number; lean_deg: number; lean_events: number; failed_reps: number; exertion_high_s: number; new_symptoms: boolean }; schedule?: Schedule; edited?: { by: string; at: string; what: string; from_version: number } | null }
/** `GET /api/calendar` (service `calendar_view.py`). `done` only from live sessions; replays are
 *  left out; sample days carry `sample: true` and stay `untracked`; future days are never `missed`. */
export type CalendarStatus = 'done' | 'today' | 'planned' | 'missed' | 'rest' | 'untracked'
export type CalendarSession = { id: string; title: string | null; exercise: string | null; name: string | null; mode: string; minutes: number; source: 'live' | 'sample'; verified?: number | null; nhpt_total_s?: number | null }
export type ClinicVisit = { at: string; with: string; with_short: string; time: string }
export type CalendarDay = { date: string; weekday: number; is_today: boolean; status: CalendarStatus; planned: boolean; nhpt_due: boolean; minutes: number; minutes_done: number; exercises: { id: string; name: string }[]; sessions: CalendarSession[]; sample: boolean; clinic_visit: ClinicVisit | null }
export type CalendarWeek = { from: string; to: string; done_days: number; planned_days: number; minutes_done: number; minutes_planned: number; nhpt_done: boolean }
export type Calendar = { from: string; to: string; today: string; days: CalendarDay[]; week: CalendarWeek; schedule: Schedule; next_visit: (ClinicVisit & { date: string; text: string; upcoming: boolean; sample?: boolean }) | null; tracking_since: string | null }
export type ScheduleBody = { practice_days: number[]; nhpt_day: number; next_visit: NextVisit | null }
/** `cat` (6 Oct, Task 17) is the report's note eyebrow; older stored notes have none. */
export type CoachNote = { text: string; confidence: 'high' | 'medium' | 'low'; evidence: number[]; cat?: 'Performance' | 'Posture' | 'Safety' | 'Data quality' }
/** The agent coach's one session note (`write_session_summary`, ≤ 400 chars), with the event ids
 *  it cites and the agent's own label (e.g. "Claude agent · Anthropic API (dev)"). */
export type AgentNote = { text: string; evidence?: number[]; label?: string }
/** `agent` / `agent_decisions` are present only when the service ran an agent coach. */
/** The last "Pain / feel unwell" answer of the session (service `CoachSession.on_pain`, 10 Oct);
 *  `t` is on the session's own clock (wall or clip). */
export type ReportedPain = { pain: number; t: number }
export type SessionCoach ={ label: string; notes: CoachNote[]; decisions: number; agent?: string; agent_decisions?: number; note?: AgentNote }
export type SessionSummary = { mode: string; camera: Record<string, unknown> & { reps_total?: number; verified?: number; unverified?: number; corrections?: number; coverage_pct?: number; posture_cues?: number; active_s?: number; nhpt_total_s?: number; splits_s?: number[]; reach_ms?: number[]; reach_verified?: boolean[]; peak_deg?: number[]; peak_verified?: boolean[]; side?: string; wrong_dot?: number; lean_cues?: number; hiking_cues?: number; above_ceiling?: number; above_ceiling_by_set?: Record<string, number>; ceiling_deg?: number }; told_us: Record<string, unknown>; exertion: { level: string; reasons: string[]; method: string }; coach: SessionCoach; reported_pain?: ReportedPain | null; flags: { t: number; rule: string; detail: string }[]; stopped: boolean; delivery: string; source?: string; replay_clip?: string | null }
export type SessionRecord = { id: string; mode: string; date: string; started_at: string; ended_at: string; status: string; tracking: string; title: string; checkin: Record<string, unknown>; feedback: Record<string, unknown>; summary: SessionSummary; next_practice: { text: string; proposal: string; level_change: boolean }; delivery: string; events?: unknown[]; live?: boolean; exercise?: string | null; illustrative?: boolean; source?: SessionSource; replay?: boolean }
/** Screen 08's post-session answers, sent with `{cmd:'feedback'}` and stored as the session's
 *  `feedback` (design v2, 6 Oct). `effort` is derived from the `difficulty` choice (2 / 4 / 7 / 9),
 *  never a number the patient typed. A missing key means not answered, never zero. */
export type Feedback = {
  ended_early: boolean
  pain_after?: number
  difficulty?: 'too_easy' | 'just_right' | 'hard' | 'couldnt_finish'
  effort?: number
  again_tomorrow?: 'yes_easily' | 'yes_probably' | 'not_sure' | 'no'
  barriers?: string[]
  end_reason?: string
  detail?: string
}
/** Where a stored session came from (service `store.session_source`): the illustrative seed,
 *  a replayed recorded clip (judge fallback), or the patient at the camera. */
export type SessionSource = 'sample' | 'replay' | 'live'
/** The one rule every screen uses: a replay is listed with a Replay badge but never charted,
 *  totalled or put in a pain list (the service already leaves it out of `/api/progress`). */
export function sessionSource(s: { source?: SessionSource; replay?: boolean; illustrative?: boolean; summary?: { source?: string } }): SessionSource {
  if (s.source) return s.source
  if (s.illustrative) return 'sample'
  return s.replay || s.summary?.source === 'replay' ? 'replay' : 'live'
}
export const isReplaySession = (s: Parameters<typeof sessionSource>[0]): boolean => sessionSource(s) === 'replay'
export type Flag = { id: number; session_id: string; rule: string; detail: string; t: number; date: string; reviewed: boolean }
/** One weekly peg-test time; `kind` says whether it is the illustrative sample or the patient's own. */
export type TrendPoint = { date: string; total_s: number; kind?: 'sample' | 'live' }
/** `practice` counts live sessions only: `done` sessions, and `days_done` of `planned` practice
 *  days from the prescription's schedule since the first live session (`planned` and
 *  `adherence_pct` are null before one); `sample` is the wireframe's illustrative history and
 *  is never added to the real numbers. Replays are in none of these lists. */
export type Progress = { nhpt_trend: TrendPoint[]; verified_per_session: { date: string; verified: number; limited: boolean; mode: string; exercise?: string | null; illustrative?: boolean; source?: SessionSource }[]; practice: { done: number; planned: number | null; days_done?: number; hours: number }; adherence_pct: number | null; sample: { done: number; planned: number; hours: number; illustrative: true }; pain_effort: { date: string; pain_after: number | null; effort: number | null; ended_early: boolean; illustrative?: boolean; source?: SessionSource }[]; goal_log_count: number }
export type TherapistPatient = { id: string; name: string; program: string; open_flags: number; adherence_pct: number | null; nhpt_last_s: number | null; nhpt_first_s: number | null; nhpt_sample?: boolean; illustrative?: boolean }

/** `POST /api/checkin` (service track): the service computes the tier and writes the therapist
 *  flag (rest day, new or worse symptoms). `flagged` is the only thing that lets the UI say the
 *  therapist has been told. */
export type CheckinBody = { patient_id?: string; pain: number; new_symptoms: boolean; rpe?: number; notes?: string }
export type CheckinResult = { tier: 'full' | 'gentle' | 'rest'; flagged: boolean; reasons: string[]; plan?: unknown }
/** `GET /api/plan?pain=` (service `plan.day_plan`): today in the default order at the pain
 *  tier's dose. `items` are the day (with `order`), `weekly` the peg test; both empty on rest. */
export type PlanItem = { id: string; name: string; dose: string; sets: number; reps: number; hold_s: number; target_deg: number; ceiling_deg: number; tier: 'full' | 'gentle'; order?: number; steps: string[] }
export type PlanView = { pain: number; tier: 'full' | 'gentle' | 'rest'; reason: string; minutes: number; items: PlanItem[]; weekly: PlanItem[]; rest_advice: string | null; therapist_flag: boolean }
export type SelfReport = { ok: boolean; exercise: string; verified?: false; source?: 'self_ticked'; label?: string; sets_today?: number; error?: string }

/** `GET /health`. `agent` is absent on a service from before the agent coach (29 Sep). */
export type OpenCVBuild = { version: string; cool: boolean; arch?: string; dnn?: boolean; path?: string }
export type Health = { status: string; service?: string; opencv_version?: string; opencv_build?: OpenCVBuild; mode?: string; models?: Record<string, boolean>; agent?: AgentHealth }

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${SESSION_API_URL}${path}`)
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
  const body = (await r.json()) as T & { error?: string }
  if (body && typeof body === 'object' && 'error' in body && body.error) throw new Error(`${path}: ${body.error}`) // the service answers 200 {error} for unknown ids
  return body
}
async function send<T>(method: 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${SESSION_API_URL}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
  return r.json() as Promise<T>
}
const post = <T,>(path: string, body?: unknown) => send<T>('POST', path, body)

export const api = {
  health: () => get<Health>('/health'),
  me: () => get<Patient>('/api/patients/me'),
  prescription: () => get<Prescription>('/api/prescription'),
  sessions: () => get<{ sessions: SessionRecord[] }>('/api/sessions').then((r) => r.sessions),
  session: (id: string) => get<SessionRecord>(`/api/sessions/${id}`),
  flags: () => get<{ flags: Flag[] }>('/api/flags').then((r) => r.flags),
  markReviewed: (id: number) => post<{ ok: boolean }>(`/api/flags/${id}/reviewed`),
  logGoal: (note: string) => post<{ ok: boolean; goal_attempts: number }>('/api/goal-log', { note }),
  progress: () => get<Progress>('/api/progress'),
  therapistPatients: () => get<{ patients: TherapistPatient[] }>('/api/therapist/patients').then((r) => r.patients),
  replayList: () => get<{ clips: { id: string; mode: string; sheet: string; path: string; synthetic: boolean }[] }>('/api/replay/list').then((r) => r.clips),
  /** A demo-only exercise the patient ticked: logged as self-reported, never as a verified rep. */
  selfReport: (exercise: string, sets = 1) => post<SelfReport>('/api/self_report', { exercise, sets }),
  plan: (pain: number) => get<PlanView>(`/api/plan?pain=${Math.max(0, Math.min(10, Math.round(pain)))}`),
  checkin: (body: CheckinBody) => post<CheckinResult>('/api/checkin', body),
  /** Screen 12. No range: the Mon–Sun week holding the service's today. */
  calendar: (range?: { from: string; to: string }) => get<Calendar>(`/api/calendar${range ? `?from=${range.from}&to=${range.to}` : ''}`),
  /** Therapist view · Edit practice days: stored as prescription v(N+1). */
  putSchedule: (body: ScheduleBody) => send<Prescription>('PUT', '/api/prescription/schedule', body),
  /** Report · Edit feedback (ruling R4): merges into the stored feedback, may add a `pain_after`
   *  flag, and answers with the whole session record (same shape as `session`). */
  updateFeedback: (id: string, f: Record<string, unknown>) => send<SessionRecord>('PATCH', `/api/sessions/${id}/feedback`, f),
  trace: (session?: string) => get<{ session: string | null; rows: Record<string, unknown>[] }>(`/api/trace?n=200${session ? `&session=${session}` : ''}`),
}

/** Tiny async hook: `{ data, error, reload }`. */
import { useCallback, useEffect, useState } from 'react'
export function useApi<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    fn().then((d) => alive && setData(d)).catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, reload }
}

/** The prescription's pain stop level (`stop_rules.pain_max`, the level the service's stop rule
 *  uses), read only while `open`; null until it loads or when the service is unreachable. */
export function usePainStopLevel(open: boolean): number | null {
  const { data } = useApi(() => (open ? api.prescription() : Promise.resolve(null)), [open])
  const v = data?.stop_rules?.pain_max
  return typeof v === 'number' ? v : null
}

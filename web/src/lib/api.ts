import { SESSION_API_URL } from './config'

export type Patient = { id: string; name: string; initial: string; side: string; goal: string; goal_attempts: number; program_code: string; program: { label: string; short: string; clinician: string; next_visit: string; level: number; version: number } }
export type Prescription = { program: string; version: number; level: number; side: string; clinician: string; exercises: Record<string, Record<string, unknown>>; allowed_adaptations: Record<string, Record<string, unknown>>; stop_rules: { pain_max: number; lean_deg: number; lean_events: number; failed_reps: number; exertion_high_s: number; new_symptoms: boolean } }
export type CoachNote = { text: string; confidence: 'high' | 'medium' | 'low'; evidence: number[] }
export type SessionSummary = { mode: string; camera: Record<string, unknown> & { reps_total?: number; verified?: number; unverified?: number; corrections?: number; coverage_pct?: number; posture_cues?: number; active_s?: number; nhpt_total_s?: number; splits_s?: number[]; reach_ms?: number[]; reach_verified?: boolean[]; peak_deg?: number[]; peak_verified?: boolean[] }; told_us: Record<string, unknown>; exertion: { level: string; reasons: string[]; method: string }; coach: { label: string; notes: CoachNote[]; decisions: number }; flags: { t: number; rule: string; detail: string }[]; stopped: boolean; delivery: string }
export type SessionRecord = { id: string; mode: string; date: string; started_at: string; ended_at: string; status: string; tracking: string; title: string; checkin: Record<string, unknown>; feedback: Record<string, unknown>; summary: SessionSummary; next_practice: { text: string; proposal: string; level_change: boolean }; delivery: string; events?: unknown[]; live?: boolean }
export type Flag = { id: number; session_id: string; rule: string; detail: string; t: number; date: string; reviewed: boolean }
/** `practice` counts real sessions only (`planned` is null until the prescription carries a
 *  schedule, so `adherence_pct` is null too); `sample` is the wireframe's illustrative history
 *  and is never added to the real numbers. */
export type Progress = { nhpt_trend: { date: string; total_s: number }[]; verified_per_session: { date: string; verified: number; limited: boolean; mode: string; illustrative?: boolean }[]; practice: { done: number; planned: number | null; hours: number }; adherence_pct: number | null; sample: { done: number; planned: number; hours: number; illustrative: true }; pain_effort: { date: string; pain_after: number | null; effort: number | null; ended_early: boolean; illustrative?: boolean }[]; goal_log_count: number }
export type TherapistPatient = { id: string; name: string; program: string; open_flags: number; adherence_pct: number | null; nhpt_last_s: number | null; nhpt_first_s: number | null; illustrative?: boolean }

/** `POST /api/checkin` (service track): the service computes the tier and writes the therapist
 *  flag (rest day, new or worse symptoms). `flagged` is the only thing that lets the UI say the
 *  therapist has been told. */
export type CheckinBody = { patient_id?: string; pain: number; new_symptoms: boolean; rpe?: number; notes?: string }
export type CheckinResult = { tier: 'full' | 'gentle' | 'rest'; flagged: boolean; reasons: string[]; plan?: unknown }
export type SelfReport = { ok: boolean; exercise: string; verified?: false; source?: 'self_ticked'; label?: string; sets_today?: number; error?: string }

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${SESSION_API_URL}${path}`)
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
  const body = (await r.json()) as T & { error?: string }
  if (body && typeof body === 'object' && 'error' in body && body.error) throw new Error(`${path}: ${body.error}`) // the service answers 200 {error} for unknown ids
  return body
}
async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${SESSION_API_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
  return r.json() as Promise<T>
}

export const api = {
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
  checkin: (body: CheckinBody) => post<CheckinResult>('/api/checkin', body),
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

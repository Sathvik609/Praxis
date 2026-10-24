/** Minimal fetch mock keyed by URL prefix for screen tests. `init` is kept in the call record
 *  so a test can assert what was posted. */
export function mockApi(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    const key = Object.keys(routes).find((k) => url.includes(k))
    const body = key ? routes[key] : { error: `unmocked ${url}` }
    return { ok: !!key, status: key ? 200 : 404, json: async () => body } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export const ME = { id: 'alex', name: 'Alex M.', initial: 'A', side: 'left', goal: 'Use a cup on my own.', goal_attempts: 2, program_code: 'GR-4471-L2', program: { label: 'Hospital GRASP, Level 2 · Left side', short: 'Hospital GRASP L2 · v3 · Dr. Rao', clinician: 'your therapist', next_visit: 'Thu 18 Sep, 2:30 PM', level: 2, version: 3 } }

export const PRESCRIPTION = { program: 'Hospital GRASP', version: 3, level: 2, side: 'left', clinician: 'your therapist', exercises: { pendulum: { sets: 2, reps: 10 }, arm: { sets: 2, reps: 8, hold_s: 3, target_deg: 90, ceiling_deg: 90 }, abduction: { sets: 2, reps: 8, hold_s: 3, target_deg: 90, ceiling_deg: 90 }, cup: { slow_arcs: 2, fast_arcs: 2 }, nhpt: { frequency: 'weekly' }, external_rotation: { sets: 2, reps: 8, hold_s: 3, mode: 'demo' }, internal_rotation: { sets: 2, reps: 8, hold_s: 3, mode: 'demo' } }, allowed_adaptations: { pendulum: { reps: [8, 10] }, arm: { hold_s: [2, 3], target_deg: [60, 90], reps: [6, 8] }, abduction: { hold_s: [2, 3], target_deg: [60, 90], reps: [6, 8] }, cup: { fast_arcs: true } }, stop_rules: { pain_max: 7, lean_deg: 12, lean_events: 3, failed_reps: 3, exertion_high_s: 60, new_symptoms: true }, schedule: { practice_days: [0, 1, 2, 3, 4], nhpt_day: 6, next_visit: { at: '2026-10-01T14:30', with: 'Dr. Anita Rao, OT' }, minutes_per_day: 10 } }
export const SESSION = { id: 'abc', mode: 'cup', date: '2026-09-12', started_at: '2026-09-12T09:05:00', ended_at: '2026-09-12T09:19:00', status: 'complete', tracking: 'usable', title: 'Waiter – cup + Arm out to the side', checkin: { pain_before: 2 }, feedback: { pain_after: 2, effort: 4, compared: 'same' }, summary: { mode: 'cup', camera: { reps_total: 20, verified: 17, unverified: 3, corrections: 2, coverage_pct: 86, posture_cues: 2, active_s: 702, reach_ms: [1400, 1300, 900], reach_verified: [true, false, true] }, told_us: {}, exertion: { level: 'low', reasons: [], method: 'behavioural' }, coach: { label: 'Rule-based coach · LLM agent pending', notes: [{ text: 'progress: reach time fell across the slow arcs', confidence: 'high', evidence: [22] }, { text: 'correct: trunk lean in 2 of 16 lifts', confidence: 'medium', evidence: [58] }], decisions: 9 }, flags: [], stopped: false, delivery: 'queued · not yet delivered' }, next_practice: { text: 'Continue your assigned plan. Fast arcs stay on. No level change — that needs Dr. Rao.', proposal: 'keep hold at 3 s, watch leaning', level_change: false }, delivery: 'queued · not yet delivered', events: [] }

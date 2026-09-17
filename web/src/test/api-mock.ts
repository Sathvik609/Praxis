/** Minimal fetch mock keyed by URL prefix for screen tests. */
export function mockApi(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const key = Object.keys(routes).find((k) => url.includes(k))
    const body = key ? routes[key] : { error: `unmocked ${url}` }
    return { ok: !!key, status: key ? 200 : 404, json: async () => body } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export const ME = { id: 'alex', name: 'Alex M.', initial: 'A', side: 'left', goal: 'Use a cup on my own.', goal_attempts: 2, program_code: 'GR-4471-L2', program: { label: 'Hospital GRASP, Level 2 · Left side', short: 'Hospital GRASP L2 · v3 · Dr. Rao', clinician: 'Dr. Anita Rao, OT', next_visit: 'Thu 18 Sep, 2:30 PM', level: 2, version: 3 } }
/** Sprint E guided-flow fixtures; shapes from §Contracts of
 *  docs/superpowers/plans/2026-09-17-sprint-e-guided-flow.md. The service side is built in
 *  parallel, so every guided screen test runs against these, never a live endpoint. */
export const PROFILE = { side: 'left', goal: 'Play badminton again', pain_last: 3, created_at: '2026-09-17T08:00:00', updated_at: '2026-09-17T08:00:00' }
const ITEM = { id: 'pendulum', name: 'Pendulum', dose: '2 × 30 s', sets: 2, reps: 8, hold_s: 3, target_deg: 90, ceiling_deg: 90, view: 'side', done_today: false, clip: 'pendulum', steps: ['Lean forward with your good hand on the table.', 'Let the arm hang and swing small circles.'] }
export const PLAN = {
  tier: 'full',
  tier_reason: 'Pain 3 today: full program.',
  goal_line: 'Toward badminton: shoulder range, week 1',
  items: [
    ITEM,
    { ...ITEM, id: 'flexion', name: 'Arm to the front', clip: 'flexion', dose: '2 × 8, hold 3 s', view: 'side' },
    { ...ITEM, id: 'abduction', name: 'Arm out to the side', clip: 'abduction', dose: '2 × 8, hold 3 s', view: 'front' },
  ],
  rest_advice: null,
}

export const PRESCRIPTION = { program: 'Hospital GRASP', version: 3, level: 2, side: 'left', clinician: 'Dr. Anita Rao, OT', exercises: { nhpt: { frequency: 'weekly' }, cup: { slow_arcs: 2, fast_arcs: 2 }, arm: { sets: 2, reps: 8, hold_s: 3, target_deg: 90, ceiling_deg: 90 }, blocks: { sets: 3, reps: 5 } }, allowed_adaptations: { cup: { fast_arcs: true }, arm: { hold_s: [2, 3] } }, stop_rules: { pain_max: 5, lean_deg: 12, lean_events: 3, failed_reps: 3, exertion_high_s: 60, new_symptoms: true } }
export const SESSION = { id: 'abc', mode: 'cup', date: '2026-09-12', started_at: '2026-09-12T09:05:00', ended_at: '2026-09-12T09:19:00', status: 'complete', tracking: 'usable', title: 'Waiter – cup + Arm to the front', checkin: { pain_before: 2 }, feedback: { pain_after: 2, effort: 4, compared: 'same' }, summary: { mode: 'cup', camera: { reps_total: 20, verified: 17, unverified: 3, corrections: 2, coverage_pct: 86, posture_cues: 2, active_s: 702, reach_ms: [1400, 1300, 900], reach_verified: [true, false, true] }, told_us: {}, exertion: { level: 'low', reasons: [], method: 'behavioural' }, coach: { label: 'Rule-based coach · LLM agent pending', notes: [{ text: 'progress: reach time fell across the slow arcs', confidence: 'high', evidence: [22] }, { text: 'correct: trunk lean in 2 of 16 lifts', confidence: 'medium', evidence: [58] }], decisions: 9 }, flags: [], stopped: false, delivery: 'queued · not yet delivered' }, next_practice: { text: 'Continue your assigned plan. Fast arcs stay on. No level change — that needs Dr. Rao.', proposal: 'keep hold at 3 s, watch leaning', level_change: false }, delivery: 'queued · not yet delivered', events: [] }

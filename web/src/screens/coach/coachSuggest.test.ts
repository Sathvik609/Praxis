import type { Calendar, PlanView, SessionRecord } from '../../lib/api'
import type { Day } from '../../lib/day'
import { PRESCRIPTION, SESSION } from '../../test/api-mock'
import { nextSuggestion, routeText, shortestPending } from './coachSuggest'

const item = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, dose: `${name} dose`, sets: 2, reps: 8, hold_s: 3, target_deg: 90, ceiling_deg: 90, tier: 'full' as const, steps: [], ...extra })
const PLAN: PlanView = {
  pain: 2, tier: 'full', reason: 'Pain 2 today: the full day at your prescribed dose.', minutes: 10,
  items: [item('abduction', 'Arm out to the side', { order: 1 }), item('cup', 'Waiter – cup', { order: 2, sets: 1, reps: 4 })],
  weekly: [item('nhpt', 'Nine-Hole Peg Test', { sets: 1, reps: 9 })],
  rest_advice: null, therapist_flag: false,
}
const day = (over: Partial<Day> = {}): Day => ({ date: '2026-10-06', checkin: null, done: [], demosSeen: [], current: null, finished: [], stopped: null, ...over })
const calendar = (nhptDue: boolean): Calendar => ({
  from: '2026-10-05', to: '2026-10-11', today: '2026-10-06',
  days: [{ date: '2026-10-06', weekday: 1, is_today: true, status: 'today', planned: true, nhpt_due: nhptDue, minutes: 10, minutes_done: 0, exercises: [], sessions: [], sample: false, clinic_visit: null }],
  week: { from: '2026-10-05', to: '2026-10-11', done_days: 0, planned_days: 5, minutes_done: 0, minutes_planned: 50, nhpt_done: false },
  schedule: PRESCRIPTION.schedule, next_visit: null, tracking_since: null,
})
const checkin = { pain: 2, location: 'nowhere', energy: 'comfortable', minutes: 20, new_symptoms: false, side: 'left' as const, tier: 'full' as const, flagged: false, reasons: [], synced: true, at: '2026-10-06T09:00:00' }
const cupSession = (id: string, at: string, reach: number[]): SessionRecord => ({ ...SESSION, id, exercise: 'cup', started_at: at, source: 'live', summary: { ...SESSION.summary, camera: { ...SESSION.summary.camera, reach_ms: reach, reach_verified: reach.map(() => true) } } }) as SessionRecord

test('suggests the first not-done exercise of the plan order', () => {
  expect(nextSuggestion({ plan: PLAN, day: day(), calendar: calendar(false), skip: [] })?.id).toBe('abduction')
  expect(nextSuggestion({ plan: PLAN, day: day({ done: ['abduction'] }), calendar: calendar(false), skip: [] })?.id).toBe('cup')
  expect(nextSuggestion({ plan: PLAN, day: day(), calendar: calendar(false), skip: ['abduction'] })?.id).toBe('cup')
})

test('suggests the peg test when it is due today and the day is done, never when it is not due', () => {
  expect(nextSuggestion({ plan: PLAN, day: day({ done: ['abduction', 'cup'] }), calendar: calendar(true), skip: [] })?.id).toBe('nhpt')
  expect(nextSuggestion({ plan: PLAN, day: day({ done: ['abduction', 'cup'] }), calendar: calendar(false), skip: [] })).toBeNull()
  expect(nextSuggestion({ plan: PLAN, day: day({ done: ['abduction', 'cup', 'nhpt'] }), calendar: calendar(true), skip: [] })).toBeNull()
})

test('returns null on a stopped day and on a rest-tier plan', () => {
  expect(nextSuggestion({ plan: PLAN, day: day({ stopped: 'new_symptoms' }), calendar: calendar(true), skip: [] })).toBeNull()
  expect(nextSuggestion({ plan: { ...PLAN, tier: 'rest', items: [], weekly: [] }, day: day(), calendar: calendar(true), skip: [] })).toBeNull()
})

test('why holds only facts present in the context', () => {
  const bare = nextSuggestion({ plan: PLAN, day: day({ done: ['abduction'] }), calendar: calendar(false), skip: [] })!
  expect(bare.id).toBe('cup')
  expect(bare.why).toEqual([])
  const rich = nextSuggestion({ plan: PLAN, day: day({ done: ['abduction'], checkin }), calendar: calendar(false), skip: [], rx: PRESCRIPTION as never, sessions: [] })!
  expect(rich.why).toEqual(['Assigned in v3', 'pain 2/10 today'])
  expect(rich.why.join(' ')).not.toMatch(/reach/)
})

test('cup why compares the last two live sessions; sample sessions are not used', () => {
  const sessions = [cupSession('b', '2026-10-05T09:00:00', [1000, 1000]), cupSession('a', '2026-10-04T09:00:00', [1250, 1250])]
  const s = nextSuggestion({ plan: PLAN, day: day({ done: ['abduction'] }), calendar: calendar(false), skip: [], sessions })!
  expect(s.why).toContain('reach time −20% last session')
  const sample = sessions.map((x) => ({ ...x, source: 'sample' as const }))
  expect(nextSuggestion({ plan: PLAN, day: day({ done: ['abduction'] }), calendar: calendar(false), skip: [], sessions: sample })!.why).toEqual([])
})

test('arm why uses the best verified peak against the ceiling; nhpt why the test day and last time', () => {
  const arm = { ...SESSION, id: 'arm', mode: 'arm', exercise: 'abduction', source: 'live', summary: { ...SESSION.summary, mode: 'arm', camera: { peak_deg: [84, 88, 95], peak_verified: [true, true, false] } } } as SessionRecord
  expect(nextSuggestion({ plan: PLAN, day: day(), calendar: calendar(false), skip: [], rx: PRESCRIPTION as never, sessions: [arm] })!.why).toContain('shoulder at 88° of 90°')
  const peg = { ...SESSION, id: 'peg', mode: 'nhpt', exercise: 'nhpt', source: 'live', summary: { ...SESSION.summary, mode: 'nhpt', camera: { nhpt_total_s: 41.24 } } } as SessionRecord
  const s = nextSuggestion({ plan: PLAN, day: day({ done: ['abduction', 'cup'] }), calendar: calendar(true), skip: [], sessions: [peg] })!
  expect(s.why).toEqual(['weekly test due today', 'last time 41.2 s'])
})

test('shortest pending item is the one with the fewest movements', () => {
  expect(shortestPending({ plan: PLAN, day: day(), calendar: calendar(true), skip: [] })).toBe('cup')
  expect(shortestPending({ plan: PLAN, day: day({ done: ['cup'] }), calendar: calendar(true), skip: [] })).toBe('nhpt')
  expect(shortestPending({ plan: PLAN, day: day({ stopped: 'rest' }), calendar: calendar(true), skip: [] })).toBeNull()
})

test('free text routes by keyword, pain first', () => {
  expect(routeText('My shoulder hurts and I am tired')).toBe('hurt')
  expect(routeText("I'm tired")).toBe('tired')
  expect(routeText('Less time today')).toBe('time')
  expect(routeText('Explain this exercise')).toBe('explain')
  expect(routeText('Suggest another')).toBe('another')
  expect(routeText('Can I skip to level 3?')).toBe('other')
})

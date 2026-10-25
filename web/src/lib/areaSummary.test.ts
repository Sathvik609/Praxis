import { ME, PRESCRIPTION } from '../test/api-mock'
import type { Calendar, Patient, Prescription, Progress, SessionRecord } from './api'
import { areaSummary, type AreaSources, type AreaView } from './areaSummary'

/** A stored session as the service lists it, with only the fields the summary reads. */
function rec(date: string, exercise: string, camera: SessionRecord['summary']['camera'], source: 'live' | 'replay' | 'sample' = 'live'): SessionRecord {
  return {
    id: `${exercise}-${date}-${source}`, mode: exercise === 'abduction' ? 'arm' : exercise, date, started_at: `${date}T09:00:00`, ended_at: `${date}T09:10:00`, status: 'complete', tracking: 'usable', title: exercise,
    checkin: {}, feedback: {}, next_practice: { text: '', proposal: '', level_change: false }, delivery: '', exercise, source,
    replay: source === 'replay', illustrative: source === 'sample',
    summary: { mode: exercise === 'abduction' ? 'arm' : exercise, camera, told_us: {}, exertion: { level: 'low', reasons: [], method: 'behavioural' }, coach: { label: '', notes: [], decisions: 0 }, flags: [], stopped: false, delivery: '', source },
  }
}
const arm = (date: string, peaks: number[], ok: boolean[], extra: Partial<SessionRecord['summary']['camera']> = {}, source: 'live' | 'sample' = 'live') =>
  rec(date, 'abduction', { peak_deg: peaks, peak_verified: ok, reps_total: peaks.length, verified: ok.filter(Boolean).length, unverified: ok.filter((v) => !v).length, posture_cues: 0, ...extra }, source)
const replayArm = (date: string, peaks: number[]) => rec(date, 'abduction', { peak_deg: peaks, peak_verified: peaks.map(() => true) }, 'replay')
const cup = (date: string, verified: number, unverified: number, source: 'live' | 'replay' = 'live') => rec(date, 'cup', { reps_total: verified + unverified, verified, unverified }, source)

const CAL = {
  from: '2026-09-28', to: '2026-10-11', today: '2026-10-05', days: [],
  week: { from: '2026-10-05', to: '2026-10-11', done_days: 1, planned_days: 5, minutes_done: 11, minutes_planned: 50, nhpt_done: false },
  schedule: { practice_days: [0, 1, 2, 3, 4], nhpt_day: 6, next_visit: null, minutes_per_day: 10 }, next_visit: null, tracking_since: null,
} as Calendar
const PROGRESS = { nhpt_trend: [], verified_per_session: [], practice: { done: 0, planned: null, hours: 0 }, adherence_pct: null, sample: { done: 0, planned: 0, hours: 0, illustrative: true }, pain_effort: [], goal_log_count: 0 } as Progress

function fx(over: { sessions?: SessionRecord[]; progress?: Partial<Progress>; rx?: Prescription; calendar?: Calendar; me?: Patient }): AreaSources {
  return { sessions: over.sessions ?? [], progress: { ...PROGRESS, ...over.progress }, rx: over.rx ?? (PRESCRIPTION as unknown as Prescription), calendar: over.calendar ?? CAL, me: over.me ?? (ME as Patient) }
}

it('shoulder now = best verified peak of the latest live abduction session; replays ignored', () => {
  const v = areaSummary('lShoulder', fx({ sessions: [arm('2026-10-01', [70, 80], [true, true]), arm('2026-10-03', [88, 91], [true, false]), replayArm('2026-10-04', [95])] })) as AreaView
  expect(v.now).toMatchObject({ value: '88', unit: '°', ring: { now: 88, max: 90 } })
  expect(v.sample).toBe(false)
})

it('the shoulder ceiling comes from the prescription allowed adaptations', () => {
  const rx = { ...PRESCRIPTION, allowed_adaptations: { ...PRESCRIPTION.allowed_adaptations, abduction: { target_deg: [60, 80] } } } as unknown as Prescription
  const v = areaSummary('lShoulder', fx({ rx, sessions: [arm('2026-10-03', [78], [true])] })) as AreaView
  expect(v.now!.ring).toEqual({ now: 78, max: 80 })
  expect(v.headline).toBe("At today's safe limit")
})

it('shoulder headline: building range below the limit; status word from the program', () => {
  const v = areaSummary('lShoulder', fx({ sessions: [arm('2026-10-03', [70], [true])] })) as AreaView
  expect(v.headline).toBe('Building range')
  expect(v).toMatchObject({ name: 'Left shoulder', status: 'watch', word: 'Watch' })
})

it('shoulder tiles: posture cues this week out of lifts this week, and sessions logged', () => {
  const v = areaSummary('lShoulder', fx({ sessions: [arm('2026-10-01', [70], [true], { posture_cues: 5, reps_total: 16 }), arm('2026-10-05', [80, 82], [true, true], { posture_cues: 1, reps_total: 8 }), arm('2026-10-06', [81], [true], { posture_cues: 1, reps_total: 8 })] })) as AreaView
  expect(v.tiles[0]).toEqual({ k: 'Lifts with a posture cue', v: '2', u: 'of 16 · this week' })
  expect(v.tiles[1]).toEqual({ k: 'Sessions logged', v: '3', u: 'since 1 Oct' })
})

it('stage tiles: verified and unverified lifts of the last session; shoulder hiking this week from hiking_cues', () => {
  const v = areaSummary('lShoulder', fx({ sessions: [arm('2026-10-05', [80, 82], [true, false], { hiking_cues: 0 }), arm('2026-10-06', [81, 83, 84], [true, true, false], { hiking_cues: 2 })] })) as AreaView
  expect(v.quality).toEqual([
    { k: 'Verified lifts', v: '2', u: 'of 3', c: '1 unverified · last session' },
    { k: 'Shoulder hiking', v: '2', u: undefined, c: 'events this week' },
  ])
  const none = areaSummary('lShoulder', fx({ sessions: [arm('2026-10-05', [80], [true], { hiking_cues: 0 })] })) as AreaView
  expect(none.quality[1]).toMatchObject({ v: 'None', c: 'this week' })
  // sessions stored before the service split posture cues carry no hiking count: no number is invented
  const old = areaSummary('lShoulder', fx({ sessions: [arm('2026-10-05', [80], [true])] })) as AreaView
  expect(old.quality[1]).toMatchObject({ v: '—', c: 'Checked as you lift.' })
})

it('shoulder without any arm session: no number is invented', () => {
  const v = areaSummary('lShoulder', fx({})) as AreaView
  expect(v.now).toBeUndefined()
  expect(v.empty).toBe('Your best lift angle shows here after your first Arm out to the side session.')
})

it('an arm session with no verified angle never reads as "no arm session" next to its own lift counts (10 Oct)', () => {
  // the seed's sample session before 10 Oct: counts, but no per-lift angles
  const s = rec('2026-09-08', 'abduction', { reps_total: 6, verified: 5, unverified: 1, posture_cues: 1 }, 'sample')
  const v = areaSummary('lShoulder', fx({ sessions: [s] })) as AreaView
  expect(v.headline).toBe('No lift angle yet')
  expect(v.empty).toBe('No verified lift angle in your last arm session.')
  expect(v.quality[0]).toEqual({ k: 'Verified lifts', v: '5', u: 'of 6', c: '1 unverified · last session' })
  expect(v.sample).toBe(true)
  expect(JSON.stringify(v)).not.toMatch(/No arm session yet/)
})

it('a sample arm session is marked sample', () => {
  const v = areaSummary('lShoulder', fx({ sessions: [arm('2026-09-08', [76], [true], {}, 'sample'), arm('2026-10-03', [88], [true])] })) as AreaView
  expect(v.sample).toBe(true)
})

it('elbow has an honest empty state', () => {
  expect(areaSummary('lElbow', fx({}))).toEqual({ empty: 'The camera does not measure the elbow in this program.' })
})

it('hand uses nhpt_trend; sample points are labelled and excluded from the delta', () => {
  const v = areaSummary('lWrist', fx({ progress: { nhpt_trend: [{ date: '2026-08-01', total_s: 68, kind: 'sample' }, { date: '2026-09-20', total_s: 45, kind: 'live' }, { date: '2026-10-02', total_s: 41.2, kind: 'live' }] } })) as AreaView
  expect(v.now!.detail).toBe('3.8 s faster than your first test on 20 Sep')
  expect(v.sample).toBe(true)
  expect(v.now).toMatchObject({ value: '41.2', unit: 's' })
  expect(v.headline).toBe('Getting quicker')
})

it('hand headline holds steady when the time is not improving', () => {
  const v = areaSummary('lWrist', fx({ progress: { nhpt_trend: [{ date: '2026-09-20', total_s: 41, kind: 'live' }, { date: '2026-10-02', total_s: 42, kind: 'live' }] } })) as AreaView
  expect(v.headline).toBe('Holding steady')
  expect(v.sample).toBe(false)
})

it('hand tiles: verified reaches of the last live cup session and the next weekly test day', () => {
  const v = areaSummary('lWrist', fx({ sessions: [cup('2026-10-01', 15, 1), cup('2026-10-03', 17, 3), cup('2026-10-04', 20, 0, 'replay')] })) as AreaView
  expect(v.tiles).toEqual([{ k: 'Verified reaches', v: '17', u: '3 unverified · last session' }, { k: 'Next test', v: 'Sun', u: 'weekly' }])
})

it('never lists dropped tasks', () => {
  for (const k of ['lShoulder', 'lWrist'] as const) {
    const v = areaSummary(k, fx({})) as AreaView
    expect(JSON.stringify(v)).not.toMatch(/Block towers|Grip power|Box and Block/)
  }
})

it('design review 21 Oct: the area view carries no everyday goal, trend line or program list', () => {
  for (const k of ['lShoulder', 'lWrist'] as const) {
    const v = areaSummary(k, fx({ sessions: [arm('2026-10-03', [88], [true])], progress: { nhpt_trend: [{ date: '2026-10-02', total_s: 41.2, kind: 'live' }] } })) as AreaView
    expect(v).not.toHaveProperty('goal')
    expect(v).not.toHaveProperty('trend')
    expect(v).not.toHaveProperty('program')
    expect(JSON.stringify(v)).not.toMatch(/Use a cup on my own/)
  }
})

it('a flat peg-test trend reads "Same as your first test", never "No change than"', () => {
  const v = areaSummary('lWrist', fx({ progress: { nhpt_trend: [{ date: '2026-09-20', total_s: 45, kind: 'live' }, { date: '2026-10-02', total_s: 45, kind: 'live' }] } })) as AreaView
  expect(v.now!.detail).toBe('Same as your first test on 20 Sep')
})

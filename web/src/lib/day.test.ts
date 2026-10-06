import { mockApi } from '../test/api-mock'
import {
  dayPosition,
  finishReport,
  markDemoSeen,
  nextExercise,
  readDay,
  resetTodayCheckin,
  readSide,
  saveCheckin,
  sessionUrl,
  startExercise,
  stopReason,
  syncCheckin,
  todayKey,
  writeDay,
  writeSide,
  type DayCheckin,
} from './day'
import { readCheckinPain } from './plan'
import { REGIONS, exerciseById } from './seed'

const BASE = { location: 'hand', energy: 'comfortable', minutes: 14 }

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

test('a fresh day has no check-in, nothing done, and Arm out to the side next', () => {
  const d = readDay()
  expect(d.date).toBe(todayKey())
  expect(d.checkin).toBeNull()
  expect(nextExercise(d)).toBe('abduction')
})

test('a day stored before the 28 Sep lock forgets the hidden exercises it named', () => {
  localStorage.setItem('praxis.day', JSON.stringify({ date: todayKey(), checkin: null, done: ['pendulum', 'arm'], demosSeen: ['external_rotation', 'cup'], current: 'arm', finished: [{ exercise: 'pendulum', reportId: 'r0' }], stopped: null }))
  const d = readDay()
  expect(d.done).toEqual([])
  expect(d.demosSeen).toEqual(['cup'])
  expect(d.current).toBeNull()
  expect(d.finished).toEqual([])
  expect(nextExercise(d)).toBe('abduction')
})

test('yesterday is forgotten: a stored day from another date is replaced', () => {
  localStorage.setItem('praxis.day', JSON.stringify({ date: '2000-01-01', checkin: { pain: 2 }, done: ['pendulum'], demosSeen: [], current: null, finished: [], stopped: null }))
  const d = readDay()
  expect(d.checkin).toBeNull()
  expect(d.done).toEqual([])
})

test('junk in storage never throws', () => {
  localStorage.setItem('praxis.day', '{nope')
  expect(readDay().checkin).toBeNull()
  localStorage.setItem('praxis.side', 'up')
  expect(readSide()).toBeNull()
})

test('practising side persists across reloads', () => {
  expect(readSide()).toBeNull()
  writeSide('right')
  expect(readSide()).toBe('right')
})

test('check-in posts to the service and keeps the service tier and flag', async () => {
  const fetchMock = mockApi({ '/api/checkin': { tier: 'gentle', flagged: false, reasons: ['pain 5: gentle day'], plan: {} } })
  const c = await saveCheckin({ pain: 5, new_symptoms: false, ...BASE }, 'left')
  expect(c).toMatchObject({ tier: 'gentle', flagged: false, synced: true, side: 'left' })
  const [url, init] = fetchMock.mock.calls[0]
  expect(String(url)).toContain('/api/checkin')
  expect(init?.method).toBe('POST')
  expect(JSON.parse(String(init?.body))).toMatchObject({ pain: 5, new_symptoms: false })
  expect(readDay().checkin?.synced).toBe(true)
  // the live session still reads the classic key
  expect(JSON.parse(sessionStorage.getItem('praxis.checkin') ?? '{}')).toMatchObject({ pain: 5 })
  expect(readCheckinPain()).toBe(5)
})

test('offline check-in is saved on this device, tiered locally, not flagged, and retried later', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network'))))
  const c = await saveCheckin({ pain: 8, new_symptoms: false, ...BASE }, 'left')
  expect(c).toMatchObject({ tier: 'rest', flagged: false, synced: false })
  expect(readDay().stopped).toBe('rest')

  const fetchMock = mockApi({ '/api/checkin': { tier: 'rest', flagged: true, reasons: ['pain 8 ≥ 7'], plan: {} } })
  await syncCheckin()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(readDay().checkin).toMatchObject({ synced: true, flagged: true })
  await syncCheckin() // already synced: no second post
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('a service that answers with an error is treated as offline, not as told', async () => {
  mockApi({})
  const c = await saveCheckin({ pain: 2, new_symptoms: true, ...BASE }, 'left')
  expect(c.synced).toBe(false)
  expect(c.flagged).toBe(false)
})

test('new or worse symptoms stop the day at check-in; pain 7 and up is a rest day', () => {
  expect(stopReason({ pain: 2, new_symptoms: true, tier: 'full' })).toBe('new_symptoms')
  expect(stopReason({ pain: 7, new_symptoms: false, tier: 'rest' })).toBe('rest')
  expect(stopReason({ pain: 5, new_symptoms: false, tier: 'gentle' })).toBeNull()
})

test('the day chains: finishing a report marks the exercise done and offers the next one', async () => {
  mockApi({ '/api/checkin': { tier: 'full', flagged: false, reasons: [], plan: {} } })
  await saveCheckin({ pain: 1, new_symptoms: false, ...BASE }, 'left')
  startExercise('abduction')
  expect(dayPosition(readDay(), 'abduction')).toEqual({ index: 1, total: 2 })
  // the report mode must match what was started
  expect(finishReport('r1', 'cup', false)).toBeNull()
  const d = finishReport('r1', 'arm', false)
  expect(d?.done).toEqual(['abduction'])
  expect(nextExercise(d!)).toBe('cup')
  // re-rendering the same report does not double count, and an old report is not part of today
  expect(finishReport('r1', 'arm', false)?.done).toEqual(['abduction'])
  expect(finishReport('old', 'cup', false)).toBeNull()
  startExercise('cup')
  expect(dayPosition(readDay(), 'cup')).toEqual({ index: 2, total: 2 })
  const last = finishReport('r2', 'cup', false)
  expect(last?.done).toEqual(['abduction', 'cup'])
  expect(nextExercise(last!)).toBeNull()
})

test('the weekly peg test does not take a day slot', async () => {
  mockApi({ '/api/checkin': { tier: 'full', flagged: false, reasons: [], plan: {} } })
  await saveCheckin({ pain: 1, new_symptoms: false, ...BASE }, 'left')
  startExercise('nhpt')
  expect(dayPosition(readDay(), 'nhpt')).toBeNull()
  const d = finishReport('n1', 'nhpt', false)
  expect(nextExercise(d!)).toBe('abduction')
})

test('a stop rule inside a session ends the day', async () => {
  mockApi({ '/api/checkin': { tier: 'full', flagged: false, reasons: [], plan: {} } })
  await saveCheckin({ pain: 1, new_symptoms: false, ...BASE }, 'left')
  startExercise('abduction')
  const d = finishReport('r1', 'arm', true)
  expect(d?.stopped).toBe('session')
  expect(nextExercise(d!)).toBeNull()
})

test('a shorter day is one exercise', async () => {
  mockApi({ '/api/checkin': { tier: 'full', flagged: false, reasons: [], plan: {} } })
  await saveCheckin({ pain: 1, new_symptoms: false, ...BASE, minutes: 7 }, 'left')
  startExercise('cup')
  expect(dayPosition(readDay(), 'cup')).toEqual({ index: 1, total: 1 })
  expect(nextExercise(finishReport('r1', 'cup', false)!)).toBeNull()
})

test('demos seen today are remembered', () => {
  markDemoSeen('abduction')
  expect(readDay().demosSeen).toContain('abduction')
})

test("Home's Run the peg test goes through today's check-in and then the peg test's setup", () => {
  expect(REGIONS.lWrist.primary.to).toBe('/details/checkin?next=nhpt')
})

test('session urls carry the side; the peg test carries the hand', () => {
  expect(sessionUrl(exerciseById('abduction')!, 'right')).toBe('/session?exercise=abduction&side=right')
  expect(sessionUrl(exerciseById('nhpt')!, 'left')).toBe('/session?exercise=nhpt&hand=left')
})

const CHECKIN = (pain: number, tier: DayCheckin['tier']): DayCheckin => ({ pain, ...BASE, new_symptoms: false, side: 'left', tier, flagged: false, reasons: [], synced: true, at: '2026-10-06T09:00:00Z' })

test('reset keeps a stopped day stopped', () => {
  writeDay({ ...readDay(), checkin: CHECKIN(8, 'rest'), stopped: 'rest' })
  expect(resetTodayCheckin()).toEqual({ ok: false, reason: 'stopped' })
  expect(readDay().stopped).toBe('rest')
  expect(readDay().checkin?.pain).toBe(8)
  expect(sessionStorage.getItem('praxis.checkin')).not.toBeNull()
})

test('reset clears an ordinary check-in, here and in the session key', () => {
  writeDay({ ...readDay(), checkin: CHECKIN(2, 'full') })
  expect(sessionStorage.getItem('praxis.checkin')).not.toBeNull()
  expect(resetTodayCheckin()).toEqual({ ok: true })
  expect(readDay().checkin).toBeNull()
  expect(sessionStorage.getItem('praxis.checkin')).toBeNull()
})

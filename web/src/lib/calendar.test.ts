import type { CalendarDay } from './api'
import { addDays, dayLines, daysLabel, sampleVisitAt, visitText, longDate, monthLabel, monthRange, rangeLabel, shift, shortDate, weekRange, weekday } from './calendar'

const day = (over: Partial<CalendarDay>): CalendarDay => ({ date: '2026-09-29', weekday: 1, is_today: false, status: 'planned', planned: true, nhpt_due: false, minutes: 10, minutes_done: 0, exercises: [{ id: 'abduction', name: 'Arm out to the side' }, { id: 'cup', name: 'Waiter – cup' }], sessions: [], sample: false, clinic_visit: null, ...over })

test('date arithmetic stays on the day in any time zone', () => {
  expect(addDays('2026-09-28', 7)).toBe('2026-10-05')
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  expect(weekday('2026-09-28')).toBe(0) // Monday
  expect(weekday('2026-10-04')).toBe(6) // Sunday
})

test('week view is last week and this week, Monday to Sunday (as the Figma frame)', () => {
  expect(weekRange('2026-09-28')).toEqual({ from: '2026-09-21', to: '2026-10-04' })
  expect(weekRange('2026-10-01')).toEqual({ from: '2026-09-21', to: '2026-10-04' })
  expect(rangeLabel(weekRange('2026-09-16'))).toBe('7 – 20 Sep 2026')
  expect(rangeLabel(weekRange('2026-09-28'))).toBe('21 Sep – 4 Oct 2026')
  expect(rangeLabel({ from: '2025-12-29', to: '2026-01-11' })).toBe('29 Dec 2025 – 11 Jan 2026')
})

test('month view covers whole weeks around the month', () => {
  expect(monthRange('2026-09-28')).toEqual({ from: '2026-08-31', to: '2026-10-04' }) // 5 rows
  expect(monthRange('2026-11-15')).toEqual({ from: '2026-10-26', to: '2026-12-06' }) // 6 rows
  expect(monthLabel('2026-09-28')).toBe('September 2026')
})

test('‹ › step a week or a month', () => {
  expect(shift('week', '2026-09-28', 1)).toBe('2026-10-05')
  expect(shift('week', '2026-09-28', -1)).toBe('2026-09-21')
  expect(shift('month', '2026-01-31', 1)).toBe('2026-02-01')
  expect(shift('month', '2026-01-15', -1)).toBe('2025-12-01')
})

test('labels', () => {
  expect(shortDate('2026-09-28')).toBe('Mon 28 Sep')
  expect(longDate('2026-10-02')).toBe('Friday 2 October')
  expect(daysLabel([0, 1, 2, 3, 4])).toBe('Mon–Fri')
  expect(daysLabel([4, 0, 2])).toBe('Mon, Wed, Fri')
  expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('Every day')
  expect(visitText('2026-10-02T14:30')).toBe('Fri 2 Oct, 2:30 PM')
  expect(visitText('2026-10-09T10:00')).toBe('Fri 9 Oct, 10:00 AM')
  expect(visitText('2026-10-05T00:05')).toBe('Mon 5 Oct, 12:05 AM')
})

test('every status is said in words, never by colour alone', () => {
  const live = { id: 'a', title: 'Arm out to the side', exercise: 'abduction', name: 'Arm out to the side', mode: 'arm', minutes: 11, source: 'live' as const }
  expect(dayLines(day({ status: 'done', sessions: [live] }))).toEqual(['Arm out to the side ✓ · 11 min'])
  expect(dayLines(day({ status: 'done', sessions: [live] }), true)).toEqual(['Done ✓'])
  expect(dayLines(day({ status: 'today', is_today: true }))).toEqual(['Today · Arm out to the side + Waiter – cup · 10 min'])
  expect(dayLines(day({ status: 'planned' }))).toEqual(['Planned · 10 min'])
  expect(dayLines(day({ status: 'missed' }))).toEqual(['Planned · not done'])
  expect(dayLines(day({ status: 'rest', planned: false, exercises: [] }))).toEqual(['Rest'])
  expect(dayLines(day({ status: 'planned', planned: false, nhpt_due: true, minutes: 0, exercises: [{ id: 'nhpt', name: 'Nine-Hole Peg Test' }] }))).toEqual(['Peg test (weekly)'])
  expect(dayLines(day({ status: 'untracked' }))).toEqual([]) // blank, and its card carries no status colour
  expect(dayLines(day({ clinic_visit: { at: '2026-10-02T14:30', with: 'Dr. Anita Rao, OT', with_short: 'Dr. Rao', time: '2:30 PM' } }))).toEqual(['Planned · 10 min', 'Clinic · Dr. Rao 2:30 PM'])
})

test('a sample day is labelled Sample and never says done', () => {
  const sample = [
    { id: 's1', title: 'Waiter – cup', exercise: 'cup', name: 'Waiter – cup', mode: 'cup', minutes: 12, source: 'sample' as const },
    { id: 's2', title: 'Nine-Hole Peg Test · 41.2 s', exercise: 'nhpt', name: 'Nine-Hole Peg Test', mode: 'nhpt', minutes: 1, source: 'sample' as const, nhpt_total_s: 41.2 },
  ]
  const lines = dayLines(day({ status: 'untracked', sample: true, sessions: sample }))
  expect(lines).toEqual(['Sample', 'Waiter – cup · 12 min', 'Peg test 41.2 s'])
  expect(lines.join(' ')).not.toMatch(/✓|Done/)
  // 12 Sep 2026 was a Saturday: sample history on a rest day is still shown, labelled
  expect(dayLines(day({ status: 'rest', planned: false, exercises: [], sample: true, sessions: sample }))[0]).toBe('Sample')
})

test('the sample next visit is the next weekday at least three days ahead (as the service), never in the past', () => {
  expect(sampleVisitAt(new Date(2026, 9, 10, 9))).toBe('2026-10-13T14:30') // Sat -> Tue
  expect(sampleVisitAt(new Date(2026, 9, 9, 9))).toBe('2026-10-12T14:30') // Fri -> Mon
  expect(sampleVisitAt(new Date(2026, 9, 8, 23))).toBe('2026-10-12T14:30') // Thu -> Sun -> Mon
  expect(sampleVisitAt(new Date(2026, 8, 28, 9))).toBe('2026-10-01T14:30') // Mon -> Thu
})

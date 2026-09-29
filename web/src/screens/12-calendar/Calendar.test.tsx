import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Calendar as CalendarData, CalendarDay, CalendarSession } from '../../lib/api'
import { addDays, weekday } from '../../lib/calendar'
import { mockApi } from '../../test/api-mock'
import { Calendar } from './Calendar'

const TODAY = '2026-09-28' // a Monday; the service's clock, pinned
const SCHEDULE = { practice_days: [0, 1, 2, 3, 4], nhpt_day: 6, next_visit: { at: '2026-10-02T14:30', with: 'Dr. Anita Rao, OT' }, minutes_per_day: 10 }
const PLAN = [{ id: 'abduction', name: 'Arm out to the side' }, { id: 'cup', name: 'Waiter – cup' }]
const VISIT = { at: '2026-10-02T14:30', with: 'Dr. Anita Rao, OT', with_short: 'Dr. Rao', time: '2:30 PM' }
const live = (name: string, mode: string, minutes: number): CalendarSession => ({ id: `${name}-${minutes}`, title: name, exercise: mode === 'arm' ? 'abduction' : mode, name, mode, minutes, source: 'live' })
const sample = (name: string, mode: string, minutes: number, nhpt?: number): CalendarSession => ({ ...live(name, mode, minutes), source: 'sample', nhpt_total_s: nhpt ?? null })

/** What the service answers for a range, with a small, fixed history: a live session on Mon 21
 *  Sep (so later past practice days are "missed"), sample history on 8–12 Sep. */
function days(from: string, to: string): CalendarDay[] {
  const out: CalendarDay[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = weekday(d)
    const planned = wd < 5
    const nhpt = wd === 6
    const sessions = d === '2026-09-21' ? [live('Arm out to the side', 'arm', 11)] : d === '2026-09-10' ? [sample('Waiter – cup', 'cup', 9)] : d === '2026-09-12' ? [sample('Waiter – cup', 'cup', 12), sample('Nine-Hole Peg Test', 'nhpt', 1, 41.2)] : []
    const status = sessions.some((s) => s.source === 'live') ? 'done' : d === TODAY ? 'today' : d > TODAY ? (planned || nhpt ? 'planned' : 'rest') : !(planned || nhpt) ? 'rest' : d >= '2026-09-21' ? 'missed' : 'untracked'
    out.push({ date: d, weekday: wd, is_today: d === TODAY, status, planned, nhpt_due: nhpt, minutes: planned ? 10 : 0, minutes_done: sessions.filter((s) => s.source === 'live').reduce((n, s) => n + s.minutes, 0), exercises: [...(planned ? PLAN : []), ...(nhpt ? [{ id: 'nhpt', name: 'Nine-Hole Peg Test' }] : [])], sessions, sample: sessions.length > 0 && sessions.every((s) => s.source === 'sample'), clinic_visit: d === '2026-10-02' ? VISIT : null })
  }
  return out
}
function cal(from: string, to: string): CalendarData {
  return { from, to, today: TODAY, days: days(from, to), week: { from: '2026-09-28', to: '2026-10-04', done_days: 1, planned_days: 5, minutes_done: 11, minutes_planned: 50, nhpt_done: false }, schedule: SCHEDULE, next_visit: { ...VISIT, date: '2026-10-02', text: 'Fri 2 Oct, 2:30 PM', upcoming: true }, tracking_since: '2026-09-21' }
}
// More specific keys first: the mock matches the first key the URL contains.
const ROUTES = {
  '/api/calendar?from=2026-09-14&to=2026-09-27': cal('2026-09-14', '2026-09-27'),
  '/api/calendar?from=2026-09-28&to=2026-10-11': cal('2026-09-28', '2026-10-11'),
  '/api/calendar?from=2026-09-21&to=2026-10-04': cal('2026-09-21', '2026-10-04'),
  '/api/calendar?from=2026-08-31&to=2026-10-04': cal('2026-08-31', '2026-10-04'),
  '/api/calendar?from=2026-07-27&to=2026-09-06': cal('2026-07-27', '2026-09-06'),
  '/api/calendar': cal('2026-09-28', '2026-10-04'),
}

function renderCalendar() {
  return render(
    <MemoryRouter initialEntries={['/details/calendar']}>
      <Routes>
        <Route path="/details/calendar" element={<Calendar />} />
        <Route path="/details/checkin" element={<div>CHECKIN</div>} />
      </Routes>
    </MemoryRouter>,
  )
}
const card = (date: string) => screen.getByTestId(`day-${date}`)

test('week view: last week and this week, every status in words, today from the service', async () => {
  const fetchMock = mockApi(ROUTES)
  renderCalendar()
  expect(screen.getByText(/Loading your calendar/)).toBeInTheDocument()
  expect(await screen.findByText('21 Sep – 4 Oct 2026')).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument()
  expect(screen.getByText('Your program asks for 5 practice days a week. Rest days are part of the plan.')).toBeInTheDocument()
  // the range was asked for with the service's today, not the browser clock
  expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/calendar?from=2026-09-21&to=2026-10-04'))).toBe(true)
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) expect(screen.getByText(d)).toBeInTheDocument()
  expect(card('2026-09-21')).toHaveTextContent('Arm out to the side ✓ · 11 min')
  expect(card('2026-09-22')).toHaveTextContent('Planned · not done')
  expect(card('2026-09-26')).toHaveTextContent('Rest')
  expect(card('2026-09-27')).toHaveTextContent('Peg test · not done')
  expect(card('2026-09-28')).toHaveTextContent('Today · Arm out to the side + Waiter – cup · 10 min')
  expect(card('2026-09-28')).toHaveAttribute('aria-current', 'date')
  expect(card('2026-09-29')).toHaveTextContent('Planned · 10 min')
  expect(card('2026-10-02')).toHaveTextContent('Clinic · Dr. Rao 2:30 PM')
  expect(card('2026-10-04')).toHaveTextContent('Peg test (weekly)')
  // future days are never shown as not done
  for (const d of ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']) expect(card(d)).not.toHaveTextContent(/not done/)
  // screen readers get the full date
  expect(within(card('2026-10-02')).getByText('Friday 2 October')).toBeInTheDocument()
  // colour never alone: a legend names every colour
  const legend = screen.getByRole('list', { name: 'Legend' })
  for (const t of ['Done', 'Planned', 'Planned, not done', 'Clinic visit', 'Rest', 'Sample (not yours)', 'Not tracked yet']) expect(within(legend).getByText(t)).toBeInTheDocument()
  // only the three exercises of the 28 Sep lock
  expect(document.body.textContent).not.toMatch(/Pendulum|Arm to the front|Rotate (in|out)/)
})

test('right column: today card starts the check-in, this week from the program, the clinic visit', async () => {
  mockApi(ROUTES)
  renderCalendar()
  const today = await screen.findByRole('region', { name: 'Today' })
  expect(today).toHaveTextContent('Today · Mon 28 Sep')
  expect(within(today).getByRole('heading', { name: 'Arm out to the side + Waiter – cup' })).toBeInTheDocument()
  expect(today).toHaveTextContent(/About 10 min/)
  const week = screen.getByRole('region', { name: 'This week' })
  expect(week).toHaveTextContent('1 of 5 days · 11 of ~50 min')
  const bar = within(week).getByRole('progressbar', { name: 'Practice days this week' })
  expect(bar).toHaveAttribute('aria-valuenow', '1')
  expect(bar).toHaveAttribute('aria-valuemax', '5')
  expect(week).toHaveTextContent('Goal comes from your program, not from the app.')
  expect(week).toHaveTextContent(/Peg test this week: not yet/)
  const visit = screen.getByRole('region', { name: 'Clinic visit' })
  expect(visit).toHaveTextContent('Fri 2 Oct, 2:30 PM')
  expect(visit).toHaveTextContent('Dr. Anita Rao, OT')
  fireEvent.click(within(today).getByRole('button', { name: 'Start session' }))
  expect(await screen.findByText('CHECKIN')).toBeInTheDocument()
})

test('‹ › move a week at a time', async () => {
  const fetchMock = mockApi(ROUTES)
  renderCalendar()
  await screen.findByText('21 Sep – 4 Oct 2026')
  fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
  expect(await screen.findByText('14 – 27 Sep 2026')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
  fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
  expect(await screen.findByText('28 Sep – 11 Oct 2026')).toBeInTheDocument()
  expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('from=2026-09-28&to=2026-10-11'))).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Back to today' }))
  expect(await screen.findByText('21 Sep – 4 Oct 2026')).toBeInTheDocument()
})

test('month view: whole weeks, compact words, sample days labelled and never done', async () => {
  const fetchMock = mockApi(ROUTES)
  renderCalendar()
  await screen.findByText('21 Sep – 4 Oct 2026')
  fireEvent.click(screen.getByRole('radio', { name: 'Month' }))
  expect(await screen.findByText('September 2026')).toBeInTheDocument()
  expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('from=2026-08-31&to=2026-10-04'))).toBe(true)
  expect(screen.getAllByTestId(/^day-/)).toHaveLength(35)
  expect(card('2026-09-21')).toHaveTextContent('Done ✓')
  expect(card('2026-09-10')).toHaveTextContent('Sample')
  expect(card('2026-09-10')).not.toHaveTextContent(/Done|✓/)
  expect(card('2026-09-22')).toHaveTextContent('Not done')
  expect(card('2026-10-02')).toHaveTextContent('Clinic 2:30 PM')
  expect(within(card('2026-08-31')).getByText('31 Aug')).toBeInTheDocument() // outside the month: says which month
  fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
  expect(await screen.findByText('August 2026')).toBeInTheDocument()
})

test('week view shows the sample history labelled when it is in range', async () => {
  mockApi({ '/api/calendar?from=2026-09-07&to=2026-09-20': cal('2026-09-07', '2026-09-20'), ...ROUTES })
  renderCalendar()
  await screen.findByText('21 Sep – 4 Oct 2026')
  fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
  fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
  expect(await screen.findByText('7 – 20 Sep 2026')).toBeInTheDocument()
  expect(card('2026-09-12')).toHaveTextContent('Sample')
  expect(card('2026-09-12')).toHaveTextContent('Waiter – cup · 12 min')
  expect(card('2026-09-12')).toHaveTextContent('Peg test 41.2 s')
  expect(card('2026-09-11')).toHaveTextContent('Not tracked yet')
  expect(card('2026-09-13')).toHaveTextContent('Not tracked yet') // a peg-test Sunday before the first live session
})

test('layout holds at 1280: shrinkable grid columns, controls at least 56 px', async () => {
  mockApi(ROUTES)
  renderCalendar()
  await screen.findByText('21 Sep – 4 Oct 2026')
  expect(screen.getByRole('list', { name: 'Days' }).className).toMatch(/grid-cols-\[repeat\(7,minmax\(0,1fr\)\)\]/)
  expect(screen.getByTestId('calendar-layout').className).toMatch(/grid-cols-\[minmax\(0,1fr\)_/)
  for (const name of ['Previous week', 'Next week']) expect(screen.getByRole('button', { name }).className).toMatch(/min-h-14/)
  expect(screen.getByRole('radio', { name: 'Week' }).className).toMatch(/min-h-14/)
})

test('the service being down says so', async () => {
  mockApi({})
  renderCalendar()
  expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load your calendar/)
})

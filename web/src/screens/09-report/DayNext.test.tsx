import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { readDay, todayKey } from '../../lib/day'
import { ME, SESSION, mockApi } from '../../test/api-mock'
import { SessionReport } from './SessionReport'

function Where() {
  const l = useLocation()
  return <div>AT {l.pathname + l.search}</div>
}

function renderReport() {
  return render(
    <MemoryRouter initialEntries={['/report/abc']}>
      <Routes>
        <Route path="/report/:id" element={<SessionReport />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

const CHECKIN = { pain: 2, location: 'hand', energy: 'comfortable', minutes: 14, new_symptoms: false, side: 'right', tier: 'full', flagged: false, reasons: [], synced: true, at: '' }

function storeDay(extra: Record<string, unknown>) {
  localStorage.setItem('praxis.day', JSON.stringify({ date: todayKey(), checkin: CHECKIN, done: [], demosSeen: [], current: null, finished: [], stopped: null, ...extra }))
}

const armCam = { reps_total: 3, verified: 3, unverified: 0, coverage_pct: 100, posture_cues: 1, active_s: 300, peak_deg: [88, 90, 89], peak_verified: [true, true, true] }
const armSession = { ...SESSION, id: 'abc', mode: 'arm', exercise: 'abduction', title: 'Arm out to the side', summary: { ...SESSION.summary, mode: 'arm', exercise: 'abduction', camera: armCam } }

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

test('mid-day the report shows each exercise on its own and offers the next one, demonstration first', async () => {
  storeDay({ current: 'abduction' })
  const fetchMock = mockApi({ '/api/sessions/abc': armSession, '/api/patients/me': ME })
  renderReport()
  const start = await screen.findByRole('button', { name: 'Start session' })
  expect(readDay().done).toEqual(['abduction'])
  expect(screen.getByText('1 of 2 done')).toBeInTheDocument()
  expect(screen.getByText('Not done yet')).toBeInTheDocument()
  expect(screen.getByText('Results show here once you practise it today.')).toBeInTheDocument()
  expect(screen.getByText('3 verified · 0 unverified')).toBeInTheDocument()
  expect(screen.getByRole('img', { name: /^Arm out to the side · peak angle per rep: 1: 88°, 2: 90°, 3: 89°$/ })).toBeInTheDocument()
  // Next practice: the pending exercise with today's dose, needs and watch-for
  expect(screen.getByText('Still to do today')).toBeInTheDocument()
  const nx = screen.getByText('Still to do today').closest('.rp-nx') as HTMLElement
  expect(within(nx).getByText('Waiter – cup')).toBeInTheDocument()
  expect(within(nx).getByText('2 slow arcs, then 2 fast')).toBeInTheDocument()
  expect(within(nx).getByText('A cup · Printed sheets')).toBeInTheDocument()
  expect(within(nx).getByText('About 5 min · demonstration, then camera setup')).toBeInTheDocument()
  // the day card shows only once nothing is pending
  expect(screen.queryByText(/^Today ·/)).not.toBeInTheDocument()
  // only this session and the profile are loaded; no other report exists yet
  expect(fetchMock.mock.calls.every((c) => /\/api\/(sessions\/abc|patients\/me)/.test(String(c[0])))).toBe(true)
  fireEvent.click(start)
  expect(screen.getByText('AT /details/demo?exercise=cup&side=right')).toBeInTheDocument()
})

test('after the last exercise each column keeps its own counts and only active time is summed', async () => {
  storeDay({ done: ['abduction'], current: 'cup', finished: [{ exercise: 'abduction', reportId: 'arm1' }] })
  mockApi({ '/api/sessions/arm1': { ...armSession, id: 'arm1' }, '/api/sessions/abc': SESSION, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByText('3 verified · 0 unverified')).toBeInTheDocument()
  expect(screen.getByText('17 verified · 3 unverified')).toBeInTheDocument()
  // 702 s + 300 s, labelled as the day's total; verified counts are never summed across tasks
  expect(screen.getByText('16:42')).toBeInTheDocument()
  expect(screen.getByText('active · all exercises today')).toBeInTheDocument()
  expect(screen.queryByText('20')).not.toBeInTheDocument()
  // design review 21 Oct: each exercise's counts are also in the metrics row at the top, never summed
  const stats = screen.getByText('active · all exercises today').closest('.rp-stats')!
  expect(stats).toHaveTextContent(/3\s*verified · Arm out to the side/)
  expect(stats).toHaveTextContent(/0\s*unverified · Arm out to the side/)
  expect(stats).toHaveTextContent(/17\s*verified · Waiter – cup/)
  expect(stats).toHaveTextContent(/3\s*unverified · Waiter – cup/)
  // the metrics come before the day card
  expect(stats.compareDocumentPosition(screen.getByText('Today · 2 of 2 done')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByText('Today · 2 of 2 done')).toBeInTheDocument()
  expect(screen.getByText("That's everything for today.")).toBeInTheDocument()
  expect(screen.getByText('Complete')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Start session' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Its report' }))
  expect(screen.getByText('AT /details/report/arm1')).toBeInTheDocument()
})

test('a stop rule mid-day ends the day on the report: "Today\'s practice stops here" (bug #16)', async () => {
  storeDay({ current: 'abduction' })
  mockApi({ '/api/sessions/abc': { ...armSession, summary: { ...armSession.summary, stopped: true } }, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByText(/today's practice stops here/i)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Start session' })).not.toBeInTheDocument()
  expect(screen.queryByText('1 of 2 done')).not.toBeInTheDocument()
  expect(readDay().stopped).toBe('session')
})

test('an old report opened from history shows no day controls and keeps its next-practice text', async () => {
  storeDay({ done: ['abduction'] })
  mockApi({ '/api/sessions/abc': SESSION, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByText(/Continue your assigned plan/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Start session' })).not.toBeInTheDocument()
  expect(screen.queryByText(/^Today ·/)).not.toBeInTheDocument()
  expect(screen.queryByText('Not done yet')).not.toBeInTheDocument()
  expect(screen.getByRole('img', { name: /reach time/i })).toBeInTheDocument()
})

test('on a gentle day the exercise columns show the gentle dose, the same as Next practice', async () => {
  storeDay({ current: 'abduction', checkin: { ...CHECKIN, pain: 5, tier: 'gentle' } })
  mockApi({ '/api/sessions/abc': armSession, '/api/patients/me': ME })
  renderReport()
  await screen.findByRole('button', { name: 'Start session' })
  const done = screen.getByText('3 verified · 0 unverified').closest('.rp-ex') as HTMLElement
  expect(within(done).getByText('2 sets of 6 · hold 2 s · up to 60°')).toBeInTheDocument()
  const pend = screen.getByText('Not done yet').closest('.rp-ex') as HTMLElement
  expect(within(pend).getByText('2 slow arcs only')).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/2 slow arcs, then 2 fast|2 sets of 8/)
})

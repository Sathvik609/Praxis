import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SESSION, mockApi } from '../../test/api-mock'
import { Progress } from './Progress'

const PROGRESS = { nhpt_trend: [{ date: '2026-08-01', total_s: 68 }, { date: '2026-09-12', total_s: 41.2 }], verified_per_session: [{ date: '2026-07-10', verified: 5, limited: false, mode: 'cup' }, { date: '2026-09-10', verified: 8, limited: true, mode: 'cup' }, { date: '2026-09-12', verified: 17, limited: false, mode: 'cup' }, { date: '2026-09-11', verified: 14, limited: false, mode: 'arm' }], practice: { done: 1, planned: null, hours: 0.2 }, adherence_pct: null, sample: { done: 19, planned: 22, hours: 3.4, illustrative: true as const }, pain_effort: [{ date: '2026-09-08', pain_after: 5, effort: 7, ended_early: true }], goal_log_count: 6 }
const cam = (verified: number) => ({ ...SESSION.summary, camera: { ...SESSION.summary.camera, verified } })
const SESSIONS = { sessions: [
  SESSION,
  { ...SESSION, id: 'lim', tracking: 'limited', status: 'complete', title: 'Waiter – cup', date: '2026-09-10', summary: cam(8) },
  { ...SESSION, id: 'jul', title: 'Waiter – cup', date: '2026-07-10', summary: cam(5) },
  { ...SESSION, id: 'early', mode: 'arm', status: 'ended_early', title: 'Arm out to the side', date: '2026-09-11', feedback: { pain_after: 5 }, summary: { ...cam(14), mode: 'arm' } },
  { ...SESSION, id: 'abd', mode: 'arm', exercise: 'abduction', title: 'Arm out to the side', date: '2026-09-12', summary: { ...cam(12), mode: 'arm', exercise: 'abduction' } },
  // a session of an exercise hidden on 28 Sep: the service no longer lists these; the page ignores one anyway
  { ...SESSION, id: 'pend', mode: 'arm', exercise: 'pendulum', title: 'Pendulum', date: '2026-09-12', summary: { ...cam(20), mode: 'arm', exercise: 'pendulum' } },
  { ...SESSION, id: 'nhpt', mode: 'nhpt', title: 'Nine-Hole Peg Test · 41.2 s', date: '2026-09-12', summary: { ...cam(9), mode: 'nhpt' } },
] }

function renderProgress() {
  return render(
    <MemoryRouter initialEntries={['/progress']}>
      <Routes>
        <Route path="/progress" element={<Progress />} />
        <Route path="/report/:id" element={<div>REPORT</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('progress shows NHPT trend, verified bars with unverified hatched, practice and session list', async () => {
  mockApi({ '/api/progress': PROGRESS, '/api/sessions': SESSIONS })
  renderProgress()
  expect(screen.getByText(/Loading your progress/)).toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: 'Nine-Hole Peg Test' })).toBeInTheDocument()
  expect(screen.getAllByText('41.2').length).toBeGreaterThan(0)
  expect(screen.getByRole('img', { name: /Nine-Hole Peg Test.*68 s.*41\.2 s/ })).toBeInTheDocument()
  const bars = screen.getByRole('img', { name: /Waiter – cup/ })
  expect(bars).toHaveAccessibleName(/09-10 8 reaches unverified/)
  // real practice numbers, and the wireframe's sample history labeled as such next to them
  expect(screen.getByText('sessions recorded here')).toBeInTheDocument()
  expect(screen.getByText('active time · rests excluded')).toBeInTheDocument()
  expect(screen.getByText('Sample')).toBeInTheDocument()
  expect(screen.getByText('19/22')).toBeInTheDocument()
  expect(screen.getByText(/not added to yours/)).toBeInTheDocument()
  expect(screen.getAllByText('Limited tracking').length).toBeGreaterThan(0)
  expect(screen.getByText(/session ended early/)).toBeInTheDocument()
  expect(screen.getByText(/No recovery score is calculated/)).toBeInTheDocument()
  // only Waiter – cup sessions under the default task filter
  expect(screen.getAllByRole('button', { name: /^Open / }).length).toBe(2)
})

test('filters are real: range, task and compare-same-setup change the bars and the list', async () => {
  mockApi({ '/api/progress': PROGRESS, '/api/sessions': SESSIONS })
  renderProgress()
  await screen.findByRole('heading', { name: 'Nine-Hole Peg Test' })
  // default range is the last 4 weeks anchored on the newest date: the July session is out
  expect(screen.getByRole('img', { name: /Waiter – cup/ })).not.toHaveAccessibleName(/07-10/)
  fireEvent.click(screen.getByRole('radio', { name: 'All time' }))
  expect(screen.getByRole('img', { name: /Waiter – cup/ })).toHaveAccessibleName(/07-10/)
  fireEvent.click(screen.getByLabelText(/Compare same setup only/))
  expect(screen.getByRole('img', { name: /Waiter – cup/ })).not.toHaveAccessibleName(/09-10/)
  fireEvent.click(screen.getByRole('radio', { name: 'Arm out to the side' }))
  expect(screen.getByRole('img', { name: /Arm out to the side/ })).toHaveAccessibleName(/09-11 14/)
  expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(2)
  expect(screen.getByText(/Ended early · pain 5/)).toBeInTheDocument()
})

test('goal log count is not dressed up as this month or as a fixed goal sentence', async () => {
  mockApi({ '/api/progress': PROGRESS, '/api/sessions': SESSIONS })
  renderProgress()
  expect(await screen.findByText(/6 attempts logged/)).toBeInTheDocument()
  expect(screen.queryByText(/this month/)).not.toBeInTheDocument()
})

test('log an attempt refetches instead of reloading the page', async () => {
  const fetchMock = mockApi({ '/api/progress': PROGRESS, '/api/sessions': SESSIONS, '/api/goal-log': { ok: true, goal_attempts: 7 } })
  renderProgress()
  await screen.findByRole('heading', { name: 'Nine-Hole Peg Test' })
  const before = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/progress')).length
  fireEvent.click(screen.getByRole('button', { name: 'Log an attempt' }))
  await waitFor(() => expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/progress')).length).toBe(before + 1))
})

test('empty state when there are no sessions yet', async () => {
  mockApi({ '/api/progress': { ...PROGRESS, nhpt_trend: [], verified_per_session: [] }, '/api/sessions': { sessions: [] } })
  renderProgress()
  expect(await screen.findByText(/No sessions yet/)).toBeInTheDocument()
  expect(screen.getByText(/No assessments yet/)).toBeInTheDocument()
})

test('the task filter offers only the visible practice exercises; a hidden exercise never shows', async () => {
  mockApi({ '/api/progress': PROGRESS, '/api/sessions': SESSIONS })
  renderProgress()
  await screen.findByRole('heading', { name: 'Nine-Hole Peg Test' })
  const task = screen.getByLabelText('Task')
  expect(within(task).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Arm out to the side', 'Waiter – cup'])
  fireEvent.click(screen.getByRole('radio', { name: 'Arm out to the side' }))
  expect(screen.getByRole('img', { name: /^Arm out to the side/ })).toHaveAccessibleName(/09-12 12 lifts/)
  expect(document.body.textContent).not.toMatch(/Pendulum|Arm to the front|Rotate (in|out)/)
  expect(screen.queryByText(/20 swings/)).not.toBeInTheDocument()
})

test('sample history is labeled Sample on the chart, the list and the peg-test trend', async () => {
  const sample = { sessions: [{ ...SESSION, illustrative: true }] }
  mockApi({ '/api/progress': PROGRESS, '/api/sessions': sample })
  renderProgress()
  await screen.findByRole('heading', { name: 'Nine-Hole Peg Test' })
  expect(screen.getByText('Includes sample')).toBeInTheDocument() // no real peg-test session backs the trend
  expect(screen.getAllByText('Sample').length).toBeGreaterThanOrEqual(3) // practice card, chart card, list row
  expect(screen.getByText(/Sample history is illustrative, not yours/)).toBeInTheDocument()
})

test('without the session list the chart falls back to verified_per_session by mode', async () => {
  mockApi({ '/api/progress': PROGRESS })
  renderProgress()
  expect(await screen.findByRole('img', { name: /Waiter – cup/ })).toHaveAccessibleName(/09-12 17 reaches/)
})

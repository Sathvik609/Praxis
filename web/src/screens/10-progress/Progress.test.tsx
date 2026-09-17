import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SESSION, mockApi } from '../../test/api-mock'
import { Progress } from './Progress'

const PROGRESS = { nhpt_trend: [{ date: '2026-08-01', total_s: 68 }, { date: '2026-09-12', total_s: 41.2 }], verified_per_session: [{ date: '2026-07-10', verified: 5, limited: false, mode: 'cup' }, { date: '2026-09-10', verified: 8, limited: true, mode: 'cup' }, { date: '2026-09-12', verified: 17, limited: false, mode: 'cup' }, { date: '2026-09-11', verified: 14, limited: false, mode: 'arm' }], practice: { done: 19, planned: 22, hours: 3.4 }, pain_effort: [{ date: '2026-09-08', pain_after: 5, effort: 7, ended_early: true }], goal_log_count: 6 }
const SESSIONS = { sessions: [SESSION, { ...SESSION, id: 'lim', tracking: 'limited', status: 'complete', title: 'Waiter – cup', date: '2026-09-10' }, { ...SESSION, id: 'early', mode: 'arm', status: 'ended_early', title: 'Arm to the front', date: '2026-09-08', feedback: { pain_after: 5 } }] }

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
  expect(screen.getByText('19/22')).toBeInTheDocument()
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
  fireEvent.click(screen.getByRole('radio', { name: 'Arm to the front' }))
  expect(screen.getByRole('img', { name: /Arm to the front/ })).toHaveAccessibleName(/09-11 14/)
  expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(1)
  expect(screen.getByText(/Ended early · pain 5/)).toBeInTheDocument()
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

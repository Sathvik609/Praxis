import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SESSION, mockApi } from '../../test/api-mock'
import { Progress } from './Progress'

const PROGRESS = { nhpt_trend: [{ date: '2026-08-01', total_s: 68 }, { date: '2026-09-12', total_s: 41.2 }], verified_per_session: [{ date: '2026-09-10', verified: 8, limited: true, mode: 'cup' }, { date: '2026-09-12', verified: 17, limited: false, mode: 'cup' }], practice: { done: 19, planned: 22, hours: 3.4 }, pain_effort: [{ date: '2026-09-08', pain_after: 5, effort: 7, ended_early: true }], goal_log_count: 6 }

test('progress shows NHPT trend, verified bars with limited tracking greyed, practice and session list', async () => {
  mockApi({ '/api/progress': PROGRESS, '/api/sessions': { sessions: [SESSION, { ...SESSION, id: 'lim', tracking: 'limited', status: 'complete', title: 'Waiter – cup', date: '2026-09-10' }, { ...SESSION, id: 'early', status: 'ended_early', title: 'Arm to the front', date: '2026-09-08', feedback: { pain_after: 5 } }] } })
  render(<MemoryRouter><Progress /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Nine-Hole Peg Test' })).toBeInTheDocument()
  expect(screen.getByText('41.2 s')).toBeInTheDocument()
  expect(screen.getByText(/19\/22/)).toBeInTheDocument()
  expect(screen.getAllByText('Limited tracking').length).toBeGreaterThan(0)
  expect(screen.getByText(/Ended early · pain 5/)).toBeInTheDocument()
  expect(screen.getByText(/No recovery score is calculated/)).toBeInTheDocument()
  expect(screen.getAllByTestId('verified-bar')).toHaveLength(2)
})

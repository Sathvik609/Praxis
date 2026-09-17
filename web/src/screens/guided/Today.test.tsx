import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PLAN, PROFILE, mockApi } from '../../test/api-mock'
import { Today } from './Today'

vi.mock('../../avatar/AvatarPanel', () => ({ AvatarPanel: () => <div data-testid="figure" /> }))

function app() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/ready" element={<div>READY</div>} />
        <Route path="/details" element={<div>DETAILS</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const yesterday = () => new Date(Date.now() - 24 * 3600 * 1000).toISOString()

test('the full tier shows the goal line, the day’s exercises and one Start', async () => {
  mockApi({ '/api/profile': { profile: PROFILE }, '/api/plan/today': PLAN })
  app()
  expect(await screen.findByText('Toward badminton: shoulder range, week 1')).toBeInTheDocument()
  expect(screen.getByText('Pendulum')).toBeInTheDocument()
  expect(screen.getByText('Arm to the front')).toBeInTheDocument()
  expect(screen.getByText('Arm out to the side')).toBeInTheDocument()
  const start = screen.getByRole('button', { name: /^Start · Pendulum/ })
  expect(screen.getAllByRole('button', { name: /^Start/ })).toHaveLength(1)
  await userEvent.click(start)
  expect(screen.getByText('READY')).toBeInTheDocument()
})

test('there is no nav bar and no stats on the guided front door, only a quiet Details link', async () => {
  mockApi({ '/api/profile': { profile: PROFILE }, '/api/plan/today': PLAN })
  app()
  await screen.findByText('Pendulum')
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('link', { name: /Details/ }))
  expect(screen.getByText('DETAILS')).toBeInTheDocument()
})

test('a finished exercise says done in words and Start moves to the next one', async () => {
  const items = PLAN.items.map((i, n) => (n === 0 ? { ...i, done_today: true } : i))
  mockApi({ '/api/profile': { profile: PROFILE }, '/api/plan/today': { ...PLAN, items } })
  app()
  expect(await screen.findByRole('button', { name: /^Start · Arm to the front/ })).toBeInTheDocument()
  expect(screen.getByText('Done')).toBeInTheDocument()
})

test('the gentle tier says why in the coach’s words and still offers a start', async () => {
  mockApi({
    '/api/profile': { profile: PROFILE },
    '/api/plan/today': { ...PLAN, tier: 'gentle', tier_reason: 'Pain 5 today: a gentle version, shorter holds.' },
  })
  app()
  expect(await screen.findByText('Pain 5 today: a gentle version, shorter holds.')).toBeInTheDocument()
  expect(screen.getByText(/Gentle/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^Start/ })).toBeInTheDocument()
})

test('the rest tier offers no exercise at all, only the rest advice', async () => {
  mockApi({
    '/api/profile': { profile: PROFILE },
    '/api/plan/today': { ...PLAN, tier: 'rest', tier_reason: 'Pain 8 today: rest.', items: [], rest_advice: 'Rest today, ice if it helps. Your therapist has been told.' },
  })
  app()
  expect(await screen.findByText('Rest today, ice if it helps. Your therapist has been told.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Start/ })).not.toBeInTheDocument()
})

test('when the last pain answer is not from today the day starts with the two-question check', async () => {
  const fetchMock = mockApi({ '/api/profile': { profile: { ...PROFILE, updated_at: yesterday() } }, '/api/plan/today': PLAN })
  app()
  expect(await screen.findByText(/How is your shoulder today/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Start/ })).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('radio', { name: '6' }))
  await userEvent.click(screen.getByRole('button', { name: 'No' }))
  await userEvent.click(screen.getByRole('button', { name: /See today/ }))

  await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/plan/today?pain=6'))).toBe(true))
  expect(await screen.findByRole('button', { name: /^Start/ })).toBeInTheDocument()
})

test('saying something is new or worse is carried into the day as a warning, not a diagnosis', async () => {
  mockApi({ '/api/profile': { profile: { ...PROFILE, updated_at: yesterday() } }, '/api/plan/today': PLAN })
  app()
  await screen.findByText(/How is your shoulder today/)
  await userEvent.click(screen.getByRole('radio', { name: '2' }))
  await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
  await userEvent.click(screen.getByRole('button', { name: /See today/ }))
  expect(await screen.findByText(/tell your therapist/i)).toBeInTheDocument()
})

test('an unreachable service says so instead of showing an empty day', async () => {
  mockApi({ '/api/profile': { profile: PROFILE } })
  app()
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not load today/i)
})

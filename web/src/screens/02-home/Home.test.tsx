import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SESSION, mockApi } from '../../test/api-mock'

vi.mock('../../avatar/AvatarScene', () => ({ AvatarScene: () => <div data-testid="scene" /> }))

import { Home } from './Home'

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/details/checkin" element={<div>CHECKIN</div>} />
        <Route path="/session" element={<div>SESSION</div>} />
        <Route path="/details/progress" element={<div>PROGRESS</div>} />
        <Route path="/report/:id" element={<div>REPORT</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  mockApi({})
})

test('home shows next practice, week, goal, body map markers and focus panel', () => {
  renderHome()
  // the day card follows the locked day order in lib/plan.ts (the service enforces the same order)
  expect(screen.getByText(/Pendulum → Arm to the front → Arm out to the side → Waiter – cup/)).toBeInTheDocument()
  expect(screen.getByText(/About 15 min/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start session' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Replay a recorded session/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Run the peg test' })).toBeInTheDocument()
  expect(screen.getByText('This week')).toBeInTheDocument()
  expect(screen.getByText('Sample history')).toBeInTheDocument()
  expect(screen.queryByText(/illustrative/)).not.toBeInTheDocument()
  expect(screen.getByText(/Use a cup on my own/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Left hand · Focus/ })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Left hand' })).toBeInTheDocument()
  expect(screen.getByText('41.2')).toBeInTheDocument()
})

test('tapping a marker switches the focus panel', () => {
  renderHome()
  fireEvent.click(screen.getByRole('button', { name: /Left shoulder · Watch/ }))
  expect(screen.getByRole('heading', { name: 'Left shoulder' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Practise Arm to the front' })).toBeInTheDocument()
})

test('start session goes to check-in', () => {
  renderHome()
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
  expect(screen.getByText('CHECKIN')).toBeInTheDocument()
})

test('edit goal saves an inline field to localStorage and shows it', () => {
  renderHome()
  fireEvent.click(screen.getByRole('button', { name: 'Edit goal' }))
  const field = screen.getByLabelText('Your everyday goal')
  fireEvent.change(field, { target: { value: 'Pour my own tea.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save goal' }))
  expect(screen.getByText('Pour my own tea.')).toBeInTheDocument()
  expect(localStorage.getItem('praxis.goal')).toBe('Pour my own tea.')
})

test('ask the coach opens the drawer', async () => {
  renderHome()
  fireEvent.click(screen.getByRole('button', { name: 'Ask the coach' }))
  expect(await screen.findByRole('dialog', { name: 'Ask the coach' })).toBeInTheDocument()
})

test('open report goes to the last session report when there is one, else progress', async () => {
  mockApi({ '/api/sessions': { sessions: [SESSION] } })
  renderHome()
  const btn = screen.getByRole('button', { name: 'Open report' })
  await screen.findByText(/Waiter – cup \+ Arm to the front/)
  fireEvent.click(btn)
  expect(screen.getByText('REPORT')).toBeInTheDocument()
})

test('open report falls back to progress without sessions', () => {
  renderHome()
  fireEvent.click(screen.getByRole('button', { name: 'Open report' }))
  expect(screen.getByText('PROGRESS')).toBeInTheDocument()
})

test('rotate flips front and side; Both alternates every 4 s', () => {
  vi.useFakeTimers()
  try {
    renderHome()
    expect(screen.getByText(/side view/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Rotate view' }))
    expect(screen.getByText(/front view/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Both' }))
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(screen.getByText(/side view/)).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(screen.getByText(/front view/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})

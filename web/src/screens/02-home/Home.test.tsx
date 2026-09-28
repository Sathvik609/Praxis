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
  // the day card follows the 28 Sep day order in lib/plan.ts (the service enforces the same order)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Arm out to the side → Waiter – cup$/)
  expect(screen.getByText(/About 10 min/)).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/Pendulum|Arm to the front|Rotate (in|out)/)
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
  expect(screen.getByRole('button', { name: 'Practise Arm out to the side' })).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/Pendulum|Arm to the front|Rotate (in|out)/)
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
  await screen.findByText(/Waiter – cup \+ Arm out to the side/)
  fireEvent.click(btn)
  expect(screen.getByText('REPORT')).toBeInTheDocument()
})

test('a replayed last session says replay; one goal attempt is singular (review 28 Sep)', async () => {
  mockApi({ '/api/sessions': { sessions: [{ ...SESSION, source: 'replay', replay: true, title: 'Waiter – cup' }] }, '/api/patients/me': { goal: 'Use a cup on my own.', goal_attempts: 1, program: {} } })
  renderHome()
  expect(await screen.findByText(/Last session · 17 verified · Waiter – cup · replay/)).toBeInTheDocument()
  expect(await screen.findByText(/^1 attempt logged this week/)).toBeInTheDocument()
})

test('the week row is seven equal columns, so it cannot overflow its card at 1280 × 800', () => {
  renderHome()
  const tile = screen.getByLabelText('M: done')
  const row = tile.parentElement!.parentElement!
  expect(row.className).toMatch(/grid-cols-7/)
  expect(tile.className).toMatch(/w-full/)
  expect(tile.className).not.toMatch(/(^|\s)w-10(\s|$)/) // seven fixed 40 px tiles were 328 px in a 306 px card
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
    expect(screen.getByText(/Side view/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Rotate view' }))
    expect(screen.getByText(/Front view/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Both' }))
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(screen.getByText(/Side view/)).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(screen.getByText(/Front view/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument()
    // zoom is a camera zoom inside the stage: the panel (labels, caption) is never CSS-scaled
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(document.querySelector('[style*="scale("]')).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})

test('region metrics are sample data and say so; the card lists today from the plan', () => {
  renderHome()
  const card = screen.getByRole('heading', { name: 'Left hand' }).closest('section')!
  expect(card).toHaveTextContent('Sample')
  expect(card).toHaveTextContent(/Today/)
  for (const name of ['Arm out to the side', 'Waiter – cup', 'Nine-Hole Peg Test']) {
    expect(card).toHaveTextContent(name)
  }
  expect(card.textContent).not.toMatch(/Pendulum|Arm to the front|Rotate (in|out)/)
  expect(card).toHaveTextContent(/weekly/)
})

test('a next visit in the past is not shown as upcoming', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 25, 12))
  try {
    renderHome()
    expect(screen.queryByText(/18 Sep/)).not.toBeInTheDocument()
    expect(screen.getByText(/Not booked yet/)).toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})

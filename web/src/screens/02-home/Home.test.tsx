import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../avatar/AvatarScene', () => ({ AvatarScene: () => <div data-testid="scene" /> }))

import { Home } from './Home'

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/checkin" element={<div>CHECKIN</div>} />
        <Route path="/session" element={<div>SESSION</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('home shows next practice, week, goal, body map markers and focus panel', () => {
  renderHome()
  expect(screen.getByText(/Waiter – cup, then Arm to the front/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start session' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Replay a recorded session/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Run the peg test' })).toBeInTheDocument()
  expect(screen.getByText('This week')).toBeInTheDocument()
  expect(screen.getByText(/Use a cup on my own/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Left hand · Focus/ })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Left hand' })).toBeInTheDocument()
  expect(screen.getByText('41.2 s')).toBeInTheDocument()
})

test('tapping a marker switches the focus panel', () => {
  renderHome()
  fireEvent.click(screen.getByRole('button', { name: /Left shoulder · Watch/ }))
  expect(screen.getByRole('heading', { name: 'Left shoulder' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Practise Arm to the front' })).toBeInTheDocument()
})

test('start session goes to check-in and peg test goes to the session', () => {
  renderHome()
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
  expect(screen.getByText('CHECKIN')).toBeInTheDocument()
})

import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../avatar/AvatarScene', () => ({ AvatarScene: () => <div data-testid="scene" /> }))

import { Demonstration } from './Demonstration'

function renderDemo(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/demo" element={<Demonstration />} />
        <Route path="/session" element={<div>SESSION</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('cup demonstration lists five numbered steps and gates Start practice on readiness', () => {
  renderDemo('/demo?exercise=cup&side=left')
  expect(screen.getByRole('heading', { name: 'Waiter – cup' })).toBeInTheDocument()
  const steps = screen.getAllByTestId('step')
  expect(steps).toHaveLength(5)
  expect(steps[0].querySelector('[aria-current="step"]')).not.toBeNull()
  expect(steps[1].querySelector('[aria-current="step"]')).toBeNull()
  const start = screen.getByRole('button', { name: 'Start practice' })
  expect(start).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /I understand the movement/ }))
  expect(start).toBeEnabled()
  fireEvent.click(start)
  expect(screen.getByText('SESSION')).toBeInTheDocument()
})

test('arm demonstration shows assigned, watch-for and stop-if lines and rehearsal', () => {
  renderDemo('/demo?exercise=arm&side=left')
  expect(screen.getByRole('heading', { name: 'Arm to the front' })).toBeInTheDocument()
  expect(screen.getByText('Assigned')).toBeInTheDocument()
  expect(screen.getByText(/Watch for/)).toBeInTheDocument()
  expect(screen.getByText(/Stop if/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Rehearse without scoring' })).toBeInTheDocument()
})

test('instructions-only exercise explains there is no camera demonstration', () => {
  renderDemo('/demo?exercise=grip&side=left')
  expect(screen.getByText(/instructions-only/)).toBeInTheDocument()
})

import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../avatar/AvatarScene', () => ({ AvatarScene: () => <div data-testid="scene" /> }))

import { mockApi } from '../../test/api-mock'
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

test('Arm out to the side starts its own live session', () => {
  renderDemo('/demo?exercise=abduction&side=left')
  expect(screen.getByRole('heading', { name: 'Arm out to the side' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: /I understand the movement/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Start practice' }))
  expect(screen.getByText('SESSION')).toBeInTheDocument()
})

test('a demo-only exercise is watched and self-ticked: no practice, no camera, the tick is posted and labelled', async () => {
  const fetchMock = mockApi({ '/api/self_report': { ok: true, exercise: 'external_rotation', verified: false, source: 'self_ticked', label: 'Demo only · self-ticked, not camera-verified', sets_today: 1 } })
  renderDemo('/demo?exercise=external_rotation&side=left')
  expect(screen.getByRole('heading', { name: 'Rotate out' })).toBeInTheDocument()
  expect(screen.getByText(/The camera does not score this one/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Start practice' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Rehearse without scoring' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'I did a set' }))
  expect(await screen.findByText(/1 set ticked today · self-reported, not checked by the camera/)).toBeInTheDocument()
  const [url, init] = fetchMock.mock.calls[0]
  expect(String(url)).toContain('/api/self_report')
  expect(JSON.parse(String(init?.body))).toEqual({ exercise: 'external_rotation', sets: 1 })
})

import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../avatar/AvatarScene', () => ({ AvatarScene: () => <div data-testid="scene" /> }))

import { stepTexts } from '../../avatar/script'
import { readDay, todayKey, writeSide } from '../../lib/day'
import { mockApi } from '../../test/api-mock'
import { Demonstration } from './Demonstration'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

function renderDemo(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/demo" element={<Demonstration />} />
        <Route path="/session" element={<div>SESSION</div>} />
        <Route path="/details/choose" element={<div>CHOOSE</div>} />
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

test('the step list is the player\'s script: same steps, count and numbering as the captions', () => {
  renderDemo('/demo?exercise=abduction&side=left')
  const steps = screen.getAllByTestId('step').map((li) => li.textContent)
  expect(steps).toEqual(stepTexts('abduction', { holdS: 3 })!.map((t, i) => `${i + 1}${t}`))
  expect(steps.join(' ')).toMatch(/palm down/)
  expect(steps.join(' ')).not.toMatch(/palm forward/)
  expect(steps[2]).toMatch(/Hold for 3 s/)
})

test('the demonstrated hold follows today\'s dose (gentle tier: hold 2 s)', () => {
  localStorage.setItem('praxis.day', JSON.stringify({ date: todayKey(), checkin: { pain: 5 } }))
  renderDemo('/demo?exercise=abduction&side=left')
  expect(screen.getAllByTestId('step')[2]).toHaveTextContent(/Hold for 2 s/)
})

test('cup and peg test lists come from the same scripts as their captions', () => {
  const a = renderDemo('/demo?exercise=cup&side=left')
  expect(screen.getAllByTestId('step').map((li) => li.textContent)).toEqual(stepTexts('waiter_cup')!.map((t, i) => `${i + 1}${t}`))
  a.unmount()
  renderDemo('/demo?exercise=nhpt&side=left')
  expect(screen.getAllByTestId('step').map((li) => li.textContent)).toEqual(stepTexts('nhpt')!.map((t, i) => `${i + 1}${t}`))
})

test('arm demonstration shows assigned, watch-for and stop-if lines and rehearsal', () => {
  renderDemo('/demo?exercise=abduction&side=left')
  expect(screen.getByRole('heading', { name: 'Arm out to the side' })).toBeInTheDocument()
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

test.each(['pendulum', 'arm', 'flexion', 'external_rotation', 'internal_rotation'])('a deep link to hidden %s goes back to Choose and shows nothing of it', (id) => {
  const fetchMock = mockApi({})
  renderDemo(`/demo?exercise=${id}&side=left`)
  expect(screen.getByText('CHOOSE')).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/Pendulum|Arm to the front|Rotate (in|out)/)
  expect(fetchMock).not.toHaveBeenCalled()
})

test('Start practice marks the demo as seen and the exercise as the day\'s current one', () => {
  renderDemo('/demo?exercise=abduction&side=left')
  fireEvent.click(screen.getByRole('checkbox', { name: /I understand the movement/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Start practice' }))
  expect(readDay().current).toBe('abduction')
  expect(readDay().demosSeen).toContain('abduction')
})

test('without a side in the link the saved side is used, not a silent left', () => {
  writeSide('right')
  renderDemo('/demo?exercise=abduction')
  expect(screen.getByText(/right side/)).toBeInTheDocument()
})

test('a day stopped at check-in lets you watch but not start', () => {
  localStorage.setItem('praxis.day', JSON.stringify({ date: todayKey(), checkin: { pain: 8, new_symptoms: false, tier: 'rest', flagged: true, synced: true, side: 'left', minutes: 14 }, done: [], demosSeen: [], current: null, finished: [], stopped: 'rest' }))
  renderDemo('/demo?exercise=abduction&side=left')
  expect(screen.getByText(/No exercises today/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start practice' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Rehearse without scoring' })).toBeDisabled()
})

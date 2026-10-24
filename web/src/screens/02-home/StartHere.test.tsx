import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { readPrefs } from '../../lib/prefs'
import { StartHere, readStartHere, showStartHere } from './StartHere'

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

function renderCard() {
  return render(
    <MemoryRouter initialEntries={['/details']}>
      <Routes>
        <Route path="*" element={<><StartHere /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.judge
})

test('a first visit sees three numbered steps, live exercise first', () => {
  renderCard()
  const card = screen.getByRole('region', { name: 'Start here' })
  const steps = card.querySelectorAll('ol > li')
  expect(steps).toHaveLength(3)
  expect(steps[0]).toHaveTextContent(/Arm out to the side/)
  expect(steps[0]).toHaveTextContent(/webcam/)
  expect(steps[1]).toHaveTextContent(/Nine-Hole Peg Test/)
  expect(steps[1]).toHaveTextContent(/Replay/)
  expect(steps[2]).toHaveTextContent(/technical details/i)
})

test('step 1 opens the Arm out to the side demonstration', () => {
  renderCard()
  fireEvent.click(screen.getByRole('button', { name: 'Start Arm out to the side' }))
  expect(screen.getByTestId('where')).toHaveTextContent('/details/demo?exercise=abduction&side=left')
})

test('step 2 opens Replay in Settings (the replay entry itself stays in Settings)', () => {
  renderCard()
  fireEvent.click(screen.getByRole('button', { name: 'Open Replay' }))
  expect(screen.getByTestId('where')).toHaveTextContent('/details/settings?open=replay')
})

test('step 3 turns on technical details in place', () => {
  renderCard()
  fireEvent.click(screen.getByRole('button', { name: 'Turn on technical details' }))
  expect(readPrefs().judge).toBe(true)
  expect(document.documentElement.dataset.judge).toBe('1')
  expect(screen.getByRole('button', { name: 'Technical details on' })).toBeDisabled()
})

test('Hide remembers the choice on this browser, and Settings can bring it back', () => {
  const { unmount } = renderCard()
  fireEvent.click(screen.getByRole('button', { name: 'Hide start guide' }))
  expect(screen.queryByRole('region', { name: 'Start here' })).not.toBeInTheDocument()
  expect(readStartHere()).toBe(false)
  unmount()
  renderCard()
  expect(screen.queryByRole('region', { name: 'Start here' })).not.toBeInTheDocument()
  showStartHere()
  expect(readStartHere()).toBe(true)
})

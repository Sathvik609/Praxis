import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PRESCRIPTION, mockApi } from '../../test/api-mock'
import { CheckIn } from './CheckIn'

test('check-in collects pain, location, energy, time and symptoms, shows stop rules, then continues', async () => {
  mockApi({ '/api/prescription': PRESCRIPTION })
  render(
    <MemoryRouter initialEntries={['/checkin']}>
      <Routes>
        <Route path="/checkin" element={<CheckIn />} />
        <Route path="/details/choose" element={<div>CHOOSE</div>} />
      </Routes>
    </MemoryRouter>,
  )
  expect(await screen.findByText(/Pain at or above 7/)).toBeInTheDocument()
  expect(screen.getByText(/4–6 → gentle day/)).toBeInTheDocument()
  expect(screen.getByText(/Feeling is what you tell us, never read from your face/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: '2' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Hand' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Tired' }))
  fireEvent.click(screen.getByRole('radio', { name: /Shorter/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue to exercises' }))
  expect(screen.getByText('CHOOSE')).toBeInTheDocument()
  const stored = JSON.parse(sessionStorage.getItem('praxis.checkin') ?? '{}')
  expect(stored).toMatchObject({ pain: 2, location: 'hand', energy: 'tired', minutes: 7, new_symptoms: false })
})

test('continue is disabled with a hint until pain is chosen; the hint then goes away', () => {
  mockApi({ '/api/prescription': PRESCRIPTION })
  render(<MemoryRouter><CheckIn /></MemoryRouter>)
  const cont = screen.getByRole('button', { name: 'Continue to exercises' })
  expect(cont).toBeDisabled()
  expect(cont).toHaveAccessibleDescription('Choose a pain number to continue')
  expect(screen.getByText('Choose a pain number to continue')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: '0' }))
  expect(cont).toBeEnabled()
  expect(screen.queryByText('Choose a pain number to continue')).not.toBeInTheDocument()
})

test('new-symptoms checkbox and push-to-talk are real controls', () => {
  mockApi({ '/api/prescription': PRESCRIPTION })
  render(<MemoryRouter><CheckIn /></MemoryRouter>)
  const box = screen.getByRole('checkbox', { name: /Something new or worse/ })
  fireEvent.click(box)
  expect(box).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Push to talk' }))
  expect(screen.getByText(/Voice input is not available/)).toBeInTheDocument()
})

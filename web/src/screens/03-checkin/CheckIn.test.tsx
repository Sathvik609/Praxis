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
        <Route path="/choose" element={<div>CHOOSE</div>} />
      </Routes>
    </MemoryRouter>,
  )
  expect(await screen.findByText(/Pain at or above 5/)).toBeInTheDocument()
  expect(screen.getByText(/Feeling is what you tell us, never read from your face/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: '2' }))
  fireEvent.click(screen.getByRole('button', { name: 'Hand' }))
  fireEvent.click(screen.getByRole('button', { name: 'Tired' }))
  fireEvent.click(screen.getByRole('button', { name: /Shorter/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue to exercises' }))
  expect(screen.getByText('CHOOSE')).toBeInTheDocument()
  const stored = JSON.parse(sessionStorage.getItem('praxis.checkin') ?? '{}')
  expect(stored).toMatchObject({ pain: 2, location: 'hand', energy: 'tired', minutes: 7, new_symptoms: false })
})

test('continue is disabled until pain is chosen', () => {
  mockApi({ '/api/prescription': PRESCRIPTION })
  render(<MemoryRouter><CheckIn /></MemoryRouter>)
  expect(screen.getByRole('button', { name: 'Continue to exercises' })).toBeDisabled()
})

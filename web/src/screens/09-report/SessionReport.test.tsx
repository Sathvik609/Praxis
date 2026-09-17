import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ME, SESSION, mockApi } from '../../test/api-mock'
import { SessionReport } from './SessionReport'

function renderReport() {
  return render(
    <MemoryRouter initialEntries={['/report/abc']}>
      <Routes>
        <Route path="/report/:id" element={<SessionReport />} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('report separates camera measurements from what the patient told us', async () => {
  mockApi({ '/api/sessions/abc': SESSION, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByRole('heading', { name: 'What the camera measured' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'What you told us' })).toBeInTheDocument()
  expect(screen.getByText('17')).toBeInTheDocument()
  expect(screen.getByText('86')).toBeInTheDocument()
  expect(screen.getByText('verified movements')).toBeInTheDocument()
  expect(screen.getByText(/unverified · hand hid the object/)).toBeInTheDocument()
  expect(await screen.findByText(/Coach notes for Dr. Anita Rao/)).toBeInTheDocument()
  expect(screen.getByText('High')).toBeInTheDocument()
  expect(screen.getByText('Medium')).toBeInTheDocument()
  expect(screen.getByText(/Queued · not yet delivered/)).toBeInTheDocument()
  expect(screen.getByText('Proposal')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Done/ })).toBeInTheDocument()
  // per-rep values are a real chart with a text summary; unverified reps are named as such
  const chart = screen.getByRole('img', { name: /reach time/i })
  expect(chart.getAttribute('aria-label')).toMatch(/unverified/)
  // no hard-coded side when the summary carries none
  expect(screen.queryByText(/left side/)).not.toBeInTheDocument()
})

test('clinician falls back to "your therapist" when the profile is unavailable', async () => {
  mockApi({ '/api/sessions/abc': SESSION })
  renderReport()
  expect(await screen.findByText(/Coach notes for your therapist/)).toBeInTheDocument()
})

test('download builds a JSON blob and sharing explains who sees the report', async () => {
  mockApi({ '/api/sessions/abc': SESSION, '/api/patients/me': ME })
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:praxis')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  renderReport()
  fireEvent.click(await screen.findByRole('button', { name: 'Download JSON' }))
  expect(createObjectURL).toHaveBeenCalledTimes(1)
  expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob)
  expect(click).toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Sharing' }))
  const dialog = screen.getByRole('dialog', { name: /Who sees this report/ })
  expect(dialog).toHaveTextContent(/review queue/)
  expect(dialog).toHaveTextContent(/never video/i)
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  click.mockRestore()
})

test('side is read from the summary when present', async () => {
  mockApi({ '/api/sessions/abc': { ...SESSION, summary: { ...SESSION.summary, camera: { ...SESSION.summary.camera, side: 'right' } } }, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByText(/right side/)).toBeInTheDocument()
})

test('an unknown session (200 with an error body) shows the error card instead of crashing', async () => {
  mockApi({ '/api/sessions/abc': { error: 'unknown session' }, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByText(/Could not load this report/)).toBeInTheDocument()
  expect(screen.getByText(/unknown session/)).toBeInTheDocument()
})

test('error state is a card with a way home', async () => {
  mockApi({})
  renderReport()
  expect(await screen.findByText(/Could not load this report/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }))
  expect(screen.getByText('HOME')).toBeInTheDocument()
})

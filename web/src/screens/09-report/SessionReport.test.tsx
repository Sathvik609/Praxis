import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SESSION, mockApi } from '../../test/api-mock'
import { SessionReport } from './SessionReport'

test('report separates camera measurements from what the patient told us', async () => {
  mockApi({ '/api/sessions/abc': SESSION })
  render(
    <MemoryRouter initialEntries={['/report/abc']}>
      <Routes>
        <Route path="/report/:id" element={<SessionReport />} />
      </Routes>
    </MemoryRouter>,
  )
  expect(await screen.findByRole('heading', { name: 'What the camera measured' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'What you told us' })).toBeInTheDocument()
  expect(screen.getByText('17')).toBeInTheDocument()
  expect(screen.getByText('86%')).toBeInTheDocument()
  expect(screen.getByText(/Coach notes for/)).toBeInTheDocument()
  expect(screen.getByText('High')).toBeInTheDocument()
  expect(screen.getByText('Medium')).toBeInTheDocument()
  expect(screen.getByText(/Queued · not yet delivered/)).toBeInTheDocument()
  expect(screen.getByText(/Proposal/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Done/ })).toBeInTheDocument()
})

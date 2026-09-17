import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PROFILE, SESSION, mockApi } from '../../test/api-mock'
import { Done } from './Done'

const ARM_SESSION = {
  ...SESSION,
  id: 's-42',
  mode: 'arm',
  summary: {
    ...SESSION.summary,
    mode: 'arm',
    camera: { reps_total: 16, verified: 14, unverified: 2, peak_deg: [62, 81, 74], peak_verified: [true, true, false] },
    coach: { label: 'Rule-based coach · LLM agent pending', notes: [{ text: 'progress: your best angle rose across the two sets', confidence: 'high', evidence: [31] }], decisions: 7 },
  },
}

function app(routes: Record<string, unknown>) {
  mockApi(routes)
  return render(
    <MemoryRouter initialEntries={['/done/s-42']}>
      <Routes>
        <Route path="/done/:id" element={<Done />} />
        <Route path="/" element={<div>TODAY</div>} />
        <Route path="/details" element={<div>DETAILS</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('the counts, the best angle and the goal line come from the saved session', async () => {
  app({ '/api/sessions/s-42': ARM_SESSION, '/api/profile': { profile: PROFILE } })
  expect(await screen.findByText(/14 of 16 reps verified toward Play badminton again\./)).toBeInTheDocument()
  expect(screen.getByText('81°')).toBeInTheDocument()
  expect(screen.getByText('verified by the camera')).toBeInTheDocument()
  expect(screen.getByText('unverified')).toBeInTheDocument()
  expect(screen.getByText(/not a failed rep/)).toBeInTheDocument()
  expect(screen.getByText('progress: your best angle rose across the two sets')).toBeInTheDocument()
  expect(screen.getByText('Rule-based coach · LLM agent pending')).toBeInTheDocument()
})

test('Finish goes back to today', async () => {
  app({ '/api/sessions/s-42': ARM_SESSION, '/api/profile': { profile: PROFILE } })
  await screen.findByText(/14 of 16/)
  await userEvent.click(screen.getByRole('button', { name: 'Finish' }))
  expect(screen.getByText('TODAY')).toBeInTheDocument()
})

test('without a goal the line still reads, and a missing session says so', async () => {
  app({ '/api/sessions/s-42': ARM_SESSION, '/api/profile': { profile: null } })
  expect(await screen.findByText('14 of 16 reps verified.')).toBeInTheDocument()
})

test('a session that was never saved says so instead of showing zeros', async () => {
  app({ '/api/profile': { profile: PROFILE } })
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not load this practice/i)
  expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument()
})

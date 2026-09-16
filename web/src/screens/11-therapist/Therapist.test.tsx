import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PRESCRIPTION, SESSION, mockApi } from '../../test/api-mock'
import { Therapist } from './Therapist'

test('therapist dashboard lists patients, open flags, prescription and session summaries', async () => {
  const fetchMock = mockApi({
    '/api/therapist/patients': { patients: [{ id: 'alex', name: 'Alex M.', program: 'GRASP L2 · left · wk 6', open_flags: 2, adherence_pct: 86, nhpt_last_s: 41.2, nhpt_first_s: 68 }, { id: 'priya', name: 'Priya S.', program: 'GRASP L3 · right · wk 3', open_flags: 0, adherence_pct: 92, nhpt_last_s: null, nhpt_first_s: null, illustrative: true }] },
    '/api/flags': { flags: [{ id: 1, session_id: 's1', rule: 'pain', detail: 'pain 5/10 during Arm to the front', t: 380, date: '2026-09-08', reviewed: false }, { id: 2, session_id: 's2', rule: 'lean', detail: 'trunk lean in 2 of 16 lifts', t: 610, date: '2026-09-12', reviewed: false }] },
    '/api/prescription': PRESCRIPTION,
    '/api/sessions': { sessions: [SESSION] },
    '/api/flags/1/reviewed': { ok: true },
  })
  render(<MemoryRouter><Therapist /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Alex M.' })).toBeInTheDocument()
  expect(screen.getByText('Clinician view')).toBeInTheDocument()
  expect(screen.getByText(/Open flags/)).toBeInTheDocument()
  expect(screen.getByText(/pain 5\/10 during Arm to the front/)).toBeInTheDocument()
  expect(screen.getByText(/Prescription \(v3\)/)).toBeInTheDocument()
  expect(screen.getByText(/Stop rules: pain ≥5/)).toBeInTheDocument()
  expect(screen.getByText('86%')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Open trace' }).length).toBeGreaterThan(0)
  fireEvent.click(screen.getAllByRole('button', { name: 'Mark reviewed' })[0])
  expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/flags/1/reviewed'))).toBe(true)
})

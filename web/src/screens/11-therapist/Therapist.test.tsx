import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PRESCRIPTION, SESSION, mockApi } from '../../test/api-mock'
import { Therapist } from './Therapist'

const ROUTES = {
  '/api/therapist/patients': { patients: [{ id: 'alex', name: 'Alex M.', program: 'GRASP L2 · left · wk 6', open_flags: 2, adherence_pct: 86, nhpt_last_s: 41.2, nhpt_first_s: 68 }, { id: 'priya', name: 'Priya S.', program: 'GRASP L3 · right · wk 3', open_flags: 0, adherence_pct: 92, nhpt_last_s: null, nhpt_first_s: null, illustrative: true }] },
  '/api/flags': { flags: [{ id: 1, session_id: 's1', rule: 'pain', detail: 'pain 5/10 during Arm to the front', t: 380, date: '2026-09-08', reviewed: false }, { id: 2, session_id: 's2', rule: 'lean', detail: 'trunk lean in 2 of 16 lifts', t: 610, date: '2026-09-12', reviewed: false }] },
  '/api/prescription': PRESCRIPTION,
  '/api/sessions': { sessions: [SESSION] },
  '/api/flags/1/reviewed': { ok: true },
  '/api/trace': { session: 'abc', rows: [] },
}

test('therapist dashboard has a clinician header, lists patients, open flags, prescription and session summaries', async () => {
  const fetchMock = mockApi(ROUTES)
  render(<MemoryRouter><Therapist /></MemoryRouter>)
  expect(screen.getByText(/Loading patients/)).toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: 'Alex M.' })).toBeInTheDocument()
  const header = screen.getByRole('banner')
  expect(within(header).getByText('Clinician view')).toBeInTheDocument()
  expect(within(header).getByText(/Dr. Anita Rao/)).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Exercises' })).not.toBeInTheDocument()
  expect(screen.getByText(/Open flags/)).toBeInTheDocument()
  expect(screen.getByText(/pain 5\/10 during Arm to the front/)).toBeInTheDocument()
  expect(screen.getByText(/Prescription \(v3\)/)).toBeInTheDocument()
  expect(screen.getByText(/Stop rules: pain ≥5/)).toBeInTheDocument()
  expect(screen.getByText('86')).toBeInTheDocument()
  expect(screen.getByText('Sample')).toBeInTheDocument()
  expect(screen.queryByText(/illustrative/)).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Open trace' }).length).toBeGreaterThan(0)
  fireEvent.click(screen.getAllByRole('button', { name: 'Mark reviewed' })[0])
  expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/flags/1/reviewed'))).toBe(true)
})

test('search filters the patient list and selecting a patient changes the header', async () => {
  mockApi(ROUTES)
  render(<MemoryRouter><Therapist /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Alex M.' })
  fireEvent.change(screen.getByLabelText('Search patients'), { target: { value: 'pri' } })
  expect(screen.queryByRole('button', { name: /Alex M\./ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Priya S\./ }))
  expect(screen.getByRole('heading', { name: 'Priya S.' })).toBeInTheDocument()
})

test('edit prescription and review flags scroll to their sections; the trace panel has no disk paths', async () => {
  mockApi(ROUTES)
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  render(<MemoryRouter><Therapist /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Alex M.' })
  fireEvent.click(screen.getByRole('button', { name: 'Edit prescription' }))
  fireEvent.click(screen.getByRole('button', { name: 'Review flags' }))
  expect(scroll).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getAllByRole('button', { name: 'Open trace' })[0])
  expect(await screen.findByText(/Decision trace/)).toBeInTheDocument()
  expect(screen.queryByText(/jsonl/)).not.toBeInTheDocument()
  expect(screen.getByText(/No trace rows for this session/)).toBeInTheDocument()
})

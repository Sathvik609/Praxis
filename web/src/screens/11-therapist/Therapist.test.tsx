import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PRESCRIPTION, SESSION, mockApi } from '../../test/api-mock'
import { Therapist } from './Therapist'

const ROUTES = {
  '/api/therapist/patients': { patients: [{ id: 'alex', name: 'Alex M.', program: 'GRASP L2 · left · wk 6', open_flags: 2, adherence_pct: 86, nhpt_last_s: 41.2, nhpt_first_s: 68 }, { id: 'priya', name: 'Priya S.', program: 'GRASP L3 · right · wk 3', open_flags: 0, adherence_pct: 92, nhpt_last_s: null, nhpt_first_s: null, illustrative: true }] },
  '/api/flags': { flags: [{ id: 1, session_id: 's1', rule: 'pain', detail: 'pain 7/10 reported (stop level 7)', t: 380, date: '2026-09-08', reviewed: false }, { id: 2, session_id: 's2', rule: 'lean', detail: 'trunk lean in 2 of 16 lifts', t: 610, date: '2026-09-12', reviewed: false }] },
  '/api/prescription/schedule': { ...PRESCRIPTION, version: 4, schedule: { ...PRESCRIPTION.schedule, practice_days: [0, 2, 4], nhpt_day: 5 } },
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
  expect(within(header).getByText('Therapist view')).toBeInTheDocument()
  expect(within(header).queryByText(/Dr\./)).not.toBeInTheDocument()
  expect(within(header).getByRole('link', { name: 'Back to patient app' })).toHaveAttribute('href', '/details')
  expect(screen.queryByRole('link', { name: 'Exercises' })).not.toBeInTheDocument()
  expect(screen.getByText(/Open flags/)).toBeInTheDocument()
  expect(screen.getByText(/Session ended by stop rule: pain 7\/10 reported \(stop level 7\)/)).toBeInTheDocument()
  expect(screen.getByText(/Prescription \(v3\)/)).toBeInTheDocument()
  // 28 Sep: the prescription card lists the three visible exercises only
  const rx = screen.getByRole('region', { name: 'Prescription' })
  for (const name of ['Arm out to the side', 'Waiter – cup', 'Nine-Hole Peg Test']) expect(rx).toHaveTextContent(name)
  expect(rx.textContent).not.toMatch(/Pendulum|Arm to the front|Rotate (in|out)|swings/)
  expect(screen.getByText(/Stop rules: pain ≥7/)).toBeInTheDocument()
  // v2: chips name the exercise kind; the gentle tier stays at the 60° the service enforces
  for (const chip of ['Arm strengthening', 'Coordination', 'Assessment']) expect(within(rx).getByText(chip)).toHaveClass('ui-chip')
  expect(rx).toHaveTextContent(/4–6 gentle \(side lift 2×6 hold 2 s ≤60°/)
  expect(rx.textContent).not.toMatch(/≤90°, no fast/)
  expect(header).toHaveClass('th-head')
  expect(document.querySelector('.th-grid')).not.toBeNull()
  expect(screen.getByText('86')).toBeInTheDocument()
  expect(screen.getAllByText('Sample').length).toBeGreaterThan(0)
  expect(screen.queryByText(/illustrative/)).not.toBeInTheDocument()
  // pain summary comes from the stored sessions, not a hard-coded sentence
  expect(screen.queryByText(/one spike to 5 on 8 Sep/)).not.toBeInTheDocument()
  expect(await screen.findByText(/Pain before → after · 09-12: 2 → 2/)).toBeInTheDocument()
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

test('review flags scrolls to its section; the trace panel has no disk paths', async () => {
  mockApi(ROUTES)
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  render(<MemoryRouter><Therapist /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Alex M.' })
  expect(screen.queryByRole('button', { name: 'Edit prescription' })).not.toBeInTheDocument() // the dead affordance is gone (28 Sep)
  fireEvent.click(screen.getByRole('button', { name: 'Review flags' }))
  expect(scroll).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getAllByRole('button', { name: 'Open trace' })[0])
  expect(await screen.findByText(/Decision trace/)).toBeInTheDocument()
  expect(screen.queryByText(/jsonl/)).not.toBeInTheDocument()
  expect(screen.getByText(/No trace rows for this session/)).toBeInTheDocument()
})

test('10 Oct: the empty trace line names the coach by the service\'s agent mode, never a stale "pending"', async () => {
  mockApi({ ...ROUTES, '/health': { status: 'ok', agent: { mode: 'scripted', model: 'scripted', mcp: true, ready: true } } })
  Element.prototype.scrollIntoView = vi.fn()
  render(<MemoryRouter><Therapist /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Alex M.' })
  fireEvent.click(screen.getAllByRole('button', { name: 'Open trace' })[0])
  expect(await screen.findByText(/No trace rows for this session in the running service\. Rule-based coach\.$/)).toBeInTheDocument()
  expect(screen.queryByText(/LLM agent pending/)).toBeNull()
})

test('a replayed session is badged Replay in the summaries and left out of the pain line (same rule as Progress)', async () => {
  const replay = { ...SESSION, id: 'rp', source: 'replay', replay: true, date: '2026-09-23', title: 'Waiter – cup', checkin: { pain_before: 9 }, feedback: { pain_after: 9 } }
  mockApi({ ...ROUTES, '/api/sessions': { sessions: [replay, { ...SESSION, source: 'live' }] } })
  render(<MemoryRouter><Therapist /></MemoryRouter>)
  const line = await screen.findByText(/Pain before → after/)
  expect(line).not.toHaveTextContent('09-23')
  const [replayRow, liveRow] = screen.getAllByRole('button', { name: 'Open trace' }).map((b) => b.closest('li')!)
  expect(within(replayRow).getByText('Replay')).toBeInTheDocument()
  expect(within(liveRow).queryByText('Replay')).not.toBeInTheDocument()
})

test('NHPT first and last from the sample are labeled sample; one verified is singular', async () => {
  const pts = { patients: [{ id: 'alex', name: 'Alex M.', program: 'GRASP L2 · left · wk 6', open_flags: 1, adherence_pct: null, nhpt_last_s: 41.2, nhpt_first_s: 68, nhpt_sample: true }] }
  const one = { ...SESSION, summary: { ...SESSION.summary, camera: { ...SESSION.summary.camera, verified: 1, unverified: 1 } } }
  mockApi({ ...ROUTES, '/api/therapist/patients': pts, '/api/sessions': { sessions: [one] } })
  render(<MemoryRouter><Therapist /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Alex M.' })
  expect(screen.getByText(/NHPT · 68 s at wk 1 · sample/)).toBeInTheDocument()
  expect(await screen.findByText(/^1 verified · 1 unverified/)).toBeInTheDocument()
})

test('sample sessions in the pain summary are labeled Sample', async () => {
  mockApi({ ...ROUTES, '/api/sessions': { sessions: [{ ...SESSION, illustrative: true }] } })
  render(<MemoryRouter><Therapist /></MemoryRouter>)
  const line = await screen.findByText(/Pain before → after/)
  expect(line.closest('div')).toHaveTextContent('Sample')
})

// ---- 28 Sep · Edit practice days (screen 12's schedule lives in the prescription) -----------

async function openSchedule() {
  const fetchMock = mockApi(ROUTES)
  render(<MemoryRouter><Therapist /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Alex M.' })
  const rx = screen.getByRole('region', { name: 'Prescription' })
  expect(rx).toHaveTextContent('Practice days · Mon–Fri · peg test Sun')
  expect(rx).toHaveTextContent('Next visit · Thu 1 Oct, 2:30 PM · Dr. Anita Rao, OT')
  fireEvent.click(screen.getByRole('button', { name: 'Edit practice days' }))
  return { fetchMock, dialog: await screen.findByRole('dialog', { name: 'Edit practice days' }) }
}

test('the dialog opens on the current schedule', async () => {
  const { dialog } = await openSchedule()
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) expect(within(dialog).getByRole('button', { name: d })).toHaveAttribute('aria-pressed', 'true')
  for (const d of ['Sat', 'Sun']) expect(within(dialog).getByRole('button', { name: d })).toHaveAttribute('aria-pressed', 'false')
  expect(within(dialog).getByRole('radio', { name: 'Sun' })).toHaveAttribute('aria-checked', 'true')
  expect(within(dialog).getByLabelText('Visit date')).toHaveValue('2026-10-01')
  expect(within(dialog).getByLabelText('Visit time')).toHaveValue('14:30')
  expect(within(dialog).getByLabelText('With')).toHaveValue('Dr. Anita Rao, OT')
  expect(within(dialog).getByText('5 practice days a week')).toBeInTheDocument()
  for (const b of within(dialog).getAllByRole('button')) expect(b.className).toMatch(/min-h-1[24]|h-14/)
})

test('saving sends the new schedule and shows the new version', async () => {
  const { fetchMock, dialog } = await openSchedule()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Tue' }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Thu' }))
  fireEvent.click(within(dialog).getByRole('radio', { name: 'Sat' }))
  fireEvent.change(within(dialog).getByLabelText('Visit date'), { target: { value: '2026-10-09' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save as v4' }))
  expect(await screen.findByText('Saved as prescription v4 · practice days Mon, Wed, Fri.')).toBeInTheDocument()
  const put = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/prescription/schedule'))!
  expect(put[1]?.method).toBe('PUT')
  expect(JSON.parse(String(put[1]?.body))).toEqual({ practice_days: [0, 2, 4], nhpt_day: 5, next_visit: { at: '2026-10-09T14:30', with: 'Dr. Anita Rao, OT' } })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('no practice day, or a booked visit without a date, cannot be saved', async () => {
  const { dialog } = await openSchedule()
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) fireEvent.click(within(dialog).getByRole('button', { name: d }))
  expect(within(dialog).getByText('Choose at least one practice day.')).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'Save as v4' })).toBeDisabled()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Wed' }))
  fireEvent.change(within(dialog).getByLabelText('Visit date'), { target: { value: '' } })
  expect(within(dialog).getByRole('button', { name: 'Save as v4' })).toBeDisabled()
  fireEvent.click(within(dialog).getByLabelText('A clinic visit is booked'))
  expect(within(dialog).queryByLabelText('Visit date')).not.toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'Save as v4' })).toBeEnabled()
})

// ---- 21 Oct · therapist writes need the therapist token (service auth.py) ------------------

function refuseTherapistWrites() {
  const ok = mockApi(ROUTES)
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/prescription/schedule') || url.includes('/reviewed')) {
      return { ok: false, status: 403, json: async () => ({ detail: { error: 'therapist_only' } }) } as Response
    }
    return ok(input, init)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

test('a refused schedule save says therapist only and that nothing changed; the dialog stays open', async () => {
  const { dialog } = await openSchedule()
  refuseTherapistWrites()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Tue' }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save as v4' }))
  const alert = await within(dialog).findByRole('alert')
  expect(alert).toHaveTextContent('Therapist only')
  expect(alert).toHaveTextContent('Nothing was changed')
  expect(screen.getByRole('dialog', { name: 'Edit practice days' })).toBeInTheDocument()
})

test('a refused Mark reviewed says therapist only and keeps the flag open', async () => {
  refuseTherapistWrites()
  render(<MemoryRouter><Therapist /></MemoryRouter>)
  const flags = await screen.findByRole('region', { name: 'Open flags' })
  fireEvent.click((await within(flags).findAllByRole('button', { name: 'Mark reviewed' }))[0])
  expect(await within(flags).findByRole('status')).toHaveTextContent('Therapist only')
  expect(within(flags).getAllByRole('button', { name: 'Mark reviewed' })).toHaveLength(2)
})

test('a therapist token kept in this browser is sent with therapist writes only', async () => {
  localStorage.setItem('praxis.therapistToken', 'tok-1')
  try {
    const { fetchMock, dialog } = await openSchedule()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as v4' }))
    await screen.findByText(/Saved as prescription v4/)
    const put = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/prescription/schedule'))!
    expect(new Headers(put[1]?.headers).get('X-Praxis-Therapist-Token')).toBe('tok-1')
    const read = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/flags') && !String(c[0]).includes('reviewed'))!
    expect(new Headers(read[1]?.headers).get('X-Praxis-Therapist-Token')).toBeNull()
  } finally {
    localStorage.removeItem('praxis.therapistToken')
  }
})

test('cancel changes nothing', async () => {
  const { fetchMock, dialog } = await openSchedule()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Tue' }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/prescription/schedule'))).toBe(false)
})

test('a sample next visit (the seed, served relative to today) says Sample beside it', async () => {
  mockApi({ ...ROUTES, '/api/prescription': { ...PRESCRIPTION, schedule: { ...PRESCRIPTION.schedule, next_visit: { at: '2099-01-05T14:30', with: 'Dr. Anita Rao, OT', sample: true } } } })
  render(<MemoryRouter><Therapist /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Alex M.' })
  const rx = screen.getByRole('region', { name: 'Prescription' })
  await within(rx).findByText(/Next visit · Mon 5 Jan, 2:30 PM · Dr. Anita Rao, OT/)
  expect(within(rx).getByText('Sample')).toBeInTheDocument()
  expect(screen.getByText(/next visit Mon 5 Jan, 2:30 PM \(sample\)/)).toBeInTheDocument()
})

test('a booked next visit carries no Sample label', async () => {
  mockApi({ ...ROUTES, '/api/prescription': { ...PRESCRIPTION, schedule: { ...PRESCRIPTION.schedule, next_visit: { at: '2099-01-05T14:30', with: 'Dr. Anita Rao, OT' } } } })
  render(<MemoryRouter><Therapist /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Alex M.' })
  const rx = screen.getByRole('region', { name: 'Prescription' })
  await within(rx).findByText(/Next visit · Mon 5 Jan, 2:30 PM/)
  expect(within(rx).queryByText('Sample')).not.toBeInTheDocument()
})

import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ME, SESSION, mockApi } from '../../test/api-mock'
import { SessionReport } from './SessionReport'

function renderReport() {
  return render(
    <MemoryRouter initialEntries={['/report/abc']}>
      <Routes>
        <Route path="/report/:id" element={<SessionReport />} />
        <Route path="/details" element={<div>HOME</div>} />
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

test('a replayed session is badged Replay and one verified movement is singular (review 28 Sep)', async () => {
  const one = { ...SESSION, source: 'replay', replay: true, summary: { ...SESSION.summary, camera: { ...SESSION.summary.camera, verified: 1, posture_cues: 1 } } }
  mockApi({ '/api/sessions/abc': one, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByText('verified movement')).toBeInTheDocument()
  expect(screen.getByText('posture cue')).toBeInTheDocument()
  expect(screen.getByText('Replay')).toBeInTheDocument()
  expect(screen.getByText(/recorded clip, not counted in your progress/)).toBeInTheDocument()
})

test('a live session carries no Replay badge', async () => {
  mockApi({ '/api/sessions/abc': { ...SESSION, source: 'live', replay: false }, '/api/patients/me': ME })
  renderReport()
  await screen.findByText('verified movements')
  expect(screen.queryByText('Replay')).not.toBeInTheDocument()
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
  expect(dialog).toHaveTextContent(/Video is processed on this device, never stored/)
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  click.mockRestore()
})

test('latency percentiles from the summary are shown under the camera measurements', async () => {
  const latency = { capture_to_event_p50: 48.4, capture_to_event_p95: 91, proc_p50: 20, proc_p95: 30, event_to_cue_p50: 2.2, event_to_cue_p95: 5.6, frames: 120, dropped: 3, cues: 9 }
  mockApi({ '/api/sessions/abc': { ...SESSION, summary: { ...SESSION.summary, latency } }, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByText('Latency p50 / p95 · capture→event 48 / 91 ms · event→cue 2 / 6 ms · 120 frames, 3 dropped')).toBeInTheDocument()
})

test('a replay session without capture times shows processing time instead', async () => {
  const latency = { capture_to_event_p50: null, capture_to_event_p95: null, proc_p50: 20, proc_p95: 30, event_to_cue_p50: null, event_to_cue_p95: null, frames: 40, dropped: 0, cues: 0 }
  mockApi({ '/api/sessions/abc': { ...SESSION, summary: { ...SESSION.summary, latency } }, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByText(/processing 20 \/ 30 ms · event→cue — · 40 frames, 0 dropped/)).toBeInTheDocument()
})

test('no latency line for a record that carries none (seeded history)', async () => {
  mockApi({ '/api/sessions/abc': SESSION, '/api/patients/me': ME })
  renderReport()
  await screen.findByRole('heading', { name: 'What the camera measured' })
  expect(screen.queryByText(/Latency p50/)).not.toBeInTheDocument()
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

const ARM = (exercise: string, extra: Record<string, unknown> = {}) => ({
  ...SESSION, mode: 'arm', exercise, title: 'arm session',
  summary: { ...SESSION.summary, mode: 'arm', exercise, ...extra, camera: { reps_total: 3, verified: 3, unverified: 0, peak_deg: [88, 90, 89], peak_verified: [true, true, true] } },
})

test('peak-angle chart is named after the exercise the session ran, never always "Arm to the front"', async () => {
  mockApi({ '/api/sessions/abc': ARM('abduction'), '/api/patients/me': ME })
  renderReport()
  const chart = await screen.findByRole('img', { name: /peak angle per lift/ })
  expect(chart.getAttribute('aria-label')).toMatch(/^Arm out to the side · peak angle per lift/)
  expect(screen.getByText(/dashed = target 90/)).toBeInTheDocument()
})

test('the service exercise name and target are used when the summary carries them', async () => {
  mockApi({ '/api/sessions/abc': ARM('abduction', { exercise_id: 'abduction', exercise_name: 'Arm out to the side', target_deg: 60, ceiling_deg: 90 }), '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByRole('img', { name: /^Arm out to the side · peak angle per lift/ })).toBeInTheDocument()
  expect(screen.getByText(/dashed = target 60/)).toBeInTheDocument()
})

test.each(['pendulum', 'flexion'])('a stored session of hidden %s is never shown, even from a direct link', async (id) => {
  mockApi({ '/api/sessions/abc': { ...ARM(id, { exercise_name: id === 'pendulum' ? 'Pendulum' : 'Arm to the front' }), title: 'hidden' }, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByText(/Could not load this report/)).toBeInTheDocument()
  expect(screen.getByText(/not part of your program/)).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/Pendulum|Arm to the front/)
})

test('a bare arm session (no exercise id) is reported as Arm out to the side', async () => {
  mockApi({ '/api/sessions/abc': { ...ARM('abduction'), exercise: undefined, summary: { ...ARM('abduction').summary, exercise: undefined } }, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByRole('img', { name: /^Arm out to the side · peak angle per lift/ })).toBeInTheDocument()
})

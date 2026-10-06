import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ME, SESSION } from '../../test/api-mock'
import { SessionReport } from './SessionReport'

// The overlay itself is screen 08 (Task 18); this file checks only the report's wiring of
// "Edit feedback" to PATCH /api/sessions/{id}/feedback (ruling R4).
vi.mock('../08-feedback/FeedbackOverlay', () => ({
  FeedbackOverlay: ({ open, onSave, onSkip }: { open: boolean; onSave: (f: Record<string, unknown>) => void; onSkip: () => void }) =>
    open ? (
      <div role="dialog" aria-label="Feedback">
        <button onClick={() => onSave({ pain_after: 7, difficulty: 'hard', effort: 7, again_tomorrow: 'not_sure' })}>Save stub</button>
        <button onClick={onSkip}>Skip stub</button>
      </div>
    ) : null,
}))

const PATCHED = {
  ...SESSION,
  feedback: { pain_after: 7, effort: 7, difficulty: 'hard', again_tomorrow: 'not_sure', compared: 'same' },
  summary: { ...SESSION.summary, flags: [{ t: 1, rule: 'pain_after', detail: 'pain 7 after the session (stop level 7)' }] },
}

function mockFetch(patch: { ok: boolean; body: unknown }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'PATCH') return { ok: patch.ok, status: patch.ok ? 200 : 500, json: async () => patch.body } as Response
    if (url.includes('/api/sessions/abc')) return { ok: true, status: 200, json: async () => SESSION } as Response
    if (url.includes('/api/patients/me')) return { ok: true, status: 200, json: async () => ME } as Response
    return { ok: false, status: 404, json: async () => ({ error: 'unmocked' }) } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderReport() {
  return render(
    <MemoryRouter initialEntries={['/report/abc']}>
      <Routes>
        <Route path="/report/:id" element={<SessionReport />} />
      </Routes>
    </MemoryRouter>,
  )
}

test('Edit feedback PATCHes the session and the page shows what the service returned', async () => {
  const fetchMock = mockFetch({ ok: true, body: PATCHED })
  renderReport()
  fireEvent.click(await screen.findByRole('button', { name: 'Edit feedback' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save stub' }))
  await waitFor(() => expect(screen.getByText('2 → 7')).toBeInTheDocument())
  const call = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')!
  expect(String(call[0])).toMatch(/\/api\/sessions\/abc\/feedback$/)
  expect(JSON.parse(String(call[1]!.body))).toEqual({ pain_after: 7, difficulty: 'hard', effort: 7, again_tomorrow: 'not_sure' })
  expect(screen.getByText('Hard. Again tomorrow: Not sure.')).toBeInTheDocument()
  // the service's pain_after flag appears with the other therapist flags
  expect(screen.getByText(/pain_after: pain 7 after the session/)).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('a failed save keeps what was stored and says so', async () => {
  mockFetch({ ok: false, body: {} })
  renderReport()
  fireEvent.click(await screen.findByRole('button', { name: 'Edit feedback' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save stub' }))
  expect(await screen.findByText(/couldn't save your changes/i)).toBeInTheDocument()
  expect(screen.getByText('2 → 2')).toBeInTheDocument()
})

test('skipping the edit changes nothing and sends nothing', async () => {
  const fetchMock = mockFetch({ ok: true, body: PATCHED })
  renderReport()
  fireEvent.click(await screen.findByRole('button', { name: 'Edit feedback' }))
  fireEvent.click(screen.getByRole('button', { name: 'Skip stub' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(false)
})

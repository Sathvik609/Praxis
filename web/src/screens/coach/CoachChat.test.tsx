import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { exerciseById } from '../../lib/seed'
import { ME, PRESCRIPTION, mockApi } from '../../test/api-mock'
import { CoachChat } from './CoachChat'

const item = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, dose: `${name} dose`, sets: 2, reps: 8, hold_s: 3, target_deg: 90, ceiling_deg: 90, tier: 'full', steps: [], ...extra })
const PLAN = {
  pain: 0, tier: 'full', reason: 'Pain 0 today: the full day at your prescribed dose.', minutes: 10,
  items: [item('abduction', 'Arm out to the side', { order: 1, dose: '2 × 8 · hold 3 s' }), item('cup', 'Waiter – cup', { order: 2, sets: 1, reps: 4, dose: '2 slow arcs, then 2 fast' })],
  weekly: [item('nhpt', 'Nine-Hole Peg Test', { sets: 1, reps: 9 })], demo: [], rest_advice: null, therapist_flag: false,
}
const CALENDAR = {
  from: '2026-10-05', to: '2026-10-11', today: '2026-10-06',
  days: [{ date: '2026-10-06', weekday: 1, is_today: true, status: 'today', planned: true, nhpt_due: false, minutes: 10, minutes_done: 0, exercises: [], sessions: [], sample: false, clinic_visit: null }],
  week: { from: '2026-10-05', to: '2026-10-11', done_days: 0, planned_days: 5, minutes_done: 0, minutes_planned: 50, nhpt_done: false },
  schedule: PRESCRIPTION.schedule, next_visit: null, tracking_since: null,
}
const ROUTES = { '/api/plan': PLAN, '/api/calendar': CALENDAR, '/api/prescription': PRESCRIPTION, '/api/sessions': { sessions: [] }, '/api/patients/me': ME }

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

async function renderChat(onBegin = vi.fn(), onOpenChange = vi.fn(), extra: Record<string, unknown> = {}) {
  const fetchMock = mockApi({ ...ROUTES, ...extra })
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<CoachChat open onOpenChange={onOpenChange} side="left" onBegin={onBegin} />} />
        <Route path="/details/checkin" element={<div>CHECKIN</div>} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByRole('button', { name: 'Begin setup' })
  return { onBegin, onOpenChange, fetchMock }
}

test('shows the rule-based coach label and suggests the next exercise from the real plan', async () => {
  const { fetchMock } = await renderChat()
  expect(screen.getAllByText('Rule-based coach · LLM agent pending').length).toBeGreaterThan(0)
  expect(screen.getByRole('dialog', { name: 'Praxis coach' })).toBeInTheDocument()
  expect(screen.getByText(/Arm out to the side is next in today's plan/)).toBeInTheDocument()
  expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/plan?pain=0'))).toBe(true)
  // Clinician comes from the data, never hard-coded; no fake minutes or invented history.
  expect(document.body.textContent).not.toMatch(/Dr\. Rao|41\.2|−18%|~\d+ min/)
})

test('10 Oct: with the Claude agent on, the chat is labelled "Rule-based coach" — never "pending", never Claude', async () => {
  await renderChat(vi.fn(), vi.fn(), { '/health': { status: 'ok', agent: { mode: 'anthropic', model: 'claude-sonnet-5', mcp: true, ready: true } } })
  expect(await screen.findAllByText('Rule-based coach')).not.toHaveLength(0)
  expect(screen.queryByText(/LLM agent pending/)).toBeNull()
  expect(within(screen.getByRole('log')).queryByText(/Claude/)).toBeNull()
})

test('with the agent off the chat keeps "Rule-based coach · LLM agent pending"', async () => {
  await renderChat(vi.fn(), vi.fn(), { '/health': { status: 'ok', agent: { mode: 'off', model: null, mcp: false, ready: false } } })
  expect(screen.getAllByText('Rule-based coach · LLM agent pending').length).toBeGreaterThan(0)
})

test('"Something hurts" goes to the check-in and never promises a flag', async () => {
  await renderChat()
  fireEvent.click(screen.getByRole('button', { name: 'Something hurts' }))
  expect(await screen.findByText('CHECKIN')).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/I'll flag it/)
})

test('free text with a pain word also routes to the check-in', async () => {
  await renderChat()
  fireEvent.change(screen.getByRole('textbox', { name: 'Message the coach' }), { target: { value: 'my shoulder is sore' } })
  fireEvent.submit(screen.getByRole('textbox', { name: 'Message the coach' }).closest('form')!)
  expect(await screen.findByText('CHECKIN')).toBeInTheDocument()
})

test('"Explain this exercise" answers with the exercise steps', async () => {
  await renderChat()
  fireEvent.click(screen.getByRole('button', { name: 'Explain this exercise' }))
  const steps = exerciseById('abduction')!.steps
  expect(await screen.findByText(new RegExp(steps[1]))).toBeInTheDocument()
})

test('anything outside the routes gets the scope answer', async () => {
  await renderChat()
  const box = screen.getByRole('textbox', { name: 'Message the coach' })
  fireEvent.change(box, { target: { value: 'Can I go to level 3?' } })
  fireEvent.submit(box.closest('form')!)
  expect(await screen.findByText("I can only suggest from your assigned exercises and today's check-in.")).toBeInTheDocument()
})

test('"Suggest more" moves to the next exercise; "Begin setup" calls onBegin with its id', async () => {
  const { onBegin } = await renderChat()
  fireEvent.click(screen.getByRole('button', { name: 'Suggest more' }))
  const cards = await screen.findAllByRole('button', { name: 'Begin setup' })
  expect(cards).toHaveLength(2)
  expect(screen.getByText(/Waiter – cup is also in today's plan/)).toBeInTheDocument()
  fireEvent.click(cards[1])
  expect(onBegin).toHaveBeenCalledWith('cup')
})

test('no push to talk: no mic button, the input takes typed text', async () => {
  await renderChat()
  expect(screen.queryByRole('button', { name: /talk|listening/i })).toBeNull()
  expect(screen.getByRole('textbox', { name: 'Message the coach' })).toHaveAttribute('placeholder', 'Type a message…')
})

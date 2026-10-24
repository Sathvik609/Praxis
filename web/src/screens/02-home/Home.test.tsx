import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ME, PRESCRIPTION, SESSION, mockApi } from '../../test/api-mock'

vi.mock('../../avatar/AvatarScene', () => ({ AvatarScene: () => <div data-testid="scene" /> }))

import { Home } from './Home'

/** Renders Home and lets its five API reads settle, so no state update lands after a test. */
async function renderHome() {
  const view = render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/details/choose" element={<div>CHOOSE</div>} />
        <Route path="/details/demo" element={<div>DEMO</div>} />
        <Route path="/session" element={<div>SESSION</div>} />
        <Route path="/details/progress" element={<div>PROGRESS</div>} />
        <Route path="/report/:id" element={<div>REPORT</div>} />
      </Routes>
    </MemoryRouter>,
  )
  await act(() => new Promise((r) => setTimeout(r, 0)))
  return view
}

const day = (date: string, weekday: number, status: string, sample = false) => ({ date, weekday, is_today: status === 'today', status, planned: weekday < 5, nhpt_due: weekday === 6, minutes: 10, minutes_done: status === 'done' ? 11 : 0, exercises: [], sessions: [], sample, clinic_visit: null })
const WEEK_DAYS = [day('2026-10-05', 0, 'done'), day('2026-10-06', 1, 'today'), day('2026-10-07', 2, 'planned'), day('2026-10-08', 3, 'planned'), day('2026-10-09', 4, 'planned'), day('2026-10-10', 5, 'rest'), day('2026-10-11', 6, 'planned')]
const CALENDAR = {
  from: '2026-09-28', to: '2026-10-11', today: '2026-10-06',
  days: [day('2026-10-02', 4, 'missed'), ...WEEK_DAYS],
  week: { from: '2026-10-05', to: '2026-10-11', done_days: 1, planned_days: 5, minutes_done: 11, minutes_planned: 50, nhpt_done: false },
  schedule: PRESCRIPTION.schedule, next_visit: null, tracking_since: '2026-10-05',
}
const PROGRESS = { nhpt_trend: [], verified_per_session: [], practice: { done: 0, planned: null, hours: 0 }, adherence_pct: null, sample: { done: 0, planned: 0, hours: 0, illustrative: true }, pain_effort: [], goal_log_count: 0 }
const ARM = { ...SESSION, id: 'arm1', mode: 'arm', exercise: 'abduction', date: '2026-10-05', started_at: '2026-10-05T09:00:00', title: 'Arm out to the side', source: 'live', summary: { ...SESSION.summary, mode: 'arm', camera: { reps_total: 8, verified: 7, unverified: 1, posture_cues: 1, peak_deg: [84, 88, 92], peak_verified: [true, true, false] } } }

function routes(over: Record<string, unknown> = {}) {
  return { '/api/calendar': CALENDAR, '/api/progress': PROGRESS, '/api/prescription': PRESCRIPTION, '/api/patients/me': ME, ...over }
}

beforeEach(() => {
  localStorage.clear()
  mockApi(routes())
})

test('home shows next practice, the week from the calendar and the affected areas', async () => {
  await renderHome()
  // the day card follows the 28 Sep day order in lib/plan.ts (the service enforces the same order)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Arm out to the side \+ Waiter – cup$/)
  expect(screen.getByText(/About 10 min/)).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/Pendulum|Arm to the front|Rotate (in|out)|Block towers|Grip power|Box and Block/)
  expect(screen.getByRole('button', { name: 'Start session' })).toBeInTheDocument()
  // Ruling R2: the artifact moved the replay entry to Settings › Demo and judging; Home has none
  expect(screen.queryByRole('button', { name: /Replay a recorded session/ })).not.toBeInTheDocument()
  expect(screen.getByText('This week')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Your affected areas' })).toBeInTheDocument()
  expect(screen.getByRole('tablist', { name: 'Affected areas' })).toBeInTheDocument()
  // design v2: the shoulder is the default focus area
  expect(screen.getByRole('tab', { name: /Left shoulder/ })).toHaveAttribute('aria-selected', 'true')
})

test('design review 21 Oct: no everyday goal, no trend line and no program list on Home', async () => {
  localStorage.setItem('praxis.goal', 'Comb my hair.')
  mockApi(routes({ '/api/sessions': { sessions: [ARM] }, '/api/progress': { ...PROGRESS, nhpt_trend: [{ date: '2026-09-20', total_s: 45, kind: 'live' }, { date: '2026-10-02', total_s: 41.2, kind: 'live' }] } }))
  await renderHome()
  for (const tab of [/Left shoulder/, /Left hand/, /Left elbow/]) {
    fireEvent.click(screen.getByRole('tab', { name: tab }))
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).queryByText(/Everyday goal/i)).not.toBeInTheDocument()
    expect(within(panel).queryByText(/In your program/)).not.toBeInTheDocument()
    expect(panel.querySelector('figure, .ad-trend, .ad-prog, .ad-steps')).toBeNull()
  }
  expect(document.body.textContent).not.toMatch(/Use a cup on my own|Comb my hair|attempts? logged/)
  expect(screen.queryByRole('img', { name: /per session|Peg Test · seconds/ })).not.toBeInTheDocument()
})

test('this week reads the calendar week: days, minutes and today; no sample chip on live history', async () => {
  await renderHome()
  expect(await screen.findByText('1 day · 11 min')).toBeInTheDocument()
  expect(screen.getByLabelText('M: done')).toHaveClass('wk-day', 'wk-done')
  expect(screen.getByLabelText('T: today')).toHaveClass('wk-today')
  expect(screen.getByLabelText('W: not yet')).toHaveClass('wk-todo')
  expect(screen.getAllByLabelText(/^[MTWFS]: /)).toHaveLength(7) // this week only, not the week before
  expect(screen.queryByText('Sample history')).not.toBeInTheDocument()
})

test('a week with sample days says Sample history', async () => {
  mockApi(routes({ '/api/calendar': { ...CALENDAR, days: [day('2026-10-05', 0, 'untracked', true), ...WEEK_DAYS.slice(1)] } }))
  await renderHome()
  expect(await screen.findByText('Sample history')).toBeInTheDocument()
})

test('the week row is seven equal columns, so it cannot overflow its card at 1280 × 800', async () => {
  await renderHome()
  const tile = await screen.findByLabelText('M: done')
  const row = tile.parentElement!.parentElement!
  expect(row.className).toMatch(/grid-cols-7/)
})

test('start session goes to Choose (design v2 flow: Choose → Demo → Check-in → Setup)', async () => {
  await renderHome()
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
  expect(screen.getByText('CHOOSE')).toBeInTheDocument()
})

test('the area card header shows the status word as text once something is measured; tabs switch the focus area', async () => {
  await renderHome()
  const shoulder = screen.getByRole('tabpanel', { name: 'Left shoulder details' })
  expect(within(shoulder).queryByText('Watch')).not.toBeInTheDocument() // nothing measured yet: no status word
  fireEvent.click(screen.getByRole('tab', { name: /Left hand/ }))
  expect(screen.getByRole('tab', { name: /Left hand/ })).toHaveAttribute('aria-selected', 'true')
  const hand = screen.getByRole('tabpanel', { name: 'Left hand details' })
  expect(within(hand).queryByText('Focus')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Run the peg test' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: /Left elbow/ }))
  const elbow = screen.getByRole('tabpanel', { name: 'Left elbow details' })
  expect(within(elbow).queryByText('Stable')).not.toBeInTheDocument()
  expect(within(elbow).getByText('The camera does not measure the elbow in this program.')).toBeInTheDocument()
})

test('once an arm session is measured the shoulder card shows its status word as text', async () => {
  mockApi(routes({ '/api/sessions': { sessions: [ARM] } }))
  await renderHome()
  const card = screen.getByRole('tabpanel', { name: 'Left shoulder details' })
  expect(await within(card).findByText('Watch')).toBeInTheDocument()
})

test('shoulder numbers come from the last live arm session: best verified peak, never an unverified one', async () => {
  mockApi(routes({ '/api/sessions': { sessions: [ARM, { ...ARM, id: 'r1', date: '2026-10-06', started_at: '2026-10-06T09:00:00', source: 'replay', replay: true, summary: { ...ARM.summary, camera: { peak_deg: [95], peak_verified: [true] } } }] } }))
  await renderHome()
  const card = screen.getByRole('tabpanel', { name: 'Left shoulder details' })
  expect(await within(card).findByText('88°')).toBeInTheDocument()
  expect(within(card).getByRole('img', { name: '88 of 90 degrees' })).toBeInTheDocument()
  expect(within(card).getByText("At today's safe limit")).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/9[25]°/)
  // verified and unverified counts, both visible
  expect(screen.getByText('1 unverified · last session')).toBeInTheDocument()
})

test('without an arm session the shoulder says when it starts, with no invented number', async () => {
  await renderHome()
  const card = screen.getByRole('tabpanel', { name: 'Left shoulder details' })
  expect(await within(card).findByText('Your best lift angle shows here after your first Arm out to the side session.')).toBeInTheDocument()
  expect(within(card).queryByRole('img')).not.toBeInTheDocument()
})

test('"Sample" is visible whenever a sample value is shown, and only then', async () => {
  mockApi(routes({ '/api/progress': { ...PROGRESS, nhpt_trend: [{ date: '2026-08-01', total_s: 68, kind: 'sample' }, { date: '2026-09-20', total_s: 45, kind: 'live' }, { date: '2026-10-02', total_s: 41.2, kind: 'live' }] } }))
  await renderHome()
  expect(screen.queryByText('Sample')).not.toBeInTheDocument() // shoulder: no sample values
  fireEvent.click(screen.getByRole('tab', { name: /Left hand/ }))
  expect(await screen.findByText('Sample')).toBeInTheDocument()
  const hand = screen.getByRole('tabpanel', { name: 'Left hand details' })
  expect(within(hand).getByText('Getting quicker')).toBeInTheDocument()
  expect(within(hand).getByText('3.8 s faster than your first test on 20 Sep')).toBeInTheDocument()
})

test('the area action under the stage navigates (the in-card program list is gone)', async () => {
  await renderHome()
  expect(screen.queryByRole('button', { name: /^Arm out to the side\s*Arm strengthening$/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Practise Arm out to the side' }))
  expect(screen.getByText('DEMO')).toBeInTheDocument()
})

test('See all progress opens progress', async () => {
  await renderHome()
  fireEvent.click(screen.getByRole('button', { name: 'See all progress' }))
  expect(screen.getByText('PROGRESS')).toBeInTheDocument()
})

test('zoom starts at 1.25× and is a camera zoom inside the stage, never a CSS scale', async () => {
  await renderHome()
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled() // 1.25 → 1.5, the last step
  fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
  fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
  expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
  expect(document.querySelector('[style*="scale("]')).toBeNull()
})

test('ask the coach opens the library coach, labelled rule-based', async () => {
  await renderHome()
  fireEvent.click(screen.getByRole('button', { name: 'Ask the coach' }))
  expect(await screen.findByRole('dialog', { name: 'Praxis coach' })).toBeInTheDocument()
  expect(screen.getAllByText('Rule-based coach · LLM agent pending').length).toBeGreaterThan(0)
})

test('open report goes to the last session report when there is one, else progress', async () => {
  mockApi(routes({ '/api/sessions': { sessions: [SESSION] } }))
  await renderHome()
  const btn = screen.getByRole('button', { name: 'Open report' })
  await screen.findByText(/Waiter – cup \+ Arm out to the side/)
  fireEvent.click(btn)
  expect(screen.getByText('REPORT')).toBeInTheDocument()
})

test('a replayed last session says replay (review 28 Sep)', async () => {
  mockApi(routes({ '/api/sessions': { sessions: [{ ...SESSION, source: 'replay', replay: true, title: 'Waiter – cup' }] } }))
  await renderHome()
  expect(await screen.findByText(/Last session · 17 verified · Waiter – cup · replay/)).toBeInTheDocument()
})

test('without sessions there is no report to open and no seeded last session is shown', async () => {
  await renderHome()
  expect(screen.getByText('No sessions yet')).toBeInTheDocument()
  expect(screen.queryByText(/Last session/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Open report' })).not.toBeInTheDocument()
})

test('the next-practice card marks where to start, how to go on, and that the rest can be explored', async () => {
  mockApi(routes())
  await renderHome()
  const start = screen.getByRole('button', { name: 'Start session' })
  const card = start.closest('section') as HTMLElement
  expect(within(card).getByText('Start here')).toBeInTheDocument() // in words, not only the highlight
  expect(start).toHaveClass('start-here')
  expect(card).toHaveTextContent(/each step tells you what to do next/i)
  expect(card).toHaveTextContent(/explore/i)
  expect(screen.queryByRole('button', { name: /Hide/ })).not.toBeInTheDocument()
})

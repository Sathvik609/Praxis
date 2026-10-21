import { act, fireEvent, render, screen } from '@testing-library/react'
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
  expect(screen.getByText('unverified (hand hid cup)')).toBeInTheDocument()
  expect(screen.getByText('High')).toBeInTheDocument()
  expect(screen.getByText('Medium')).toBeInTheDocument()
  // P0 items the artifact dropped are kept small (ruling R7)
  expect(screen.getByText(/Nothing here is combined into a score\./)).toBeInTheDocument()
  expect(screen.getByText(/^Exertion/)).toHaveTextContent(/Exertion\s*Low\s*· behavioural index/)
  // the coach section is titled with the service's own label, never "agent-generated"
  expect(screen.getByRole('heading', { name: 'Rule-based coach · LLM agent pending' })).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/agent-generated/)
  expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Back to Home' })).toBeInTheDocument()
  // per-rep values are a real chart with a text summary; unverified reps are named as such
  const chart = screen.getByRole('img', { name: /reach time/i })
  expect(chart.getAttribute('aria-label')).toMatch(/unverified/)
  // no hard-coded side when the summary carries none
  expect(screen.queryByText(/left side/)).not.toBeInTheDocument()
  // what the patient told us: difficulty / again-tomorrow, or the older "compared" answer
  expect(screen.getByText('2 → 2')).toBeInTheDocument()
  expect(screen.getByText('Felt about the same as last time.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Edit feedback' })).toBeInTheDocument()
})

// Team design review, 21 Oct: metrics first, a legend for the bars, less text, no flags or
// delivery card on the patient's report (flags stay on the therapist dashboard).
test('the key metrics are the first thing under the header', async () => {
  mockApi({ '/api/sessions/abc': SESSION, '/api/patients/me': ME })
  renderReport()
  const stats = (await screen.findByText('verified movements')).closest('.rp-stats')!
  const head = document.querySelector('.rp-head')!
  expect(head.nextElementSibling).toContainElement(stats as HTMLElement)
  expect(stats).toHaveTextContent(/11:42\s*active/)
  expect(stats).toHaveTextContent(/17\s*verified movements/)
  expect(stats).toHaveTextContent(/3\s*unverified/)
  expect(document.body.textContent).not.toMatch(/accuracy|recovery score/i)
})

test('the per-rep bars carry a legend that names verified (blue) and unverified (amber, hatched) in words', async () => {
  mockApi({ '/api/sessions/abc': SESSION, '/api/patients/me': ME })
  renderReport()
  const legend = await screen.findByRole('list', { name: 'Chart legend' })
  expect(legend).toHaveClass('rp-legend')
  const items = legend.querySelectorAll('li')
  expect(items).toHaveLength(2)
  expect(items[0]).toHaveTextContent('Verified')
  expect(items[0].querySelector('i')).not.toHaveClass('rp-bar-u')
  expect(items[1]).toHaveTextContent('Unverified')
  expect(items[1].querySelector('i')).toHaveClass('rp-bar-u')
  // the old inline "amber = unverified" captions are replaced by the legend
  expect(document.body.textContent).not.toMatch(/amber = unverified/)
})

test('no legend when no per-rep bars are drawn', async () => {
  const camera = { reps_total: 9, verified: 9, unverified: 0, active_s: 38, nhpt_total_s: 24.2, splits_s: [1.4, 2.5] }
  mockApi({ '/api/sessions/abc': { ...SESSION, mode: 'nhpt', summary: { ...SESSION.summary, mode: 'nhpt', camera } }, '/api/patients/me': ME })
  renderReport()
  await screen.findByText(/Nine-Hole Peg Test:/)
  expect(screen.queryByRole('list', { name: 'Chart legend' })).toBeNull()
})

test('the patient report shows no therapist-flags card and no delivery card', async () => {
  const flags = [{ t: 1, rule: 'pain_after', detail: 'pain 7 after the session (stop level 7)' }]
  mockApi({ '/api/sessions/abc': { ...SESSION, summary: { ...SESSION.summary, flags } }, '/api/patients/me': ME })
  renderReport()
  await screen.findByRole('heading', { name: 'What the camera measured' })
  expect(screen.queryByText(/Therapist flags/)).toBeNull()
  expect(screen.queryByText(/pain_after/)).toBeNull()
  expect(screen.queryByText(/Report to/)).toBeNull()
  expect(screen.queryByText(/not yet delivered/i)).toBeNull()
  // the delivery status is still one tap away, in Sharing
  fireEvent.click(screen.getByRole('button', { name: 'Sharing' }))
  expect(screen.getByRole('dialog', { name: /Who sees this report/ })).toHaveTextContent(/not yet delivered/i)
})

test('explanatory copy is trimmed; honesty labels stay', async () => {
  mockApi({ '/api/sessions/abc': { ...SESSION, status: 'ended_early', source: 'replay', replay: true }, '/api/patients/me': ME })
  renderReport()
  await screen.findByRole('heading', { name: 'What the camera measured' })
  expect(screen.queryByText(/From this session's camera events/)).toBeNull()
  expect(screen.queryByText(/counted separately/)).toBeNull()
  expect(screen.queryByText(/Only Dr\. Rao sets your level/)).toBeNull()
  expect(screen.getByText('Ended early')).toBeInTheDocument()
  expect(screen.getByText('Replay · not counted')).toBeInTheDocument()
  expect(screen.getByText('verified movements')).toBeInTheDocument()
  expect(screen.getByText('unverified (hand hid cup)')).toBeInTheDocument()
})

test('the meta line reads date · title and the status chip says Complete', async () => {
  mockApi({ '/api/sessions/abc': SESSION, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByText('Sat 12 Sep · Waiter – cup + Arm out to the side')).toBeInTheDocument()
  expect(screen.getByText('Complete')).toBeInTheDocument()
})

test('a peg test that lost tracking says its time is limited, not a clean 100 % (e2e 11 Oct)', async () => {
  const camera = { reps_total: 9, verified: 9, unverified: 0, coverage_pct: 100, active_s: 38, nhpt_total_s: 24.2, splits_s: [1.4, 2.5, 2.4, 2.3, 5.2, 3.2, 2.4, 2.5, 2.3] }
  const nhpt = { ...SESSION, mode: 'nhpt', title: 'Nine-Hole Peg Test · 24.2 s', tracking: 'limited', summary: { ...SESSION.summary, mode: 'nhpt', tracking: 'limited', tracking_lost_events: 1, camera } }
  mockApi({ '/api/sessions/abc': nhpt, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByText('Limited tracking')).toBeInTheDocument()
  expect(screen.getByText(/Nine-Hole Peg Test:/).closest('p')).toHaveTextContent(/camera lost the board during the test/)
})

test('coach note eyebrows come from the note category, and a note without one has none', async () => {
  const notes = [
    { text: 'correct: trunk lean in 2 of 16 lifts', confidence: 'medium', evidence: [58], cat: 'Posture' },
    { text: 'progress: reach time fell', confidence: 'high', evidence: [22] },
  ]
  mockApi({ '/api/sessions/abc': { ...SESSION, summary: { ...SESSION.summary, coach: { ...SESSION.summary.coach, notes } } }, '/api/patients/me': ME })
  renderReport()
  const lean = (await screen.findByText(/trunk lean in 2 of 16/)).closest('li')!
  expect(lean.querySelector('small')).toHaveTextContent('Posture')
  const reach = screen.getByText(/reach time fell/).closest('li')!
  expect(reach.querySelector('small')).toBeNull()
})

test('coach notes stored in the old "action: reason" form read as sentences; the category chip stays', async () => {
  const notes = [
    { text: 'progress: patient accepted progression', confidence: 'high', evidence: [], cat: 'Performance' },
    { text: 'progress: two clean slow arcs, mean reach 1.2 s, 0 unverified', confidence: 'high', evidence: [22], cat: 'Performance' },
  ]
  mockApi({ '/api/sessions/abc': { ...SESSION, summary: { ...SESSION.summary, coach: { ...SESSION.summary.coach, notes } } }, '/api/patients/me': ME })
  renderReport()
  const accepted = (await screen.findByText('Patient accepted the faster arcs.')).closest('li')!
  expect(accepted.querySelector('small')).toHaveTextContent('Performance')
  expect(screen.getByText('Progression offered: two clean slow arcs, mean reach 1.2 s, 0 unverified.')).toBeInTheDocument()
  expect(screen.queryByText(/^progress:/)).not.toBeInTheDocument()
})

test('the authority line names the clinician from data and guesses no pronoun', async () => {
  mockApi({ '/api/sessions/abc': SESSION, '/api/patients/me': ME })
  renderReport()
  const line = await screen.findByText(/Nothing in your plan changes until Dr\. Rao approves it\./)
  expect(line.textContent).not.toMatch(/\b(hers|his|her|him|she|he)\b/i)
  expect(screen.getByText(/Continue your assigned plan/)).toBeInTheDocument()
})

test('a replayed session is badged "Replay · not counted" and one verified movement is singular (review 28 Sep)', async () => {
  const one = { ...SESSION, source: 'replay', replay: true, summary: { ...SESSION.summary, camera: { ...SESSION.summary.camera, verified: 1, posture_cues: 1 } } }
  mockApi({ '/api/sessions/abc': one, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByText('verified movement')).toBeInTheDocument()
  expect(screen.getByText('posture cue')).toBeInTheDocument()
  expect(screen.getByText('Replay · not counted')).toBeInTheDocument()
})

test('a live session carries no Replay badge', async () => {
  mockApi({ '/api/sessions/abc': { ...SESSION, source: 'live', replay: false }, '/api/patients/me': ME })
  renderReport()
  await screen.findByText('verified movements')
  expect(screen.queryByText(/Replay/)).not.toBeInTheDocument()
})

test('clinician falls back to "your therapist" when the profile is unavailable', async () => {
  mockApi({ '/api/sessions/abc': SESSION })
  renderReport()
  expect(await screen.findByText('Nothing in your plan changes until your therapist approves it.')).toBeInTheDocument()
})

test('download builds a JSON blob and sharing explains who sees the report', async () => {
  mockApi({ '/api/sessions/abc': SESSION, '/api/patients/me': ME })
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:praxis')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  renderReport()
  fireEvent.click(await screen.findByRole('button', { name: 'Download' }))
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

test('side comes from the camera summary only, never the check-in, feedback or the stored profile side', async () => {
  localStorage.setItem('praxis.side', 'right')
  mockApi({ '/api/sessions/abc': { ...SESSION, checkin: { pain_before: 2, side: 'right' }, summary: { ...SESSION.summary, told_us: { side: 'right' } } }, '/api/patients/me': ME })
  renderReport()
  await screen.findByRole('heading', { name: 'What the camera measured' })
  expect(screen.queryByText(/right side/)).not.toBeInTheDocument()
  localStorage.clear()
})

test('a cup session counts wrong-dot placements from the service', async () => {
  mockApi({ '/api/sessions/abc': { ...SESSION, summary: { ...SESSION.summary, camera: { ...SESSION.summary.camera, wrong_dot: 2 } } }, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByText('wrong dot')).toBeInTheDocument()
  expect(screen.getByText('wrong dot').closest('div')!.parentElement).toHaveTextContent('2')
})

test('the report loads only its own session and the profile (no simulated cup run)', async () => {
  const fetchMock = mockApi({ '/api/sessions/abc': SESSION, '/api/patients/me': ME })
  localStorage.setItem('praxis.cupRun', JSON.stringify({ reaches: [1, 2, 3] }))
  renderReport()
  await screen.findByRole('heading', { name: 'What the camera measured' })
  const urls = fetchMock.mock.calls.map((c) => String(c[0]))
  expect(urls.every((u) => u.includes('/api/sessions/abc') || u.includes('/api/patients/me'))).toBe(true)
  localStorage.clear()
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
  const chart = await screen.findByRole('img', { name: /^Arm out to the side · peak angle per rep: 1: 88°/ })
  expect(chart).toHaveClass('rp-bars')
  expect(screen.getByText(/Peak angle per rep · target 90°/)).toBeInTheDocument()
})

test('the service exercise name and target are used when the summary carries them', async () => {
  mockApi({ '/api/sessions/abc': ARM('abduction', { exercise_id: 'abduction', exercise_name: 'Arm out to the side', target_deg: 60, ceiling_deg: 90 }), '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByRole('img', { name: /^Arm out to the side · peak angle per rep: 1: 88°/ })).toBeInTheDocument()
  expect(screen.getByText(/Peak angle per rep · target 60°/)).toBeInTheDocument()
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
  expect(await screen.findByRole('img', { name: /^Arm out to the side · peak angle per rep: 1: 88°/ })).toBeInTheDocument()
})

test('a report opened from history uses the per-exercise columns, each with its own counts and no "Not done yet"', async () => {
  const camera = { reps_total: 5, verified: 3, unverified: 2, reach_ms: [1400, 1200, 900], reach_verified: [true, false, true], peak_deg: [88, 90], peak_verified: [true, false] }
  mockApi({ '/api/sessions/abc': { ...SESSION, mode: 'cup', title: 'Waiter – cup + Arm out to the side', summary: { ...SESSION.summary, mode: 'cup', camera } }, '/api/patients/me': ME })
  renderReport()
  const cup = await screen.findByRole('img', { name: /^Waiter – cup · reach time per dot: 1: 1400 ms, 2: 1200 ms unverified/ })
  const arm = screen.getByRole('img', { name: /^Arm out to the side · peak angle per rep: 1: 88°, 2: 90° unverified/ })
  const cols = document.querySelectorAll('.rp-exs > .rp-ex')
  expect(cols).toHaveLength(2)
  expect(cols[0]).toContainElement(cup)
  expect(cols[0].textContent).toMatch(/2 verified · 1 unverified/)
  expect(cols[1]).toContainElement(arm)
  expect(cols[1].textContent).toMatch(/1 verified · 1 unverified/)
  expect(document.body.textContent).not.toMatch(/Not done yet/)
})

// 10 Oct walkthrough: the Claude agent's session note was missing from the report.
const AGENT_COACH = {
  label: 'Rule-based coach',
  notes: [],
  decisions: 4,
  agent: 'Claude agent · Anthropic API',
  agent_decisions: 2,
  note: { text: 'Steady slow arcs; reach time held across the fast arcs.', evidence: [12, 30], label: 'Claude agent · Anthropic API' },
}

test("the Claude agent's session note sits in a section titled just \"Agent\"", async () => {
  mockApi({ '/api/sessions/abc': { ...SESSION, summary: { ...SESSION.summary, coach: AGENT_COACH } }, '/api/patients/me': ME })
  renderReport()
  const note = (await screen.findByText('Steady slow arcs; reach time held across the fast arcs.')).closest('li')!
  expect(note.closest('section')!.querySelector('h2')).toHaveTextContent(/^Agent$/)
  expect(screen.queryByRole('heading', { name: /Rule-based coach/ })).toBeNull()
  expect(screen.queryByText(/No coach notes/)).toBeNull()
  expect(document.body.textContent).not.toMatch(/LLM agent pending/)
})

test('a long agent note is cut to three sentences on the report', async () => {
  const text = 'Steady slow arcs. Reach time held at 1.2 s. Two reps were unverified. Keep the fast arcs on. Rest if it hurts.'
  const coach = { ...AGENT_COACH, note: { ...AGENT_COACH.note, text } }
  mockApi({ '/api/sessions/abc': { ...SESSION, summary: { ...SESSION.summary, coach } }, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByText('Steady slow arcs. Reach time held at 1.2 s. Two reps were unverified.')).toBeInTheDocument()
  expect(screen.queryByText(/Keep the fast arcs on/)).toBeNull()
})

test('a long rule-coach note is cut to three sentences too', async () => {
  const notes = [{ text: 'Lean seen. Lean seen again. Lean three. Lean four.', confidence: 'medium', evidence: [58], cat: 'Posture' }]
  mockApi({ '/api/sessions/abc': { ...SESSION, summary: { ...SESSION.summary, coach: { ...SESSION.summary.coach, notes } } }, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByText('Lean seen. Lean seen again. Lean three.')).toBeInTheDocument()
})

test('rule notes beside the agent note keep the rule coach label; the agent note comes first', async () => {
  const coach = { ...AGENT_COACH, notes: [{ text: 'correct: trunk lean in 2 of 16 lifts', confidence: 'medium', evidence: [58], cat: 'Posture' }] }
  mockApi({ '/api/sessions/abc': { ...SESSION, summary: { ...SESSION.summary, coach } }, '/api/patients/me': ME })
  renderReport()
  await screen.findByText(/trunk lean in 2 of 16/)
  const items = document.querySelectorAll('.rp-notes > li')
  expect(items).toHaveLength(2)
  expect(items[0]).toHaveTextContent(AGENT_COACH.note.text)
  expect(items[1].querySelector('small')).toHaveTextContent('Rule-based coach · Posture')
})

test('with the agent off (or silent) the section stays labelled "Rule-based coach", never "Agent"', async () => {
  const coach = { label: 'Rule-based coach', notes: [], decisions: 0, agent: 'Claude agent · Anthropic API', agent_decisions: 0 }
  mockApi({ '/api/sessions/abc': { ...SESSION, summary: { ...SESSION.summary, coach } }, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByRole('heading', { name: 'Rule-based coach' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Agent' })).toBeNull()
  expect(screen.queryByText(/Claude agent/)).toBeNull()
  expect(screen.getByText(/No coach notes/)).toBeInTheDocument()
})

test('an agent that made decisions but wrote no note does not title the rule notes "Agent"', async () => {
  const coach = { ...AGENT_COACH, note: undefined, notes: [{ text: 'Posture correction: trunk lean 14°.', confidence: 'medium', evidence: [58], cat: 'Posture' }] }
  vi.useFakeTimers()
  mockApi({ '/api/sessions/abc': { ...SESSION, summary: { ...SESSION.summary, coach } }, '/api/patients/me': ME })
  renderReport()
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  expect(screen.getByRole('heading', { name: 'Rule-based coach' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Agent' })).toBeNull()
  vi.useRealTimers()
})

// 10 Oct walkthrough: a session ended by the pain stop rule, feedback skipped, read "— → —".
test('pain reported during the session fills "after" when the feedback was skipped, and says so', async () => {
  const rec = { ...SESSION, status: 'ended_early', feedback: {}, summary: { ...SESSION.summary, stopped: true, reported_pain: { pain: 8, t: 41.2 } } }
  mockApi({ '/api/sessions/abc': rec, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByText('2 → 8')).toBeInTheDocument()
  expect(screen.getByText('pain before → during the session')).toBeInTheDocument()
  expect(screen.getByText('You reported pain 8/10 during the session.')).toBeInTheDocument()
})

test('a feedback answer stays the "after" value; the in-session report is still listed', async () => {
  const rec = { ...SESSION, feedback: { pain_after: 5 }, summary: { ...SESSION.summary, reported_pain: { pain: 8, t: 41.2 } } }
  mockApi({ '/api/sessions/abc': rec, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByText('2 → 5')).toBeInTheDocument()
  expect(screen.getByText('pain before → after')).toBeInTheDocument()
  expect(screen.getByText('You reported pain 8/10 during the session.')).toBeInTheDocument()
})

test('no in-session report: no extra pain line', async () => {
  mockApi({ '/api/sessions/abc': SESSION, '/api/patients/me': ME })
  renderReport()
  expect(await screen.findByText('2 → 2')).toBeInTheDocument()
  expect(screen.queryByText(/during the session/)).toBeNull()
})

test('an Arm out to the side report shows the lifts above 90° next to the posture cues', async () => {
  const arm = { ...SESSION, mode: 'arm', exercise: 'abduction', title: 'Arm out to the side', summary: { ...SESSION.summary, mode: 'arm', camera: { reps_total: 16, verified: 15, unverified: 1, posture_cues: 2, coverage_pct: 95, active_s: 300, above_ceiling: 2, above_ceiling_by_set: { '1': 2 } } } }
  mockApi({ '/api/sessions/abc': arm, '/api/patients/me': ME })
  renderReport()
  const stat = await screen.findByText('lifts above 90°')
  expect(stat.closest('.rp-stats')).toHaveTextContent(/2\s*posture cues/)
  expect(stat.closest('div.min-w-0')).toHaveTextContent(/^2\s*lifts above 90°$/)
})

test('a cup report has no above-90° count', async () => {
  mockApi({ '/api/sessions/abc': { ...SESSION, summary: { ...SESSION.summary, camera: { ...SESSION.summary.camera, above_ceiling: 0 } } }, '/api/patients/me': ME })
  renderReport()
  await screen.findByText('tracking coverage')
  expect(screen.queryByText(/above 90°/)).not.toBeInTheDocument()
})

// 10 Oct walkthrough: the agent writes its note after the session is saved, so a report opened
// right away missed it until a reload.
describe('a late agent note', () => {
  const noNote = { ...AGENT_COACH, note: undefined }
  function serve(notes: (typeof AGENT_COACH.note | undefined)[], agent = true) {
    let n = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/sessions/abc')) {
        const note = notes[Math.min(n++, notes.length - 1)]
        const coach = agent ? { ...noNote, ...(note ? { note } : {}) } : { label: 'Rule-based coach', notes: [], decisions: 2 }
        return { ok: true, status: 200, json: async () => ({ ...SESSION, summary: { ...SESSION.summary, coach } }) } as Response
      }
      if (url.includes('/api/patients/me')) return { ok: true, status: 200, json: async () => ME } as Response
      return { ok: false, status: 404, json: async () => ({ error: 'unmocked' }) } as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    return () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/sessions/abc')).length
  }
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('is fetched again every 2 s and shown when it lands, with no loading text', async () => {
    const calls = serve([undefined, undefined, AGENT_COACH.note])
    renderReport()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByRole('heading', { name: 'What the camera measured' })).toBeInTheDocument()
    expect(screen.queryByText(AGENT_COACH.note.text)).toBeNull()
    expect(document.body.textContent).not.toMatch(/waiting|loading/i)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(calls()).toBe(2)
    expect(screen.queryByText(AGENT_COACH.note.text)).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(screen.getByText(AGENT_COACH.note.text)).toBeInTheDocument()
    for (let i = 0; i < 10; i++) await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(calls()).toBe(3)
  })

  test('stops asking after 20 s when no note comes', async () => {
    const calls = serve([undefined])
    renderReport()
    for (let i = 0; i < 30; i++) await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(calls()).toBe(11)
    expect(screen.getByText(/No coach notes/)).toBeInTheDocument()
  })

  test('a session without an agent is fetched once', async () => {
    const calls = serve([undefined], false)
    renderReport()
    for (let i = 0; i < 5; i++) await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(calls()).toBe(1)
  })
})

test('the camera card keeps its natural height when there are no per-rep charts', async () => {
  const camera = { ...SESSION.summary.camera, reach_ms: undefined, reach_verified: undefined }
  mockApi({ '/api/sessions/abc': { ...SESSION, summary: { ...SESSION.summary, camera } }, '/api/patients/me': ME })
  renderReport()
  const card = (await screen.findByRole('heading', { name: 'What the camera measured' })).closest('.rp-cam')
  expect(card).toHaveClass('rp-cam-flat')
})

test('the camera card fills the column when it draws per-rep bars', async () => {
  mockApi({ '/api/sessions/abc': SESSION, '/api/patients/me': ME })
  renderReport()
  const card = (await screen.findByRole('heading', { name: 'What the camera measured' })).closest('.rp-cam')
  expect(card).not.toHaveClass('rp-cam-flat')
})

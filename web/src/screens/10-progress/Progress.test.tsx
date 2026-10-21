import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ME, PRESCRIPTION, SESSION, mockApi } from '../../test/api-mock'
import { Progress } from './Progress'

const PROGRESS = { nhpt_trend: [{ date: '2026-08-01', total_s: 68 }, { date: '2026-09-12', total_s: 41.2 }], verified_per_session: [{ date: '2026-07-10', verified: 5, limited: false, mode: 'cup' }, { date: '2026-09-10', verified: 8, limited: true, mode: 'cup' }, { date: '2026-09-12', verified: 17, limited: false, mode: 'cup' }, { date: '2026-09-11', verified: 14, limited: false, mode: 'arm' }], practice: { done: 1, planned: null, hours: 0.2 }, adherence_pct: null, sample: { done: 19, planned: 22, hours: 3.4, illustrative: true as const }, pain_effort: [{ date: '2026-09-08', pain_after: 5, effort: 7, ended_early: true }], goal_log_count: 6 }
const cam = (verified: number, unverified = 0, extra: Record<string, unknown> = {}) => ({ ...SESSION.summary, camera: { ...SESSION.summary.camera, verified, unverified, ...extra } })
const ARM = (id: string, date: string, peaks: number[], ok: boolean[], extra: Record<string, unknown> = {}) => ({ ...SESSION, id, mode: 'arm', exercise: 'abduction', title: 'Arm out to the side', date, summary: { ...cam(8, 0, { peak_deg: peaks, peak_verified: ok }), mode: 'arm', exercise: 'abduction' }, ...extra })
const SESSIONS = { sessions: [
  SESSION, // cup · 12 Sep · 17 verified, 3 unverified
  { ...SESSION, id: 'lim', tracking: 'limited', status: 'complete', title: 'Waiter – cup', date: '2026-09-10', summary: cam(8, 4) },
  { ...SESSION, id: 'jul', title: 'Waiter – cup', date: '2026-07-10', summary: cam(5) },
  ARM('early', '2026-09-11', [50, 55], [true, true], { status: 'ended_early', feedback: { pain_after: 5 } }),
  ARM('abd', '2026-09-12', [50, 60, 88], [true, true, false]),
  // a session of an exercise hidden on 28 Sep: the service no longer lists these; the page ignores one anyway
  { ...SESSION, id: 'pend', mode: 'arm', exercise: 'pendulum', title: 'Pendulum', date: '2026-09-12', summary: { ...cam(20), mode: 'arm', exercise: 'pendulum' } },
  { ...SESSION, id: 'nhpt', mode: 'nhpt', title: 'Nine-Hole Peg Test', date: '2026-09-12', summary: { ...cam(9, 0, { nhpt_total_s: 41.2 }), mode: 'nhpt' } },
] }
const BASE = { '/api/progress': PROGRESS, '/api/sessions': SESSIONS, '/api/patients/me': ME, '/api/prescription': PRESCRIPTION, '/api/flags': { flags: [] } }

function renderProgress() {
  return render(
    <MemoryRouter initialEntries={['/details/progress']}>
      <Routes>
        <Route path="/details/progress" element={<Progress />} />
        <Route path="/details/report/:id" element={<div>REPORT</div>} />
      </Routes>
    </MemoryRouter>,
  )
}
const ready = () => screen.findByRole('heading', { name: /Nine-Hole Peg Test/ })
const cupBars = () => screen.getByRole('img', { name: /^Waiter – cup/ })

test('header: the range pill is Last 4 weeks / All activities; no task pill and no same-setup checkbox', async () => {
  mockApi(BASE)
  renderProgress()
  expect(screen.getByText(/Loading your progress/)).toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: 'Progress and history' })).toBeInTheDocument()
  expect(within(screen.getByLabelText('Range')).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Last 4 weeks', 'All activities'])
  expect(screen.queryByLabelText('Task')).not.toBeInTheDocument()
  expect(screen.queryByLabelText(/Compare same setup only/)).not.toBeInTheDocument()
})

test('peg test card takes the side from the patient profile and labels first and last points', async () => {
  mockApi({ ...BASE, '/api/patients/me': { ...ME, side: 'right' } })
  renderProgress()
  expect(await screen.findByText('right · lower is better')).toBeInTheDocument()
  expect(screen.getByRole('img', { name: /Nine-Hole Peg Test: 1 Aug 68 s.*12 Sep 41\.2 s/ })).toBeInTheDocument()
  expect(screen.getByText('1 Aug · 68 s')).toBeInTheDocument()
  expect(screen.getByText('12 Sep · 41.2 s')).toBeInTheDocument()
  expect(screen.queryByText(/^left · lower/)).not.toBeInTheDocument()
})

test('cup bars come from the sessions: verified plus hatched unverified, limited pale, replays never charted', async () => {
  const REPLAY = { ...SESSION, id: 'rp', source: 'replay', replay: true, title: 'Waiter – cup', date: '2026-09-11', summary: { ...cam(31, 2), source: 'replay' } }
  mockApi({ ...BASE, '/api/sessions': { sessions: [...SESSIONS.sessions, REPLAY] } })
  renderProgress()
  await ready()
  const bars = cupBars()
  expect(bars).toHaveAccessibleName(/12 Sep 17 verified, 3 unverified/)
  expect(bars).toHaveAccessibleName(/10 Sep 8 verified, 4 unverified \(limited tracking\)/)
  expect(bars).not.toHaveAccessibleName(/31 verified/)
  expect(bars.querySelectorAll('.pg-bar-u')).toHaveLength(2) // the hatched unverified part of each bar that has one
  expect(bars.querySelectorAll('.pg-bar-l')).toHaveLength(1)
  expect(screen.getByText('2 sessions')).toBeInTheDocument()
})

test('sample cup bars are outlined and say Sample in the label; first → last compares only your own', async () => {
  const sample = { ...SESSION, id: 's1', illustrative: true, title: 'Waiter – cup', date: '2026-09-09', summary: cam(9, 1) }
  const own2 = { ...SESSION, id: 'o2', title: 'Waiter – cup', date: '2026-09-13', summary: cam(19, 1) }
  mockApi({ ...BASE, '/api/sessions': { sessions: [SESSION, sample, own2] } })
  renderProgress()
  await ready()
  expect(cupBars()).toHaveAccessibleName(/9 Sep 9 verified, 1 unverified · Sample/)
  expect(cupBars().querySelectorAll('.pg-bar-s')).toHaveLength(1)
  expect(screen.getByText(/^17 → 19 verified · same task, side and setup/)).toBeInTheDocument()
})

test('without the session list the cup chart falls back to verified_per_session', async () => {
  mockApi({ ...BASE, '/api/sessions': { error: 'down' } })
  renderProgress()
  await ready()
  expect(cupBars()).toHaveAccessibleName(/12 Sep 17 verified/)
})

test('arm chart: median verified peak per session, the limit from the prescription ceiling, labelled a camera estimate', async () => {
  const rx = { ...PRESCRIPTION, exercises: { ...PRESCRIPTION.exercises, abduction: { ...PRESCRIPTION.exercises.abduction, ceiling_deg: 80 } } }
  mockApi({ ...BASE, '/api/prescription': rx })
  renderProgress()
  await ready()
  // 12 Sep: verified peaks 50, 60 (88 unverified is left out) → 60; the pendulum session never charts
  expect(await screen.findByText(/80° limit · axis starts at 30° · camera estimate/)).toBeInTheDocument()
  expect(screen.getByRole('img', { name: /^Arm out to the side, peak angle: 11 Sep 55°, 12 Sep 60°$/ })).toBeInTheDocument()
  expect(screen.getByText(/stays within the therapist's 80° limit/)).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/90° limit/)
})

test('practice card shows your own practice; the sample is a labelled secondary line', async () => {
  mockApi({ ...BASE, '/api/progress': { ...PROGRESS, practice: { done: 4, planned: 5, days_done: 3, hours: 0.7 }, adherence_pct: 60 } })
  renderProgress()
  expect(await screen.findByText('3/5')).toBeInTheDocument()
  expect(screen.getByText('planned days practised')).toBeInTheDocument()
  const line = screen.getByText(/19\/22 planned · 3\.4 h · illustrative, not added to yours/)
  expect(within(line.closest('p')!).getByText('Sample')).toBeInTheDocument()
})

test('practice before any planned days counts sessions recorded here', async () => {
  mockApi(BASE)
  renderProgress()
  expect(await screen.findByText('session recorded')).toBeInTheDocument()
})

test('the streak counts your live sessions only, never sample dates', async () => {
  const s = (id: string, date: string, illustrative = false) => ({ ...SESSION, id, date, illustrative })
  mockApi({ ...BASE, '/api/progress': { ...PROGRESS, verified_per_session: [] }, '/api/sessions': { sessions: [s('a', '2026-09-10', true), s('b', '2026-09-11', true), s('c', '2026-09-12'), s('d', '2026-09-13')] } })
  renderProgress()
  expect(await screen.findByText('Longest run: 2 practice days in a row')).toBeInTheDocument()
})

test('session list: all exercises newest first, replays with a Replay badge, sample rows with a Sample chip, hidden never', async () => {
  const REPLAY = { ...SESSION, id: 'rp', source: 'replay', replay: true, title: 'Waiter – cup', date: '2026-09-11', summary: { ...cam(31), source: 'replay' } }
  const SAMPLE = { ...SESSION, id: 'smp', illustrative: true, title: 'Waiter – cup', date: '2026-09-09' }
  mockApi({ ...BASE, '/api/sessions': { sessions: [...SESSIONS.sessions, REPLAY, SAMPLE] } })
  renderProgress()
  await ready()
  const opens = screen.getAllByRole('button', { name: /^Open / }).map((b) => b.getAttribute('aria-label'))
  expect(opens[0]).toMatch(/· 12 Sep$/)
  expect(opens.at(-1)).toMatch(/· 9 Sep$/)
  expect(opens).not.toContain('Open Pendulum · 12 Sep')
  expect(document.body.textContent).not.toMatch(/Pendulum|Arm to the front|Rotate (in|out)/)
  const replayRow = screen.getByRole('button', { name: 'Open Waiter – cup · 11 Sep' }).closest('li')!
  expect(within(replayRow).getByText('Replay')).toBeInTheDocument()
  const sampleRow = screen.getByRole('button', { name: 'Open Waiter – cup · 9 Sep' }).closest('li')!
  expect(within(sampleRow).getByText('Sample')).toBeInTheDocument()
  expect(screen.getAllByText('17 verified movements · 3 unverified · 12 active min')).toHaveLength(2) // own 12 Sep + the sample row copied from it
  expect(screen.getByText('41.2 s · lower is better')).toBeInTheDocument()
  expect(screen.getByText(/8 verified movements · 4 unverified · 12 active min · limited tracking/)).toBeInTheDocument()
})

test('Open goes to the session report', async () => {
  mockApi(BASE)
  renderProgress()
  await ready()
  fireEvent.click(screen.getByRole('button', { name: 'Open Waiter – cup · 10 Sep' }))
  expect(await screen.findByText('REPORT')).toBeInTheDocument()
})

test('stopped early names the clinician flag only when a flag row exists for that session', async () => {
  mockApi(BASE)
  const { unmount } = renderProgress()
  await ready()
  expect(screen.getByText('Stopped early · pain 5')).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/flag for|notified/)
  unmount()
  mockApi({ ...BASE, '/api/flags': { flags: [{ id: 1, session_id: 'early', rule: 'pain', detail: 'pain 5', t: 0, date: '2026-09-11', reviewed: false }] } })
  renderProgress()
  expect(await screen.findByText('Stopped early · pain 5 · flag for Dr. Anita Rao, OT · queued')).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/notified/)
})

test('a flag in the session summary also counts', async () => {
  const early = ARM('early', '2026-09-11', [50], [true], { status: 'ended_early', feedback: { pain_after: 8 } })
  early.summary = { ...early.summary, flags: [{ t: 1, rule: 'pain', detail: 'pain 8' }] } as typeof early.summary
  mockApi({ ...BASE, '/api/sessions': { sessions: [early] } })
  renderProgress()
  expect(await screen.findByText('Stopped early · pain 8 · flag for Dr. Anita Rao, OT · queued')).toBeInTheDocument()
})

test('range: the July session shows only under All activities', async () => {
  mockApi(BASE)
  renderProgress()
  await ready()
  expect(cupBars()).not.toHaveAccessibleName(/10 Jul/)
  fireEvent.click(screen.getByRole('radio', { name: 'All activities' }))
  expect(cupBars()).toHaveAccessibleName(/10 Jul 5 verified/)
})

test('pain and effort: chart and caption from your reports; the narrative ignores sample rows', async () => {
  const pe = [{ date: '2026-09-01', pain_after: 9, effort: 2, ended_early: false, illustrative: true }, { date: '2026-09-08', pain_after: 2, effort: 7, ended_early: false }, { date: '2026-09-10', pain_after: 5, effort: 5, ended_early: true }, { date: '2026-09-12', pain_after: 2, effort: 4, ended_early: false }]
  mockApi({ ...BASE, '/api/progress': { ...PROGRESS, pain_effort: pe } })
  renderProgress()
  await ready()
  expect(screen.getByRole('img', { name: /Pain after and effort per session: 1 Sep pain 9, effort 2 \(sample\); 8 Sep pain 2/ })).toBeInTheDocument()
  expect(screen.getByText('10 Sep · pain 5 · session ended early')).toBeInTheDocument()
  expect(screen.getByText('Pain steady at 2 except once. Effort drifting down.')).toBeInTheDocument()
})

test('design review 21 Oct: no everyday goal log (the camera only sees in-session activity)', async () => {
  mockApi(BASE)
  renderProgress()
  await ready()
  expect(screen.queryByText('Everyday goal log')).not.toBeInTheDocument()
  expect(screen.queryByText(/logged at your everyday goal/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Log an attempt' })).not.toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/Use a cup on my own/)
})

test('empty state when there are no sessions yet', async () => {
  mockApi({ ...BASE, '/api/progress': { ...PROGRESS, nhpt_trend: [], verified_per_session: [], pain_effort: [] }, '/api/sessions': { sessions: [] } })
  renderProgress()
  expect(await screen.findByText('No sessions in this range.')).toBeInTheDocument()
  expect(screen.getByText('No assessments yet.')).toBeInTheDocument()
  expect(screen.getByText('No Waiter – cup sessions in this range.')).toBeInTheDocument()
  expect(screen.getByText('No arm sessions in this range.')).toBeInTheDocument()
})

test('a trend mixing sample and your own points says so; sample points are named in the chart label', async () => {
  const mixed = { ...PROGRESS, nhpt_trend: [{ date: '2026-08-01', total_s: 68, kind: 'sample' }, { date: '2026-09-12', total_s: 41.2, kind: 'sample' }, { date: '2026-09-25', total_s: 38.5, kind: 'live' }] }
  mockApi({ ...BASE, '/api/progress': mixed })
  renderProgress()
  await ready()
  expect(screen.getByText(/1 assessment of yours · 2 sample/)).toBeInTheDocument()
  expect(screen.getByRole('img', { name: /1 Aug 68 s sample.*25 Sep 38\.5 s$/ })).toBeInTheDocument()
})

test('counts are pluralised: one session', async () => {
  const one = { ...PROGRESS, verified_per_session: [{ date: '2026-09-12', verified: 1, limited: false, mode: 'cup' }] }
  mockApi({ ...BASE, '/api/progress': one, '/api/sessions': { error: 'down' } })
  renderProgress()
  expect(await screen.findByText('1 session')).toBeInTheDocument()
  expect(cupBars()).toHaveAccessibleName(/12 Sep 1 verified$/)
})

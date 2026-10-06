import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
vi.mock('../../avatar/AvatarScene', () => ({ AvatarScene: () => <div data-testid="scene" /> }))

import * as hook from '../../session/useWebcamStream'
import * as coachMod from '../../session/useCoach'
import { LiveNhpt } from './LiveNhpt'

const frame = {
  type: 'frame',
  t: 10,
  id: 1,
  calibrated: true,
  missing: [],
  nhpt: { mode: 'nhpt', state: 'in_transit', target: null, reps: 5, finished: false, started: true, completed: false, pegs_done: 5, elapsed_s: 24.8, total_s: null },
  board: { occupancy: {}, hole_source: 'hough', free_pegs_mm: [] },
  overlay: { holes_px: [], target: null, next_hole: 5, markers_px: {} },
}

function mockStream(events: Record<string, unknown>[], send = vi.fn()) {
  vi.spyOn(hook, 'useWebcamStream').mockReturnValue({
    camActive: true,
    connected: true,
    lastEvent: (events[events.length - 1] ?? null) as never,
    events: events as never,
    sessionId: null, error: null,
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    send,
    videoRef: { current: null },
  })
  return send
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/session" element={<LiveNhpt />} />
        <Route path="/report" element={<div>REPORT PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('shows elapsed time, seated count, next hole and tracking badge', () => {
  mockStream([frame])
  renderAt('/session?hand=left')
  const stats = screen.getByRole('region', { name: 'Progress' })
  expect(within(stats).getByText('24.8')).toBeInTheDocument()
  expect(stats).toHaveTextContent('from first peg lift')
  expect(within(stats).getByText('5 of 9 seated')).toBeInTheDocument()
  expect(within(stats).getByRole('img', { name: '5 of 9 pegs seated' })).toBeInTheDocument()
  expect(screen.getByText(/next: hole 6/)).toBeInTheDocument()
  expect(screen.getByText('Tracking')).toBeInTheDocument()
  expect(screen.getByText('Nine-Hole Peg Test · left hand')).toBeInTheDocument()
  expect(screen.getByText('Live · not recording')).toBeInTheDocument()
  expect(screen.getByText(/Rule-based coach · LLM agent pending/)).toBeInTheDocument()
})

test('the reference panel holds the figure with the board inset; no reference toggle', () => {
  mockStream([frame])
  renderAt('/session?hand=left')
  const ref = screen.getByRole('region', { name: 'Reference figure' })
  expect(within(ref).getByTestId('scene')).toBeInTheDocument()
  expect(within(ref).getByLabelText('board view')).toBeInTheDocument()
  expect(screen.queryByRole('radio', { name: 'Avatar' })).toBeNull()
  expect(within(ref).getByTestId('hole-5')).toHaveClass('bv-next')
})

test('the last peg split comes from the newest nhpt_split event', () => {
  mockStream([
    frame,
    { type: 'nhpt_split', t: 12, id: 2, peg: 1, hole: 3, split_s: 5.12, elapsed_s: 5.12 },
    { type: 'nhpt_split', t: 16, id: 3, peg: 2, hole: 0, split_s: 4.4, elapsed_s: 9.52 },
  ])
  renderAt('/session?hand=left')
  expect(screen.getByRole('region', { name: 'Progress' })).toHaveTextContent('last peg 4.4 s')
  expect(screen.getByRole('button', { name: /End session/ })).toBeInTheDocument()
})

test('exertion is its own labelled chip in the progress card', () => {
  mockStream([frame, { type: 'exertion', t: 11, id: 2, level: 'moderate', reasons: ['slower pegs'], method: 'behavioural' }])
  renderAt('/session?hand=left')
  const stats = screen.getByRole('region', { name: 'Progress' })
  expect(stats).toHaveTextContent('Exertion: moderate')
  expect(stats).toHaveTextContent('behavioural index · slower pegs')
})

test('tapping a seated hole in the board view sends sample_colour; null next_hole reads "any hole"', () => {
  const events = [{ ...frame, board: { occupancy: { hole_4: 'occupied' }, hole_source: 'hough', free_pegs_mm: [], colour: null }, overlay: { ...frame.overlay, next_hole: null } }]
  const send = mockStream(events)
  renderAt('/session?hand=left')
  expect(screen.getByText('any hole')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /hole 5 seated · tap to sample peg colour/ }))
  expect(send).toHaveBeenCalledWith({ cmd: 'sample_colour', hole: 4 })
})

test('replay has no tap-to-sample buttons', () => {
  mockStream([frame])
  renderAt('/session?hand=left&replay=synthetic_nhpt_01')
  expect(screen.queryByRole('button', { name: /tap to sample/ })).toBeNull()
})

test('tracking lost badge after perception_lost', () => {
  mockStream([frame, { type: 'perception_lost', t: 11, id: 2, missing: [1] }])
  renderAt('/session?hand=left')
  expect(within(screen.getByRole('banner')).getByRole('status')).toHaveTextContent('Tracking lost')
})

test('replay shows the corner badge instead of the old placeholder sentence and no red live text', () => {
  mockStream([frame])
  renderAt('/session?hand=left&replay=synthetic_nhpt_01')
  expect(screen.getByText('Replay · processed on the service')).toBeInTheDocument()
  expect(screen.queryByText(/recorded clip runs on the service/)).toBeNull()
  expect(screen.queryByText('Live · not recording')).toBeNull()
  expect(screen.getByRole('status')).toHaveTextContent('Replay')
})

test('the feed shows the rolling latency line from frame and coach events', () => {
  mockStream([
    { ...frame, id: 1, latency: { capture_to_event_ms: 40, proc_ms: 12 }, dropped: 0 },
    { ...frame, id: 2, latency: { capture_to_event_ms: 60, proc_ms: 14 }, dropped: 1 },
    { type: 'coach', t: 11, id: 3, action: 'instruct', cue_id: 'x', text: 'Go', reason: 'r', evidence: [], ui: {}, label: 'Rule-based coach · LLM agent pending', latency: { event_to_cue_ms: 3, capture_to_cue_ms: 63 } },
  ])
  renderAt('/session?hand=left')
  expect(screen.queryByText(/latency p50\/p95/)).toBeNull() // developer line: only with the trace open
  fireEvent.click(screen.getByRole('button', { name: 'Show trace' }))
  expect(screen.getByText('latency p50/p95 · capture→event 40/60 ms · event→cue 3/3 ms · 1 dropped')).toBeInTheDocument()
})

test('trace toggle opens the trace panel and the caption stays on screen', () => {
  mockStream([frame, { type: 'rep_complete', t: 11, id: 2, peg: 1 }])
  renderAt('/session?hand=left')
  expect(screen.getByText(/findContours \+ HoughCircles/)).toHaveClass('sx-mono') // developer line, Judge view only
  fireEvent.click(screen.getByRole('button', { name: 'Show trace' }))
  expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeInTheDocument()
  expect(screen.getAllByText(/findContours \+ HoughCircles/)).toHaveLength(2)
  expect(screen.getByText('Coach')).toBeInTheDocument()
  expect(screen.getByText(/Timer is running/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Hide trace' }))
  expect(screen.queryByRole('button', { name: 'Copy JSON' })).toBeNull()
})

test('navigates to the report when the test completes', () => {
  mockStream([frame, { type: 'nhpt_complete', t: 12, id: 3, total_s: 41.2, splits_s: [4, 5], pegs: [] }])
  renderAt('/session?hand=left')
  expect(screen.getByRole('dialog', { name: 'How was your practice?' })).toBeInTheDocument()
})

test('feedback acknowledgement navigates to the persisted report', () => {
  mockStream([frame, { type: 'command', t: 13, id: 4, cmd: 'feedback', ok: true, summary: { session_id: 'sid42' } }])
  render(
    <MemoryRouter initialEntries={['/session?hand=left']}>
      <Routes>
        <Route path="/session" element={<LiveNhpt />} />
        <Route path="/report/:id" element={<div>REPORT sid42</div>} />
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByText('REPORT sid42')).toBeInTheDocument()
})

test('verified and unverified counts are on the live peg-test screen', () => {
  mockStream([frame])
  renderAt('/session?hand=left')
  expect(screen.getByRole('region', { name: 'Progress' })).toHaveTextContent('5 verified · 0 unverified')
})

test('unverified pegs come from the service total when it sends one', () => {
  mockStream([{ ...frame, nhpt: { ...frame.nhpt, unverified_total: 1 } }])
  renderAt('/session?hand=left')
  expect(screen.getByRole('region', { name: 'Progress' })).toHaveTextContent('4 verified · 1 unverified')
})

test('Take a rest is not Pause: it sends a rest-tagged pause and shows the rest hold over the camera', () => {
  const send = mockStream([frame])
  renderAt('/session?hand=left')
  fireEvent.click(screen.getByRole('button', { name: 'Take a rest' }))
  expect(send).toHaveBeenCalledWith({ cmd: 'pause', reason: 'rest' })
  expect(screen.getByRole('region', { name: 'Your camera' })).toContainElement(screen.getByRole('alertdialog', { name: 'Resting' }))
  expect(screen.getByText(/Assessment · paused/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Rested — continue' }))
  expect(send).toHaveBeenCalledWith({ cmd: 'resume' })
  expect(screen.queryByRole('alertdialog', { name: 'Resting' })).not.toBeInTheDocument()
})

test('the service pause event that answers a rest does not stack the pause overlay on top', () => {
  const send = mockStream([frame])
  const tree = (
    <MemoryRouter initialEntries={['/session?hand=left']}>
      <Routes>
        <Route path="/session" element={<LiveNhpt />} />
      </Routes>
    </MemoryRouter>
  )
  const { rerender } = render(tree)
  fireEvent.click(screen.getByRole('button', { name: 'Take a rest' }))
  mockStream([frame, { type: 'pause', t: 11, id: 2, rule: 'patient', text: 'Paused. Take your time.' }], send)
  rerender(tree)
  expect(screen.getByRole('alertdialog', { name: 'Resting' })).toBeInTheDocument()
  expect(screen.queryByRole('alertdialog', { name: 'Paused' })).not.toBeInTheDocument()
})

test('Spoken instructions follow Settings: off by default for now, voiced when turned on; the caption stays', () => {
  const cue = { type: 'coach', t: 11, id: 3, action: 'instruct', cue_id: 'x', text: 'Next peg, nice and steady.', reason: 'r', evidence: [], ui: {}, label: 'Rule-based coach · LLM agent pending' }
  const speak = vi.spyOn(coachMod, 'browserSpeak').mockImplementation(() => {})
  try {
    mockStream([frame, cue])
    const first = renderAt('/session?hand=left')
    expect(speak).not.toHaveBeenCalled()
    expect(screen.getByText('Next peg, nice and steady.')).toBeInTheDocument()
    first.unmount()
    localStorage.setItem('praxis.guidance', JSON.stringify({ spoken: true, larger: false }))
    renderAt('/session?hand=left')
    expect(speak).toHaveBeenCalledWith('Next peg, nice and steady.', 'instruct')
  } finally {
    localStorage.clear()
    speak.mockRestore()
  }
})

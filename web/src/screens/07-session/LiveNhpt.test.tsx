import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
vi.mock('../../avatar/AvatarScene', () => ({ AvatarScene: () => <div data-testid="scene" /> }))

import * as hook from '../../session/useWebcamStream'
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
    stop: vi.fn(), endCapture: vi.fn(),
    send,
    videoRef: { current: null },
  })
  return send
}

function tree(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/session" element={<LiveNhpt />} />
        <Route path="/report" element={<div>REPORT PAGE</div>} />
      </Routes>
    </MemoryRouter>
  )
}

function renderAt(path: string) {
  return render(tree(path))
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
  expect(screen.queryByRole('button', { name: /^Pegs not found\?/ })).toBeNull()
})

test('"Pegs not found?" samples a tapped peg on the picture; the answer shows in the feed band', () => {
  const send = mockStream([frame])
  const { rerender } = renderAt('/session?hand=left')
  fireEvent.click(screen.getByRole('button', { name: 'Pegs not found? Tap a peg on the picture' }))
  const layer = screen.getByRole('button', { name: /Camera picture: tap a peg\. With a keyboard, use the hole buttons/ })
  const pic = document.querySelector('.sx-frame') as HTMLElement
  pic.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 480, right: 640, bottom: 480, x: 0, y: 0, toJSON: () => ({}) })
  fireEvent.click(layer, { detail: 1, clientX: 600, clientY: 400 })
  expect(send).toHaveBeenCalledWith({ cmd: 'sample_colour', x_px: 40, y_px: 400 })
  mockStream([frame, { type: 'command', t: 11, id: 4, cmd: 'sample_colour', ok: true, applied: true, detected: true, message: 'Peg colour set. I can see 3 pegs now.' }], send)
  rerender(tree('/session?hand=left'))
  expect(screen.getByText('Peg colour set. I can see 3 pegs now.', { selector: '.sx-band' })).toHaveClass('sx-band-mint')
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

test('the seated count reads 9 of 9 when nhpt_complete lands before the frame that counts the ninth peg', () => {
  const pegs = Array.from({ length: 9 }, (_, i) => ({ peg: i + 1, hole: i, t: 10 + i, split_s: 1 }))
  mockStream([
    { ...frame, nhpt: { ...frame.nhpt, state: 'seated', reps: 8, pegs_done: 8 } },
    { type: 'nhpt_complete', t: 12, id: 3, total_s: 20.4, splits_s: pegs.map((p) => p.split_s), pegs },
  ])
  renderAt('/session?hand=left')
  // the feedback dialog opens on top; the progress card behind it still shows the count
  expect(document.body.textContent?.match(/\d of 9 seated/g)).toEqual(['9 of 9 seated'])
  expect(document.body).toHaveTextContent('board full')
})

test('a peg test finished at the 9th peg is not finished again when the recording ends', () => {
  const send = mockStream([frame, { type: 'nhpt_complete', t: 12, id: 3, total_s: 41.2, splits_s: [4, 5], pegs: [] }, { type: 'replay_end', t: 13, id: 4, clip: 'synthetic_nhpt_01', frames: 130 }])
  renderAt('/session?hand=left&replay=synthetic_nhpt_01')
  const dlg = screen.getByRole('dialog', { name: 'How was your practice?' })
  expect(dlg).not.toHaveTextContent('The recording has ended.')
  fireEvent.click(within(dlg).getByRole('button', { name: 'Skip' }))
  expect(send.mock.calls.filter(([c]) => c.cmd === 'feedback')).toHaveLength(1)
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ cmd: 'feedback', ended_early: false, end_reason: null }))
})

test('a peg-test replay that ends before the 9th peg moves to the feedback as the recording ending', () => {
  const send = mockStream([frame, { type: 'replay_end', t: 13, id: 4, clip: 'synthetic_nhpt_01', frames: 130 }])
  renderAt('/session?hand=left&replay=synthetic_nhpt_01')
  const dlg = screen.getByRole('dialog', { name: 'How was your practice?' })
  expect(dlg).toHaveTextContent('The recording has ended.')
  fireEvent.click(within(dlg).getByRole('button', { name: 'Skip' }))
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ cmd: 'feedback', ended_early: false, end_reason: 'replay_end' }))
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

test('with Audio on the coach speaks its cue aloud and shows it as text; captions are locked on while it speaks', () => {
  const cue = { type: 'coach', t: 11, id: 3, action: 'instruct', cue_id: 'x', text: 'Next peg, nice and steady.', reason: 'r', evidence: [], ui: {}, label: 'Rule-based coach · LLM agent pending' }
  const said: string[] = []
  class FakeUtterance {
    rate = 1
    volume = 1
    onend?: () => void
    onerror?: () => void
    constructor(public text: string) {}
  }
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  vi.stubGlobal('speechSynthesis', { speak: (u: FakeUtterance) => { said.push(u.text); u.onend?.() }, cancel: vi.fn() })
  try {
    localStorage.setItem('praxis.prefs', JSON.stringify({ audio: true }))
    mockStream([frame, cue])
    renderAt('/session?hand=left')
    expect(screen.getByText('Next peg, nice and steady.')).toBeInTheDocument()
    expect(said).toEqual(['Next peg, nice and steady.'])
    expect(screen.getByRole('slider', { name: 'Coach voice volume' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Captions' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
  } finally {
    vi.unstubAllGlobals()
    localStorage.clear()
  }
})

test('with Audio off in Settings the cue is shown, not spoken', () => {
  const cue = { type: 'coach', t: 11, id: 3, action: 'instruct', cue_id: 'x', text: 'Next peg, nice and steady.', reason: 'r', evidence: [], ui: {}, label: 'Rule-based coach · LLM agent pending' }
  const speak = vi.fn()
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} })
  vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() })
  try {
    localStorage.setItem('praxis.prefs', JSON.stringify({ audio: false }))
    mockStream([frame, cue])
    renderAt('/session?hand=left')
    expect(screen.getByText('Next peg, nice and steady.')).toBeInTheDocument()
    expect(speak).not.toHaveBeenCalled()
    expect(screen.getByRole('switch', { name: 'Captions' })).not.toHaveAttribute('aria-disabled')
  } finally {
    vi.unstubAllGlobals()
    localStorage.clear()
  }
})

test('tracking lost and the last split hold after their events leave the 200-event window', () => {
  const all: Record<string, unknown>[] = [frame, { type: 'nhpt_split', t: 12, id: 2, peg: 1, hole: 3, split_s: 5.12, elapsed_s: 5.12 }, { type: 'perception_lost', t: 13, id: 3, missing: [1] }]
  mockStream([...all])
  const view = renderAt('/session?hand=left')
  for (let i = 0; i < 230; i++) {
    all.push({ ...frame, calibrated: false, t: 13 + i * 0.08, id: 100 + i })
    mockStream(all.slice(-200))
    view.rerender(tree('/session?hand=left'))
  }
  expect(within(screen.getByRole('banner')).getByRole('status')).toHaveTextContent('Tracking lost')
  expect(screen.getByRole('region', { name: 'Progress' })).toHaveTextContent('last peg 5.1 s')
})

test('ending from a stop rule records the stop rule as the end reason, never null', () => {
  const send = mockStream([frame, { type: 'stop', t: 12, id: 50, rule: 'exertion', text: 'Sustained high exertion. Session ended and saved.' }])
  renderAt('/session?hand=left')
  fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ cmd: 'feedback', ended_early: true, end_reason: 'stop:exertion' }))
})

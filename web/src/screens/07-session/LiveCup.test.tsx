import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
vi.mock('../../avatar/AvatarScene', () => ({ AvatarScene: () => <div data-testid="scene" /> }))

import * as hook from '../../session/useWebcamStream'
import { LiveCup } from './LiveCup'

const frame = {
  type: 'frame', t: 10, id: 1, calibrated: true, missing: [],
  cup: { mode: 'cup', state: 'over_dot', dot: 2, phase: 'slow', arcs_done: 1, arc_index: 2, arcs_planned: { slow: 2, fast: 2 }, expected_next: 3, dots_in_arc: [0, 1, 2], reaches_total: 10, unverified_total: 1, awaiting_phase: false, finished: false, arc_means_ms: [1500], cup_mm: [100, 100, 60], hand_clear: false },
  overlay: { dots_px: [], cup_px: [10, 10], expected_next: 3, markers_px: {} },
  hand: { present: false }, models: { hand: true }, proc_ms: 12,
}

const send = vi.fn()
function mockStream(events: Record<string, unknown>[]) {
  vi.spyOn(hook, 'useWebcamStream').mockReturnValue({
    camActive: true, connected: true, lastEvent: (events[events.length - 1] ?? null) as never,
    events: events as never, sessionId: null, error: null, start: vi.fn(async () => {}), stop: vi.fn(), endCapture: vi.fn(), send, videoRef: { current: null },
  })
}

function tree(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/session" element={<LiveCup />} />
        <Route path="/report" element={<div>REPORT PAGE</div>} />
        <Route path="/details/demo" element={<div>DEMO PAGE</div>} />
      </Routes>
    </MemoryRouter>
  )
}

function renderAt(path: string) {
  return render(tree(path))
}


const reach = (t: number, to: number, verified: boolean, reason: string | null = null, reach_ms = 1520) => ({ type: 'reach_complete', t, id: Math.round(t * 10), rep: 1, from_dot: to - 1, to_dot: to, reach_ms, verified, reason, arc: 2, phase: 'slow', t_lift: t - 2, t_placed: t - 0.5, t_clear: t })

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  send.mockClear()
})

test('shows the arc, direction, dot progress, unverified count and hand / cup tracking note', () => {
  mockStream([frame])
  renderAt('/session?exercise=cup&side=left')
  expect(screen.getByText(/arc 2 of 2 slow · across/)).toBeInTheDocument()
  const stats = screen.getByRole('region', { name: 'Progress' })
  expect(within(stats).getByRole('img', { name: '3 of 5 dots · across' })).toBeInTheDocument()
  expect(stats).toHaveTextContent('9 verified · 1 unverified')
  // the OpenCV line is a developer line (Judge view only)
  expect(screen.getByText(/OpenCV 5 · HSV cup on the warped sheet/)).toHaveClass('sx-mono')
  expect(screen.getByText(/hand not in view · cup tracked/)).toBeInTheDocument()
})

test('the band and the dots come from the real reach events; an occluded placement is unverified, not failed', () => {
  mockStream([reach(9, 2, false, 'cup_occluded'), frame])
  renderAt('/session?exercise=cup&side=left')
  expect(screen.getByText('Placement not visible · hand over the cup')).toHaveClass('sx-band-neutral')
  expect(screen.getByRole('region', { name: 'Progress' })).toHaveTextContent('Reach time 1.52 s')
})

test('a wrong dot is an amber band and the coach correction card', () => {
  mockStream([
    frame,
    { type: 'wrong_dot', t: 11, id: 20, dot: 4, expected: 3 },
    reach(11, 4, true),
    { type: 'coach', t: 11, id: 22, action: 'correct', cue_id: 'cup_wrong_dot', text: "That's dot 5; next is dot 4. One dot at a time.", reason: 'wrong dot', evidence: [20], ui: {}, label: 'Rule-based coach · LLM agent pending' },
  ])
  renderAt('/session?exercise=cup&side=left')
  expect(screen.getByText('Cup on dot 5 · expected dot 4')).toHaveClass('sx-band-amber')
  expect(screen.getByText('Coach · Correction')).toBeInTheDocument()
  expect(screen.getByText(/That's dot 5; next is dot 4/).closest('section')).toHaveClass('cup-coach-amber')
  expect(screen.getByText('Reference · listen to the coach')).toBeInTheDocument()
})

test('the reference points at the next dot from the frame', () => {
  mockStream([frame])
  renderAt('/session?exercise=cup&side=left')
  expect(screen.getByText('Reference · dot 4 is next')).toBeInTheDocument()
})

test('without a service progression prompt (the rule coach declined) no modal opens and nothing asks for the fast arcs', () => {
  sessionStorage.setItem('praxis.checkin', JSON.stringify({ pain: 3 }))
  const waiting = { ...frame, cup: { ...frame.cup, arcs_done: 2, awaiting_phase: true, arc_means_ms: [1500, 1200], expected_next: 1, dot: 0, state: 'at_dot' } }
  mockStream([reach(5, 1, false, 'cup_occluded'), reach(6, 2, false, 'cup_occluded'), waiting, { type: 'arc_complete', t: 11, id: 2, arc: 2, phase: 'slow', mean_reach_ms: 1200, unverified: 2, reaches: 8, awaiting_phase: true }])
  renderAt('/session?exercise=cup&side=left')
  expect(screen.queryByRole('dialog', { name: 'Ready to go faster?' })).toBeNull()
  expect(document.body.textContent).not.toMatch(/at most one unverified reach|prescription allows the fast arcs|decide about the fast arcs/)
  expect(send).not.toHaveBeenCalledWith({ cmd: 'set_phase', phase: 'fast' })
  // the caption goes on with the next dot instead of waiting on a question nobody asked
  expect(screen.getByText(/Reach and move the cup to dot 2/)).toBeInTheDocument()
})

const cue = (id: number, extra: Record<string, unknown> = {}) => ({ type: 'coach', t: 10, id, action: 'instruct', cue_id: 'x', text: `Cue ${id}`, reason: 'r', evidence: [], ui: {}, ...extra })

test('the service progression prompt opens the same modal, is answered with {cmd: answer} and its Why asks the coach', () => {
  const waiting = { ...frame, cup: { ...frame.cup, arcs_done: 2, awaiting_phase: true } }
  const prompt = { id: 'progression', title: 'Coach suggests: try the fast arcs', text: 'two clean slow arcs, 0 unverified', options: ['Yes, go faster', 'Keep pace', 'Why?'], within_prescription: true }
  mockStream([waiting, cue(2, { action: 'progress', label: 'Rule-based coach · LLM agent pending', ui: { prompt } })])
  renderAt('/session?exercise=cup&side=left')
  expect(screen.getAllByRole('dialog', { name: 'Ready to go faster?' })).toHaveLength(1) // no local duplicate
  fireEvent.click(screen.getByRole('button', { name: 'Why?' }))
  expect(send).toHaveBeenCalledWith({ cmd: 'answer', prompt: 'progression', choice: 'Why?' })
  expect(screen.getByRole('button', { name: 'Why?' })).toHaveAttribute('aria-expanded', 'true')
  // until the coach answers, the modal claims nothing of its own
  const dlg = screen.getByRole('dialog', { name: 'Ready to go faster?' })
  expect(dlg).toHaveTextContent('Asking the coach why…')
  expect(dlg.textContent).not.toMatch(/at most one unverified reach|prescription allows/)
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ cmd: 'set_phase' }))
  fireEvent.click(screen.getByRole('button', { name: 'Keep pace' }))
  expect(send).toHaveBeenLastCalledWith({ cmd: 'answer', prompt: 'progression', choice: 'Keep pace' })
  // declined: neither the service prompt nor the screen's own fallback comes back
  expect(screen.queryByRole('dialog', { name: 'Ready to go faster?' })).toBeNull()
})

test('completion shows the done modal from cup_complete; Finish opens the feedback form', () => {
  mockStream([frame, { type: 'cup_complete', t: 12, id: 3, arcs: 4, reaches: [{ verified: true }, { verified: true }, { verified: false }] }])
  renderAt('/session?exercise=cup&side=left')
  const dlg = screen.getByRole('dialog', { name: 'Waiter – cup, done' })
  expect(within(dlg).getByText('verified placements').previousSibling).toHaveTextContent('2')
  expect(within(dlg).getByText('unverified').previousSibling).toHaveTextContent('1')
  expect(dlg.textContent).not.toMatch(/posture/)
  fireEvent.click(within(dlg).getByRole('button', { name: 'Finish for today' }))
  expect(screen.getByRole('dialog', { name: 'How was your practice?' })).toBeInTheDocument()
})

test('with Arm out to the side still to do today, "Next exercise" goes through the feedback form', () => {
  mockStream([frame, { type: 'cup_complete', t: 12, id: 3, arcs: 4, reaches: [] }])
  renderAt('/session?exercise=cup&side=left')
  const dlg = screen.getByRole('dialog', { name: 'Waiter – cup, done' })
  expect(dlg).toHaveTextContent(/Next in today's plan: Arm out to the side/)
  fireEvent.click(within(dlg).getByRole('button', { name: 'Next exercise' }))
  expect(screen.getByRole('dialog', { name: 'How was your practice?' })).toBeInTheDocument()
})

test('replay query is passed to the stream so no webcam is opened, and the replay badge shows', () => {
  mockStream([])
  renderAt('/session?exercise=cup&side=left&replay=synthetic_cup_01')
  expect(hook.useWebcamStream).toHaveBeenCalledWith(expect.objectContaining({ replay: 'synthetic_cup_01' }))
  expect(screen.getByText('Replay · processed on the service')).toBeInTheDocument()
})

test('Show trace swaps the reference for the trace and keeps the caption, counts and coach visible', () => {
  mockStream([frame])
  renderAt('/session?exercise=cup&side=left')
  fireEvent.click(screen.getByRole('button', { name: 'Show trace' }))
  expect(screen.getAllByText(/OpenCV 5 · HSV cup on the warped sheet · cup over dot 3 · hand not clear/).length).toBe(2)
  expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Reference figure')).toBeNull()
  expect(screen.getByText('Coach')).toBeInTheDocument()
  expect(screen.getByText(/Cup on dot 3 — good/)).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Progress' })).toHaveTextContent('9 verified · 1 unverified')
})

test('an agent cue shows its label and the header shows the thinking chip', () => {
  mockStream([
    frame,
    { type: 'agent_status', t: 10, id: 2, state: 'thinking', trigger: 'arc_complete', label: 'Claude agent · Anthropic API (dev)' },
    cue(3, { source: 'agent', label: 'Claude agent · Anthropic API (dev)', text: 'Slower on the way down to dot 4.' }),
  ])
  renderAt('/session?exercise=cup&side=left')
  expect(screen.getByText('Slower on the way down to dot 4.')).toBeInTheDocument()
  expect(screen.getByText('Claude agent · Anthropic API (dev)').closest('[data-source]')).toHaveAttribute('data-source', 'agent')
  expect(screen.getByText('Coach is thinking…')).toBeInTheDocument()
})

test('a resume prompt during a setup pause shows inside the paused hold with the agent instruction', () => {
  mockStream([
    frame,
    { type: 'pause', t: 10, id: 2, rule: 'failed_reps', text: 'Three reaches in a row were not verified.' },
    cue(3, { source: 'agent', action: 'correct', label: 'Claude agent · Anthropic API (dev)', text: 'Marker 2 is covered by your sleeve. Move it clear of the sheet.' }),
    cue(4, { source: 'agent', label: 'Claude agent · Anthropic API (dev)', text: 'Setup looks good — resume?', ui: { prompt: { id: 'r1', kind: 'resume', title: 'Setup looks good — resume?', text: 'All four markers are in view again.', options: ['Yes, resume', 'Not yet'], within_prescription: true } } }),
  ])
  renderAt('/session?exercise=cup&side=left')
  const hold = screen.getByRole('alertdialog')
  expect(hold).toHaveTextContent(/Marker 2 is covered by your sleeve/)
  expect(hold).toHaveTextContent(/All four markers are in view again/)
  expect(screen.queryByRole('button', { name: 'Resume when ready' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Yes, resume' }))
  expect(send).toHaveBeenCalledWith({ cmd: 'answer', prompt: 'r1', choice: 'Yes, resume' })
})

test('caption names the dot the cup is on and the next one, like the ring', () => {
  mockStream([{ ...frame, cup: { ...frame.cup, state: 'placed' } }])
  renderAt('/session?exercise=cup&side=left')
  expect(screen.getByText(/Cup on dot 3 — good\. Let your hand come back to your lap, then reach for dot 4\./)).toBeInTheDocument()
})

test('none of the preview-only cup features: no trunk lean, start mark, watch-once, between-set rest; nothing stored locally', () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  mockStream([frame, { type: 'cup_complete', t: 12, id: 3, arcs: 4, reaches: [] }])
  renderAt('/session?exercise=cup&side=left')
  expect(document.body.textContent).not.toMatch(/trunk lean|start mark|Watch once|Your turn in|I'm ready|sped up|Preview controls/i)
  expect(setItem.mock.calls.some(([k]) => k === 'praxis.cupRun')).toBe(false)
  setItem.mockRestore()
})

test('completion, first lift and slow-arc facts hold after the one-off events leave the 200-event window', () => {
  sessionStorage.setItem('praxis.checkin', JSON.stringify({ pain: 2 }))
  const T0 = 1_790_000_000 // live frames carry epoch seconds
  const first = { ...reach(T0 + 5, 1, true), t_lift: T0 + 2 }
  const done = { type: 'cup_complete', t: T0 + 95, id: 900, arcs: 4, reaches: [{ verified: true }, { verified: true }, { verified: false }] }
  const fin = (t: number, id: number) => ({ ...frame, t, id, cup: { ...frame.cup, finished: true, arcs_done: 4, phase: 'fast', expected_next: null } })
  const all: Record<string, unknown>[] = [first, reach(T0 + 9, 2, false, 'cup_occluded'), done, fin(T0 + 95, 901)]
  mockStream([...all])
  const view = renderAt('/session?exercise=cup&side=left')
  expect(screen.getByRole('dialog', { name: 'Waiter – cup, done' })).toHaveTextContent('1:33')
  // ~20 s of frames after completion: the window now holds frames only
  for (let i = 0; i < 250; i++) {
    all.push(fin(T0 + 95 + (i + 1) * 0.08, 1000 + i))
    mockStream(all.slice(-200))
    view.rerender(tree('/session?exercise=cup&side=left'))
  }
  const dlg = screen.getByRole('dialog', { name: 'Waiter – cup, done' })
  expect(within(dlg).getByText('verified placements').previousSibling).toHaveTextContent('2')
  expect(within(dlg).getByText('unverified').previousSibling).toHaveTextContent('1')
  // active time runs from the first lift to the completion, never the epoch clock
  expect(within(dlg).getByText('active time').previousSibling).toHaveTextContent('1:33')
  // so End is never offered over a finished exercise as "ended early"
  fireEvent.click(within(dlg).getByRole('button', { name: 'Finish for today' }))
  expect(screen.getByRole('dialog', { name: 'How was your practice?' })).toBeInTheDocument()
})

test('the arc direction and the dots of the current arc survive the window', () => {
  const T0 = 1_790_000_000
  const all: Record<string, unknown>[] = [
    { type: 'arc_complete', t: T0, id: 1, arc: 1, phase: 'slow', mean_reach_ms: 1500, unverified: 0, reaches: 8, awaiting_phase: false },
    ...[1, 2, 3].map((k, i) => ({ ...reach(T0 + 5 + i * 3, k, k !== 2, k === 2 ? 'cup_occluded' : null), id: 10 + i })),
    { ...reach(T0 + 20, 4, true), id: 20 },
  ]
  const fr = (t: number, id: number) => ({ ...frame, t, id, cup: { ...frame.cup, state: 'at_dot', dot: 4, expected_next: 3, dots_in_arc: [0, 1, 2, 3, 4] } })
  all.push(fr(T0 + 21, 30))
  mockStream([...all])
  const view = renderAt('/session?exercise=cup&side=left')
  expect(screen.getByText(/arc 2 of 2 slow · back/)).toBeInTheDocument()
  for (let i = 0; i < 230; i++) {
    all.push(fr(T0 + 21 + i * 0.08, 100 + i))
    mockStream(all.slice(-200))
    view.rerender(tree('/session?exercise=cup&side=left'))
  }
  expect(screen.getByText(/arc 2 of 2 slow · back/)).toBeInTheDocument()
  // dot 3 (index 2) was an occluded placement: still amber, not done
  expect(screen.getByRole('region', { name: 'Progress' }).querySelectorAll('.sx-d-amber').length).toBe(1)
})

test('ending from a stop rule records the stop rule as the end reason, never null', () => {
  mockStream([frame, { type: 'stop', t: 12, id: 50, rule: 'exertion', text: 'Sustained high exertion. Session ended and saved.' }])
  renderAt('/session?exercise=cup&side=left')
  fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ cmd: 'feedback', ended_early: true, end_reason: 'stop:exertion' }))
})

test('a replay whose last arc never completes moves to the feedback when the recording ends, with honest copy', () => {
  mockStream([frame, { type: 'replay_end', t: 31, id: 90, clip: 'synthetic_cup_01', frames: 310 }])
  renderAt('/session?exercise=cup&side=left&replay=synthetic_cup_01')
  const dlg = screen.getByRole('dialog', { name: 'How was your practice?' })
  expect(dlg).toHaveTextContent('The recording has ended.')
  expect(dlg).not.toHaveTextContent(/ended early|What got in the way/)
  fireEvent.click(within(dlg).getByRole('button', { name: 'Skip' }))
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ cmd: 'feedback', ended_early: false, end_reason: 'replay_end' }))
})

test('a replay that completed keeps its done modal when the recording ends; nothing finishes twice', () => {
  mockStream([frame, { type: 'cup_complete', t: 12, id: 3, arcs: 4, reaches: [] }, { type: 'replay_end', t: 31, id: 90, clip: 'synthetic_cup_01', frames: 310 }])
  renderAt('/session?exercise=cup&side=left&replay=synthetic_cup_01')
  expect(screen.getByRole('dialog', { name: 'Waiter – cup, done' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: 'How was your practice?' })).not.toBeInTheDocument()
})

// ---- tap-to-sample (12 Oct): a non-blue cup band ------------------------------------------
const dotsFrame = { ...frame, overlay: { ...frame.overlay, dots_px: [[100, 300], [200, 200], [320, 150], [440, 200], [540, 300]] } }

test('"Cup not found?" enters sample mode; a tap on the mirrored picture sends the point in frame pixels', () => {
  mockStream([dotsFrame])
  renderAt('/session?exercise=cup&side=left')
  fireEvent.click(screen.getByRole('button', { name: 'Cup not found? Tap the cup base on the picture' }))
  const layer = screen.getByRole('button', { name: 'Camera picture: tap the cup base. Press Enter to use the cup on dot 3. Escape cancels.' })
  expect(layer).toHaveFocus()
  expect(screen.getByText('Tap the cup base on the picture · Esc to cancel', { selector: '.sx-band' })).toHaveClass('sx-band-amber')
  expect(document.querySelector('.sx-feed [role="status"].sr-only')).toHaveTextContent('Tap the cup base on the picture')
  const pic = document.querySelector('.sx-frame') as HTMLElement
  pic.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) })
  fireEvent.click(layer, { detail: 1, clientX: 80, clientY: 60 })
  expect(send).toHaveBeenCalledWith({ cmd: 'sample_colour', x_px: 576, y_px: 48 })
  expect(screen.queryByRole('button', { name: /Camera picture/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cup not found? Tap the cup base on the picture' })).toHaveFocus()
  expect(screen.getByText('Checking that colour…', { selector: '.sx-band' })).toBeInTheDocument()
})

test('keyboard: Enter on the picture samples the cup on its dot; Escape cancels without sending', () => {
  mockStream([dotsFrame])
  renderAt('/session?exercise=cup&side=left')
  fireEvent.click(screen.getByRole('button', { name: /^Cup not found\?/ }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('button', { name: /Camera picture/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^Cup not found\?/ })).toHaveFocus()
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ cmd: 'sample_colour' }))
  fireEvent.click(screen.getByRole('button', { name: /^Cup not found\?/ }))
  fireEvent.click(screen.getByRole('button', { name: /Camera picture/ }), { detail: 0 })
  expect(send).toHaveBeenCalledWith({ cmd: 'sample_colour', x_px: 320, y_px: 150 })
})

test("the service's answer is the feed band and the status line; a refusal says why", () => {
  mockStream([dotsFrame])
  const { rerender } = renderAt('/session?exercise=cup&side=left')
  fireEvent.click(screen.getByRole('button', { name: /^Cup not found\?/ }))
  fireEvent.click(screen.getByRole('button', { name: /Camera picture/ }), { detail: 0 })
  const refused = "That spot has almost no colour, so it can't be told apart from the sheet (black, grey and white can't be tracked). Tap the coloured part of the cup base, or use a cup with the blue tape ring."
  mockStream([dotsFrame, { type: 'command', t: 11, id: 7, cmd: 'sample_colour', ok: false, applied: false, reason: 'no_colour', message: refused }])
  rerender(tree('/session?exercise=cup&side=left'))
  expect(screen.getByText(refused, { selector: '.sx-band' })).toHaveClass('sx-band-amber')
  expect(document.querySelector('.sx-feed [role="status"].sr-only')).toHaveTextContent('almost no colour')
  mockStream([dotsFrame, { type: 'command', t: 12, id: 9, cmd: 'sample_colour', ok: true, applied: true, detected: true, message: 'Cup colour set. I can see the cup now.' }])
  rerender(tree('/session?exercise=cup&side=left'))
  expect(screen.getByText('Cup colour set. I can see the cup now.', { selector: '.sx-band' })).toHaveClass('sx-band-mint')
})

test('no tap-to-sample in a replay', () => {
  mockStream([dotsFrame])
  renderAt('/session?exercise=cup&side=left&replay=synthetic_cup_01')
  expect(screen.queryByRole('button', { name: /^Cup not found\?/ })).not.toBeInTheDocument()
})

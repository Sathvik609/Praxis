import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
vi.mock('../../avatar/AvatarScene', () => ({ AvatarScene: () => <div data-testid="scene" /> }))

import * as hook from '../../session/useWebcamStream'
import { LiveCup } from './LiveCup'

const frame = {
  type: 'frame', t: 10, id: 1, calibrated: true, missing: [],
  cup: { mode: 'cup', state: 'over_dot', dot: 2, phase: 'slow', arcs_done: 1, arc_index: 2, arcs_planned: { slow: 2, fast: 2 }, expected_next: 3, dots_in_arc: [0, 1, 2], reaches_total: 10, unverified_total: 1, awaiting_phase: false, finished: false, cup_mm: [100, 100, 60], hand_clear: false },
  overlay: { dots_px: [], cup_px: [10, 10], expected_next: 3, markers_px: {} },
  hand: { present: false }, models: { hand: true }, proc_ms: 12,
}

const send = vi.fn()
function mockStream(events: Record<string, unknown>[]) {
  vi.spyOn(hook, 'useWebcamStream').mockReturnValue({
    camActive: true, connected: true, lastEvent: (events[events.length - 1] ?? null) as never,
    events: events as never, error: null, start: vi.fn(async () => {}), stop: vi.fn(), send, videoRef: { current: null },
  })
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/session" element={<LiveCup />} />
        <Route path="/report" element={<div>REPORT PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('shows arc label, dot progress, unverified count and hand-clear caption', () => {
  mockStream([frame])
  renderAt('/session?exercise=cup&side=left')
  expect(screen.getByText(/arc 2 of 2 slow/)).toBeInTheDocument()
  // the dot row shows where the cup is, from the same snapshot as the ring on the video
  expect(screen.getByLabelText('Cup on dot 3, next dot 4')).toBeInTheDocument()
  expect(screen.queryByLabelText('3 of 5')).toBeNull()
  expect(screen.getAllByText(/1 unverified/).length).toBeGreaterThan(0)
  // developer lines are not on the patient's screen until the trace is open
  expect(screen.queryByText(/cv2 5.0/)).toBeNull()
  expect(screen.getByText(/hand not in view · cup tracked/)).toBeInTheDocument()
})

test('"This session" shows reaches, verified and unverified as separate numbers', () => {
  mockStream([frame])
  renderAt('/session?exercise=cup&side=left')
  expect(screen.getByRole('heading', { name: 'This session' })).toBeInTheDocument()
  expect(screen.getByLabelText('Verified and unverified counts')).toBeInTheDocument()
  const value = (label: string) => screen.getByText(label).parentElement?.parentElement?.firstElementChild
  expect(value('reaches')).toHaveTextContent('10')
  expect(value('verified')).toHaveTextContent('9')
  expect(value('unverified')).toHaveTextContent('1')
})

test('progression prompt appears on top when awaiting phase and sends the command', () => {
  const waiting = { ...frame, cup: { ...frame.cup, arcs_done: 2, awaiting_phase: true } }
  mockStream([waiting, { type: 'arc_complete', t: 11, id: 2, arc: 2, phase: 'slow', mean_reach_ms: 1200, unverified: 0, awaiting_phase: true }])
  renderAt('/session?exercise=cup&side=left')
  expect(screen.getByText(/Coach suggests: try the fast arcs/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Yes, go faster' }))
  expect(send).toHaveBeenCalledWith({ cmd: 'set_phase', phase: 'fast' })
})

test('completion opens the feedback overlay', () => {
  mockStream([frame, { type: 'cup_complete', t: 12, id: 3, arcs: 4, reaches: [] }])
  renderAt('/session?exercise=cup&side=left')
  expect(screen.getByRole('heading', { name: 'How was your practice?' })).toBeInTheDocument()
})

test('replay query is passed to the stream so no webcam is opened, and the replay badge shows', () => {
  mockStream([])
  renderAt('/session?exercise=cup&side=left&replay=synthetic_cup_01')
  expect(hook.useWebcamStream).toHaveBeenCalledWith(expect.objectContaining({ replay: 'synthetic_cup_01' }))
  expect(screen.getByText('Replay · processed on the service')).toBeInTheDocument()
})

test('Show trace reveals the OpenCV line and keeps the caption, counts and coach visible', () => {
  mockStream([frame])
  renderAt('/session?exercise=cup&side=left')
  fireEvent.click(screen.getByRole('button', { name: 'Show trace' }))
  expect(screen.getByText(/cv2 5.0 · HSV cup on the warped sheet · cup over dot 3 · hand not clear/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeInTheDocument()
  expect(screen.getByText('Coach')).toBeInTheDocument()
  expect(screen.getByText(/Cup on dot 3 — good/)).toBeInTheDocument()
  expect(screen.getByLabelText('Verified and unverified counts')).toHaveTextContent(/9 verified · 1 unverified/)
})

const cue = (id: number, extra: Record<string, unknown> = {}) => ({ type: 'coach', t: 10, id, action: 'instruct', cue_id: 'x', text: `Cue ${id}`, reason: 'r', evidence: [], ui: {}, ...extra })

test('the service progression prompt is answered with {cmd: answer} and its Why asks the coach', () => {
  send.mockClear()
  const waiting = { ...frame, cup: { ...frame.cup, arcs_done: 2, awaiting_phase: true } }
  const prompt = { id: 'progression', title: 'Coach suggests: try the fast arcs', text: 'Two clean slow arcs.', options: ['Yes, go faster', 'Keep pace', 'Why?'], within_prescription: true }
  mockStream([waiting, cue(2, { action: 'progress', label: 'Rule-based coach · LLM agent pending', ui: { prompt } })])
  renderAt('/session?exercise=cup&side=left')
  expect(screen.getAllByText(/Coach suggests: try the fast arcs/)).toHaveLength(1) // no local duplicate
  fireEvent.click(screen.getByRole('button', { name: 'Why?' }))
  expect(send).toHaveBeenCalledWith({ cmd: 'answer', prompt: 'progression', choice: 'Why?' })
  expect(screen.getByRole('button', { name: 'Why?' })).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Keep pace' }))
  expect(send).toHaveBeenLastCalledWith({ cmd: 'answer', prompt: 'progression', choice: 'Keep pace' })
  // declined: neither the service prompt nor the screen's own fallback comes back
  expect(screen.queryByText(/Coach suggests: try the fast arcs/)).toBeNull()
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

test('a resume prompt during a setup pause shows inside the paused overlay with the agent instruction', () => {
  send.mockClear()
  mockStream([
    frame,
    { type: 'pause', t: 10, id: 2, rule: 'failed_reps', text: 'Three reaches in a row were not verified.' },
    cue(3, { source: 'agent', action: 'correct', label: 'Claude agent · Anthropic API (dev)', text: 'Marker 2 is covered by your sleeve. Move it clear of the sheet.' }),
    cue(4, { source: 'agent', label: 'Claude agent · Anthropic API (dev)', text: 'Setup looks good — resume?', ui: { prompt: { id: 'r1', kind: 'resume', title: 'Setup looks good — resume?', text: 'All four markers are in view again.', options: ['Yes, resume', 'Not yet'], within_prescription: true } } }),
  ])
  renderAt('/session?exercise=cup&side=left')
  const dialog = screen.getByRole('dialog')
  expect(dialog).toHaveTextContent(/Marker 2 is covered by your sleeve/)
  expect(dialog).toHaveTextContent(/All four markers are in view again/)
  expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Yes, resume' }))
  expect(send).toHaveBeenCalledWith({ cmd: 'answer', prompt: 'r1', choice: 'Yes, resume' })
})

test('caption names the dot the cup is on and the next one, like the ring', () => {
  mockStream([{ ...frame, cup: { ...frame.cup, state: 'placed' } }])
  renderAt('/session?exercise=cup&side=left')
  expect(screen.getByText(/Cup on dot 3 — good\. Let your hand come back to your lap, then reach for dot 4\./)).toBeInTheDocument()
})

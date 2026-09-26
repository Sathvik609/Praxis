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

test('caption names the dot the cup is on and the next one, like the ring', () => {
  mockStream([{ ...frame, cup: { ...frame.cup, state: 'placed' } }])
  renderAt('/session?exercise=cup&side=left')
  expect(screen.getByText(/Cup on dot 3 — good\. Let your hand come back to your lap, then reach for dot 4\./)).toBeInTheDocument()
})

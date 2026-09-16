import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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
  expect(screen.getByLabelText('3 of 5')).toBeInTheDocument()
  expect(screen.getAllByText(/1 unverified/).length).toBeGreaterThan(0)
  expect(screen.getByText(/cup over dot 3 · hand not clear/)).toBeInTheDocument()
})

test('progression prompt appears when awaiting phase and sends the command', () => {
  const waiting = { ...frame, cup: { ...frame.cup, arcs_done: 2, awaiting_phase: true } }
  mockStream([waiting, { type: 'arc_complete', t: 11, id: 2, arc: 2, phase: 'slow', mean_reach_ms: 1200, unverified: 0, awaiting_phase: true }])
  renderAt('/session?exercise=cup&side=left')
  expect(screen.getByText(/Coach suggests: try the fast arcs/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Yes, go faster' }))
  expect(send).toHaveBeenCalledWith({ cmd: 'set_phase', phase: 'fast' })
})

test('completion navigates to the report', () => {
  mockStream([frame, { type: 'cup_complete', t: 12, id: 3, arcs: 4, reaches: [] }])
  renderAt('/session?exercise=cup&side=left')
  expect(screen.getByText('REPORT PAGE')).toBeInTheDocument()
})

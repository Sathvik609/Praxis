import { fireEvent, render, screen } from '@testing-library/react'
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

function mockStream(events: Record<string, unknown>[]) {
  vi.spyOn(hook, 'useWebcamStream').mockReturnValue({
    camActive: true,
    connected: true,
    lastEvent: (events[events.length - 1] ?? null) as never,
    events: events as never,
    error: null,
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    send: vi.fn(),
    videoRef: { current: null },
  })
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
  expect(screen.getByText('24.8')).toBeInTheDocument()
  expect(screen.getByLabelText('5 of 9')).toBeInTheDocument()
  expect(screen.getByText(/next: hole 6/)).toBeInTheDocument()
  expect(screen.getByText('Tracking')).toBeInTheDocument()
  expect(screen.getByText('Nine-Hole Peg Test · left hand')).toBeInTheDocument()
  expect(screen.getByText('Live · not recording')).toBeInTheDocument()
  expect(screen.getByText(/Rule-based coach · LLM agent pending/)).toBeInTheDocument()
})

test('reference toggle is a segmented control: Board view by default, Avatar on demand', () => {
  mockStream([frame])
  renderAt('/session?hand=left')
  const board = screen.getByRole('radio', { name: 'Board view' })
  const avatar = screen.getByRole('radio', { name: 'Avatar' })
  expect(board).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByLabelText('board view')).toBeInTheDocument()
  fireEvent.click(avatar)
  expect(screen.queryByLabelText('board view')).toBeNull()
  expect(screen.getByTestId('scene')).toBeInTheDocument()
})

test('tracking lost badge after perception_lost', () => {
  mockStream([frame, { type: 'perception_lost', t: 11, id: 2, missing: [1] }])
  renderAt('/session?hand=left')
  expect(screen.getByText('Tracking lost')).toBeInTheDocument()
})

test('replay shows the corner badge instead of the old placeholder sentence and no red live text', () => {
  mockStream([frame])
  renderAt('/session?hand=left&replay=synthetic_nhpt_01')
  expect(screen.getByText('Replay · processed on the service')).toBeInTheDocument()
  expect(screen.queryByText(/recorded clip runs on the service/)).toBeNull()
  expect(screen.queryByText('Live · not recording')).toBeNull()
  expect(screen.getByRole('status')).toHaveTextContent('Replay')
})

test('trace toggle swaps the coach column for the trace panel', () => {
  mockStream([frame, { type: 'rep_complete', t: 11, id: 2, peg: 1 }])
  renderAt('/session?hand=left')
  fireEvent.click(screen.getByRole('button', { name: 'Show trace' }))
  expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeInTheDocument()
  expect(screen.queryByText(/Rule-based coach · LLM agent pending\.?$/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Hide trace' }))
  expect(screen.queryByRole('button', { name: 'Copy JSON' })).toBeNull()
})

test('navigates to the report when the test completes', () => {
  mockStream([frame, { type: 'nhpt_complete', t: 12, id: 3, total_s: 41.2, splits_s: [4, 5], pegs: [] }])
  renderAt('/session?hand=left')
  expect(screen.getByRole('heading', { name: 'How was your practice?' })).toBeInTheDocument()
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

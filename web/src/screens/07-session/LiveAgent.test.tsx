import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
vi.mock('../../avatar/AvatarScene', () => ({ AvatarScene: () => <div data-testid="scene" /> }))

import * as hook from '../../session/useWebcamStream'
import { mockApi, PRESCRIPTION } from '../../test/api-mock'
import { LiveArm } from './LiveArm'
import { LiveNhpt } from './LiveNhpt'

/** Agent coach UI on the arm and peg-test screens (the cup screen's cases live in LiveCup.test). */

const armFrame = {
  type: 'frame', t: 10, id: 1, calibrated: true, missing: [],
  arm: { mode: 'arm', state: 'start_pose', set: 2, rep: 0, sets: 2, reps_per_set: 8, target_deg: 90, ceiling_deg: 90, clamped: false, hold_s: 3, hold_progress: 0, angle_now: 10, peak_this_rep: 10, best_this_set: 0, trunk_lean_deg: 2, reps_total: 8, unverified_total: 0, flags: { lean: false, lean_count: 0, hike_count: 0 }, finished: false, angles: { shoulder_deg: 10, elbow_deg: 170, trunk_lean_deg: 2, shoulder_hike_norm: 0.01, view_ok: true, visibility: 0.9 } },
  pose: { present: true, landmarks_px: [], visibility: [], conf: 0.9, ms: 8 },
  overlay: { skeleton_px: [], shoulder_px: [300, 200], ghost_target_px: [200, 200], markers_px: {} },
  hand: { present: false }, models: { hand: false, pose: true }, proc_ms: 20,
}
const nhptFrame = {
  type: 'frame', t: 10, id: 1, calibrated: true, missing: [],
  nhpt: { mode: 'nhpt', state: 'in_transit', target: null, reps: 5, finished: false, started: true, completed: false, pegs_done: 5, elapsed_s: 24.8, total_s: null },
  board: { occupancy: {}, hole_source: 'hough', free_pegs_mm: [] },
  overlay: { holes_px: [], target: null, next_hole: 5, markers_px: {} },
}
const AGENT = 'Claude agent · Anthropic API (dev)'
const cue = (id: number, extra: Record<string, unknown> = {}) => ({ type: 'coach', t: 11, id, action: 'instruct', cue_id: 'x', text: `Cue ${id}`, reason: 'r', evidence: [], ui: {}, ...extra })

const send = vi.fn()
function mockStream(events: Record<string, unknown>[]) {
  vi.spyOn(hook, 'useWebcamStream').mockReturnValue({
    camActive: true, connected: true, lastEvent: (events[events.length - 1] ?? null) as never,
    events: events as never, error: null, start: vi.fn(async () => {}), stop: vi.fn(), send, videoRef: { current: null },
  })
}

function renderAt(path: string, el: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/session" element={el} />
        <Route path="/report" element={<div>REPORT PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  send.mockClear()
  mockApi({ '/api/prescription': PRESCRIPTION })
})

test('arm: an agent dose adjustment reads in plain words and the patient answers it; reps keep counting', async () => {
  const prompt = {
    id: 'a1', kind: 'adjustment', title: 'Coach suggests: a lower target for set 2', text: 'Your peaks fell across set 1 and exertion is moderate.',
    options: ['Yes, lower it', 'Keep 90°', 'Why?'], within_prescription: true,
    proposal: { exercise: 'abduction', field: 'target_deg', value: 60, requested: 50, clamped: true, unit: '°' },
  }
  mockStream([armFrame, cue(2, { action: 'regress', source: 'agent', label: AGENT, text: 'Try a lower target for set 2?', ui: { prompt } })])
  renderAt('/session?exercise=abduction&side=left', <LiveArm />)
  expect(await screen.findByText(/Target 90° → 60° \(your program allows 60–90°\) · adjusted to your program’s limit/)).toBeInTheDocument()
  expect(screen.getByText('Within your prescription')).toBeInTheDocument()
  // not modal: the session is not paused, the rep card is still there
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByText(/Rep 1 of 8/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Yes, lower it' }))
  expect(send).toHaveBeenCalledWith({ cmd: 'answer', prompt: 'a1', choice: 'Yes, lower it' })
  expect(screen.queryByText(/Coach suggests: a lower target/)).toBeNull()
})

test('arm: agent cue label and icon, offline chip with its reason', () => {
  mockStream([
    armFrame,
    cue(2, { source: 'agent', label: AGENT, text: 'Lift from the shoulder, not the trunk.' }),
    { type: 'agent_status', t: 12, id: 3, state: 'offline', reason: 'model timeout after 15 s', label: 'Rule-based coach' },
  ])
  renderAt('/session?exercise=abduction&side=left', <LiveArm />)
  expect(screen.getByText(AGENT).closest('[data-source]')).toHaveAttribute('data-source', 'agent')
  const chip = screen.getByText('Coach offline · rule coach')
  expect(chip.closest('[title]')).toHaveAttribute('title', 'model timeout after 15 s')
})

test('arm: a rule cue with the agent on reads "Rule-based coach"', () => {
  mockStream([armFrame, cue(2, { source: 'rule', label: 'Rule-based coach', text: 'Arm by your side.' })])
  renderAt('/session?exercise=abduction&side=left', <LiveArm />)
  expect(screen.getByText('Rule-based coach').closest('[data-source]')).toHaveAttribute('data-source', 'rule')
  expect(screen.queryByText(/Coach is thinking/)).toBeNull()
})

test('peg test: legacy cue without source keeps its pending label; the agent chip shows while thinking', () => {
  mockStream([
    nhptFrame,
    cue(2, { label: 'Rule-based coach · LLM agent pending', text: 'Next peg, nice and steady.' }),
    { type: 'agent_status', t: 12, id: 3, state: 'thinking', trigger: 'nhpt_complete', label: AGENT },
  ])
  renderAt('/session?hand=left', <LiveNhpt />)
  expect(screen.getByText('Rule-based coach · LLM agent pending').closest('[data-source]')).toHaveAttribute('data-source', 'rule')
  expect(screen.getByTestId('agent-status')).toHaveTextContent('Coach is thinking…')
})

test('peg test: a resume request after tracking loss is answered from the paused overlay', () => {
  mockStream([
    nhptFrame,
    { type: 'pause', t: 11, id: 2, rule: 'perception', text: 'I lost the board.' },
    cue(3, { source: 'agent', label: AGENT, ui: { prompt: { id: 'r2', kind: 'resume', title: 'Setup looks good — resume?', text: '', options: ['Yes, resume', 'Not yet'], within_prescription: true } } }),
  ])
  renderAt('/session?hand=left', <LiveNhpt />)
  fireEvent.click(screen.getByRole('button', { name: 'Not yet' }))
  expect(send).toHaveBeenCalledWith({ cmd: 'answer', prompt: 'r2', choice: 'Not yet' })
  // declined: the overlay's own Resume is back for when the patient is ready
  expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
})

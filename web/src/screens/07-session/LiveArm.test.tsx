import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
vi.mock('../../avatar/AvatarScene', () => ({ AvatarScene: () => <div data-testid="scene" /> }))

import * as hook from '../../session/useWebcamStream'
import { LiveArm } from './LiveArm'

const frame = {
  type: 'frame', t: 10, id: 1, calibrated: true, missing: [],
  arm: { mode: 'arm', state: 'hold', set: 1, rep: 4, sets: 2, reps_per_set: 8, target_deg: 90, ceiling_deg: 90, clamped: false, hold_s: 3, hold_progress: 0.5, angle_now: 72, peak_this_rep: 80, best_this_set: 88, trunk_lean_deg: 9, reps_total: 4, unverified_total: 0, flags: { lean: false, lean_count: 0, hike_count: 0 }, finished: false, angles: { shoulder_deg: 72, elbow_deg: 170, trunk_lean_deg: 9, shoulder_hike_norm: 0.01, view_ok: true, visibility: 0.9 } },
  pose: { present: true, landmarks_px: [], visibility: [], conf: 0.9, ms: 8 },
  overlay: { skeleton_px: [], shoulder_px: [300, 200], ghost_target_px: [200, 200], markers_px: {} },
  hand: { present: false }, models: { hand: false, pose: true }, proc_ms: 20,
}

function mockStream(events: Record<string, unknown>[]) {
  vi.spyOn(hook, 'useWebcamStream').mockReturnValue({
    camActive: true, connected: true, lastEvent: (events[events.length - 1] ?? null) as never,
    events: events as never, error: null, start: vi.fn(async () => {}), stop: vi.fn(), send: vi.fn(), videoRef: { current: null },
  })
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/session" element={<LiveArm />} />
        <Route path="/report" element={<div>REPORT PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('shows set, rep, angle tiles and the shoulder band in the feed (not over the video)', () => {
  mockStream([frame])
  renderAt('/session?exercise=arm&side=left')
  expect(screen.getByText(/set 1 of 2/)).toBeInTheDocument()
  expect(screen.getByText(/Rep 5 of 8/)).toBeInTheDocument()
  expect(screen.getByText('72°')).toBeInTheDocument()
  expect(screen.getByText('88°')).toBeInTheDocument()
  const band = screen.getByText(/Shoulder 72° · target 90° · ceiling 90°/)
  expect(band.className).toMatch(/tabular-nums/)
  expect(band.className).not.toMatch(/text-amber/)
  expect(screen.getByText('9°')).toBeInTheDocument()
  expect(screen.queryByText('(leaning)')).toBeNull()
})

test('trunk lean over 12° is amber and says "(leaning)" so colour is never alone', () => {
  mockStream([{ ...frame, arm: { ...frame.arm, trunk_lean_deg: -15 } }])
  renderAt('/session?exercise=arm&side=left')
  const lean = screen.getByText('15°')
  expect(lean.className).toMatch(/text-amber-ink/)
  expect(screen.getByText('(leaning)')).toBeInTheDocument()
})

test('posture cue appears after a compensation_lean event in the watch tone', () => {
  mockStream([frame, { type: 'compensation_lean', t: 11, id: 2, lean_deg: 15, count: 1, flagged: false }])
  renderAt('/session?exercise=arm&side=left')
  expect(screen.getByText(/Sit tall/)).toBeInTheDocument()
  expect(screen.getByText('Coach · posture')).toBeInTheDocument()
  expect(screen.getByText(/Sit tall/).closest('section')?.className).toMatch(/border-l-amber-ink/)
})

test('completion opens the feedback overlay', () => {
  mockStream([frame, { type: 'arm_complete', t: 12, id: 3, sets: 2, reps: 16 }])
  renderAt('/session?exercise=arm&side=left')
  expect(screen.getByRole('heading', { name: 'How was your practice?' })).toBeInTheDocument()
})

test('Arm to the front sends the flexion registry id and the tier from the check-in', () => {
  sessionStorage.setItem('praxis.checkin', JSON.stringify({ pain: 5 }))
  mockStream([frame])
  renderAt('/session?exercise=arm&side=left')
  expect(hook.useWebcamStream).toHaveBeenCalledWith(expect.objectContaining({ mode: 'arm', params: expect.objectContaining({ exercise: 'flexion', tier: 'gentle', side: 'left' }) }))
  sessionStorage.clear()
})

test('Arm out to the side runs the same screen from the front view with its own name', () => {
  mockStream([{ ...frame, arm: { ...frame.arm, exercise: 'abduction', view_required: 'front', angles: { ...frame.arm.angles, view_ok: false } } }])
  renderAt('/session?exercise=abduction&side=left')
  expect(hook.useWebcamStream).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ exercise: 'abduction', tier: 'full' }) }))
  expect(screen.getByText('Arm out to the side · left side')).toBeInTheDocument()
  expect(screen.getByText(/front view · shoulder 72° of 90°/)).toBeInTheDocument()
})

test('Pendulum counts swings: no hold count, no lift/lower labels', () => {
  mockStream([{ ...frame, arm: { ...frame.arm, exercise: 'pendulum', kind: 'oscillation', state: 'moving', hold_s: 0, target_deg: 20, ceiling_deg: 45, reps_per_set: 10, rep: 3 } }])
  renderAt('/session?exercise=pendulum&side=left')
  expect(screen.getByText('Pendulum · left side')).toBeInTheDocument()
  expect(screen.getByText(/Swing 4 of 10/)).toBeInTheDocument()
  expect(screen.queryByText('Lift for 3')).toBeNull()
})

test('replay query is passed to the stream so no webcam is opened', () => {
  mockStream([])
  renderAt('/session?exercise=arm&side=left&replay=synthetic_arm_01')
  expect(hook.useWebcamStream).toHaveBeenCalledWith(expect.objectContaining({ replay: 'synthetic_arm_01' }))
  expect(screen.getByText('Replay · processed on the service')).toBeInTheDocument()
})

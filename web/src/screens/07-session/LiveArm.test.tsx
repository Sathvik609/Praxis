import { fireEvent, render, screen } from '@testing-library/react'
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
    events: events as never, sessionId: null, error: null, start: vi.fn(async () => {}), stop: vi.fn(), send: vi.fn(), videoRef: { current: null },
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
  renderAt('/session?exercise=abduction&side=left')
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
  renderAt('/session?exercise=abduction&side=left')
  const lean = screen.getByText('15°')
  expect(lean.className).toMatch(/text-amber-ink/)
  expect(screen.getByText('(leaning)')).toBeInTheDocument()
})

test('posture cue appears after a compensation_lean event in the watch tone', () => {
  mockStream([frame, { type: 'compensation_lean', t: 11, id: 2, lean_deg: 15, count: 1, flagged: false }])
  renderAt('/session?exercise=abduction&side=left')
  expect(screen.getByText(/Sit tall/)).toBeInTheDocument()
  expect(screen.getByText('Coach · posture')).toBeInTheDocument()
  expect(screen.getByText(/Sit tall/).closest('section')?.className).toMatch(/border-l-amber-ink/)
})

test('completion opens the feedback overlay', () => {
  mockStream([frame, { type: 'arm_complete', t: 12, id: 3, sets: 2, reps: 16 }])
  renderAt('/session?exercise=abduction&side=left')
  expect(screen.getByRole('dialog', { name: 'How was your practice?' })).toBeInTheDocument()
})

test('Arm out to the side sends the abduction registry id and the tier from the check-in', () => {
  sessionStorage.setItem('praxis.checkin', JSON.stringify({ pain: 5 }))
  mockStream([frame])
  renderAt('/session?exercise=abduction&side=left')
  expect(hook.useWebcamStream).toHaveBeenCalledWith(expect.objectContaining({ mode: 'arm', params: expect.objectContaining({ exercise: 'abduction', tier: 'gentle', side: 'left' }) }))
  sessionStorage.clear()
})

test('Arm out to the side runs the same screen from the front view with its own name', () => {
  mockStream([{ ...frame, arm: { ...frame.arm, exercise: 'abduction', view_required: 'front', angles: { ...frame.arm.angles, view_ok: false } } }])
  renderAt('/session?exercise=abduction&side=left')
  expect(hook.useWebcamStream).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ exercise: 'abduction', tier: 'full' }) }))
  expect(screen.getByText('Arm out to the side · left side')).toBeInTheDocument()
  expect(screen.getByText(/front view · shoulder 72° of 90°/)).toBeInTheDocument()
})

test('front-view Arm out to the side never tells the patient to turn sideways', () => {
  const lostEv = { type: 'perception_lost', t: 11, id: 2 }
  mockStream([{ ...frame, calibrated: false, arm: { ...frame.arm, exercise: 'abduction', view_required: 'front' } }, lostEv])
  renderAt('/session?exercise=abduction&side=left')
  expect(screen.getAllByText(/Face the camera/).length).toBeGreaterThan(0)
  expect(screen.queryByText(/side to the camera/)).toBeNull()
})

test.each(['pendulum', 'arm', 'flexion', null])('a hidden or missing exercise (%s) never reaches the service: the arm screen runs Arm out to the side', (id) => {
  mockStream([{ ...frame, arm: { ...frame.arm, exercise: 'abduction', view_required: 'front' } }])
  renderAt(`/session?${id ? `exercise=${id}&` : ''}side=left`)
  expect(hook.useWebcamStream).toHaveBeenLastCalledWith(expect.objectContaining({ params: expect.objectContaining({ exercise: 'abduction' }) }))
  expect(screen.getByText('Arm out to the side · left side')).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/Pendulum|Arm to the front/)
})

test('replay query is passed to the stream so no webcam is opened', () => {
  mockStream([])
  renderAt('/session?exercise=abduction&side=left&replay=synthetic_arm_01')
  expect(hook.useWebcamStream).toHaveBeenCalledWith(expect.objectContaining({ replay: 'synthetic_arm_01' }))
  expect(screen.getByText('Replay · processed on the service')).toBeInTheDocument()
})

test('verified and unverified counts are on the live arm screen, from the camera totals', () => {
  mockStream([{ ...frame, arm: { ...frame.arm, reps_total: 4, unverified_total: 1 } }])
  renderAt('/session?exercise=abduction&side=left')
  const tally = screen.getByLabelText('Verified and unverified counts')
  expect(tally).toHaveTextContent('3 verified')
  expect(tally).toHaveTextContent('1 unverified')
  expect(tally).toHaveTextContent('4 lifts')
})

test('the pose line is a developer line under Show trace; the caption stays with the trace open', () => {
  mockStream([frame])
  renderAt('/session?exercise=abduction&side=left')
  expect(screen.queryByText(/cv2 dnn pose/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Show trace' }))
  expect(screen.getByText(/cv2 dnn pose · shoulder–elbow–hip angle/)).toBeInTheDocument()
  expect(screen.getByText('Coach')).toBeInTheDocument()
  expect(screen.getByText(/Hold it there/)).toBeInTheDocument()
})

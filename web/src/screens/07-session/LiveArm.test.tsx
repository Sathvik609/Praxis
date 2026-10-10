import { fireEvent, render, screen, within } from '@testing-library/react'
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

const armSend = vi.fn()
function mockStream(events: Record<string, unknown>[]) {
  vi.spyOn(hook, 'useWebcamStream').mockReturnValue({
    camActive: true, connected: true, lastEvent: (events[events.length - 1] ?? null) as never,
    events: events as never, sessionId: null, error: null, start: vi.fn(async () => {}), stop: vi.fn(), send: armSend, videoRef: { current: null },
  })
}

function tree(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/session" element={<LiveArm />} />
        <Route path="/report" element={<div>REPORT PAGE</div>} />
      </Routes>
    </MemoryRouter>
  )
}

function renderAt(path: string) {
  return render(tree(path))
}

test('shows set, rep, best and lean minis and the shoulder band in the feed', () => {
  mockStream([frame])
  renderAt('/session?exercise=abduction&side=left')
  expect(screen.getAllByText(/set 1 of 2/).length).toBeGreaterThan(0)
  const stats = screen.getByRole('region', { name: 'Progress' })
  expect(stats).toHaveTextContent(/Rep\s*5\s*of 8/)
  expect(screen.getByText('88°')).toBeInTheDocument()
  // feed band: angle and target; the ceiling is in the developer line (Judge view)
  const band = screen.getByText('Shoulder 72° · target 90°')
  expect(band).toHaveClass('sx-band', 'sx-band-mint') // holding
  expect(screen.getByText(/cv2 dnn pose .* ceiling 90°/)).toHaveClass('sx-mono')
  expect(screen.getByText('9°')).toBeInTheDocument()
  expect(screen.getByText('trunk lean')).toBeInTheDocument()
  expect(screen.queryByText(/leaning/)).toBeNull()
})

test('the band is amber while lifting, mint while holding', () => {
  mockStream([{ ...frame, arm: { ...frame.arm, state: 'moving' } }])
  renderAt('/session?exercise=abduction&side=left')
  expect(screen.getByText('Shoulder 72° · target 90°')).toHaveClass('sx-band-amber')
})

test('trunk lean over 12° is amber and says "leaning" so colour is never alone', () => {
  mockStream([{ ...frame, arm: { ...frame.arm, trunk_lean_deg: -15 } }])
  renderAt('/session?exercise=abduction&side=left')
  const lean = screen.getByText('15°')
  expect(lean.parentElement).toHaveClass('sx-warn')
  expect(screen.getByText('trunk lean · leaning')).toBeInTheDocument()
})

test('posture cue appears after a compensation_lean event in the watch tone; the figure dims', () => {
  mockStream([frame, { type: 'compensation_lean', t: 11, id: 2, lean_deg: 15, count: 1, flagged: false }])
  renderAt('/session?exercise=abduction&side=left')
  expect(screen.getByText(/Sit tall/)).toBeInTheDocument()
  expect(screen.getByText('Coach · posture')).toBeInTheDocument()
  expect(screen.getByText(/Sit tall/).closest('section')).toHaveClass('sx-coach-watch')
  expect(screen.getByText('Reference · listen to the coach')).toBeInTheDocument()
})

test('a lift past the ceiling shows the range cue in the watch tone, in words, and dims the figure', () => {
  mockStream([frame, { type: 'above_ceiling', t: 11, id: 2, set: 1, rep: 5, angle_deg: 101, ceiling_deg: 90 }])
  renderAt('/session?exercise=abduction&side=left')
  expect(screen.getByText(/Stop at shoulder height/)).toBeInTheDocument()
  expect(screen.getByText('Coach · range')).toBeInTheDocument()
  expect(screen.getByText(/Stop at shoulder height/).closest('section')).toHaveClass('sx-coach-watch')
  expect(screen.getByText('Reference · listen to the coach')).toBeInTheDocument()
})

test('an old above_ceiling event no longer colours the coach card', () => {
  mockStream([{ type: 'above_ceiling', t: 2, id: 2, set: 1, rep: 1, angle_deg: 101, ceiling_deg: 90 }, frame])
  renderAt('/session?exercise=abduction&side=left')
  expect(screen.queryByText(/Stop at shoulder height/)).toBeNull()
  expect(screen.queryByText('Coach · range')).toBeNull()
})

test('tracking lost dims the reference figure with its reason', () => {
  mockStream([frame, { type: 'perception_lost', t: 11, id: 2 }])
  renderAt('/session?exercise=abduction&side=left')
  expect(screen.getByText('Reference · waiting for you')).toBeInTheDocument()
})

test('the reference demonstration starts from the coach event that carries an avatar clip', () => {
  mockStream([frame])
  const { unmount } = renderAt('/session?exercise=abduction&side=left')
  expect(screen.getByText('Reference · ready')).toBeInTheDocument()
  unmount()
  mockStream([frame, { type: 'coach', t: 10.5, id: 2, action: 'instruct', cue_id: 'arm_intro', text: 'Arm out to the side.', reason: 'r', evidence: [], ui: { avatar_clip: 'abduction' } }])
  renderAt('/session?exercise=abduction&side=left')
  expect(screen.getByText('Reference · demonstration')).toBeInTheDocument()
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
  expect(screen.getByText(/ghost arm shows target/)).toBeInTheDocument()
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

test('the camera on shows "Live · not recording" in the header', () => {
  mockStream([frame])
  renderAt('/session?exercise=abduction&side=left')
  expect(screen.getByText('Live · not recording')).toBeInTheDocument()
})

test('verified and unverified counts are on the live arm screen, from the camera totals', () => {
  mockStream([{ ...frame, arm: { ...frame.arm, state: 'start_pose', reps_total: 4, unverified_total: 1 } }])
  renderAt('/session?exercise=abduction&side=left')
  const stats = screen.getByRole('region', { name: 'Progress' })
  expect(stats).toHaveTextContent('3 lifts verified')
  expect(stats).toHaveTextContent('3 verified · 1 unverified')
})

test('the unverified count stays in the stats head when exertion rises; exertion is its own labelled chip', () => {
  mockStream([
    { ...frame, arm: { ...frame.arm, reps_total: 4, unverified_total: 2 } },
    { type: 'exertion', t: 10.5, id: 2, level: 'moderate', reasons: ['rep time rising'], method: 'behavioural' },
  ])
  renderAt('/session?exercise=abduction&side=left')
  const stats = screen.getByRole('region', { name: 'Progress' })
  expect(stats.querySelector('.sx-stats-head')).toHaveTextContent('2 unverified')
  expect(stats).toHaveTextContent('Exertion: moderate')
  expect(stats).toHaveTextContent('behavioural index · rep time rising')
})

test('Show trace swaps the reference for the trace panel; the caption stays', () => {
  mockStream([frame])
  renderAt('/session?exercise=abduction&side=left')
  fireEvent.click(screen.getByRole('button', { name: 'Show trace' }))
  expect(screen.getByText(/cv2 dnn pose · shoulder–elbow–hip angle/)).toBeInTheDocument()
  expect(screen.queryByLabelText('Reference figure')).toBeNull()
  expect(screen.getByText(/Hold it there/)).toBeInTheDocument()
})

test('fixed controls: Pause sends pause, Pain opens the pain check, End asks why', () => {
  mockStream([frame])
  renderAt('/session?exercise=abduction&side=left')
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
  expect(hook.useWebcamStream({} as never).send).toHaveBeenCalledWith({ cmd: 'pause' })
  fireEvent.click(screen.getByRole('button', { name: 'Pain / feel unwell' }))
  expect(screen.getByRole('heading', { name: 'How is the pain right now?' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Back to session' }))
  fireEvent.click(screen.getByRole('button', { name: 'End session' }))
  expect(screen.getByRole('dialog', { name: 'Ending the session' })).toBeInTheDocument()
})

test('a service pause opens the hold over the camera, not a page modal', () => {
  mockStream([frame, { type: 'pause', t: 11, id: 2, rule: 'perception', text: 'I lost you.' }])
  renderAt('/session?exercise=abduction&side=left')
  const hold = screen.getByRole('alertdialog', { name: 'Tracking lost' })
  expect(screen.getByRole('region', { name: 'Your camera' })).toContainElement(hold)
  expect(screen.getByText('Reference · ready')).toBeInTheDocument()
})

test('no design-preview simulators in the app', () => {
  mockStream([frame])
  renderAt('/session?exercise=abduction&side=left')
  expect(screen.queryByText(/Preview controls/)).toBeNull()
  expect(document.querySelector('.px-sim')).toBeNull()
})

test('a session ended early asks what got in the way (4 feedback steps)', () => {
  mockStream([frame])
  renderAt('/session?exercise=abduction&side=left')
  fireEvent.click(screen.getByRole('button', { name: 'End session' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Too tired to continue' }))
  const end = screen.getAllByRole('button', { name: 'End session' })
  fireEvent.click(end[end.length - 1])
  expect(screen.getByRole('dialog', { name: 'How was your practice?' })).toHaveTextContent('1 of 4')
})

test('the set check-in, a stop and the exertion chip hold after their events leave the 200-event window', () => {
  const all: Record<string, unknown>[] = [
    { type: 'exertion', t: 9, id: 2, level: 'moderate', reasons: ['rep time rising'], method: 'behavioural' },
    { type: 'set_complete', t: 10, id: 3, set: 1 },
  ]
  for (let i = 0; i < 250; i++) all.push({ ...frame, t: 10 + i * 0.08, id: 100 + i })
  mockStream(all.slice(0, 3))
  const view = renderAt('/session?exercise=abduction&side=left')
  for (let n = 4; n <= all.length; n += 7) {
    mockStream(all.slice(0, n).slice(-200))
    view.rerender(tree('/session?exercise=abduction&side=left'))
  }
  expect(screen.getByRole('dialog', { name: 'Set 1 done · how hard was that?' })).toBeInTheDocument()
  expect(screen.getByText(/moderate/i)).toBeInTheDocument()
  // a stop rule stays on screen however many frames follow it
  all.push({ type: 'stop', t: 31, id: 900, rule: 'pain', text: 'Pain of 8 reported. Stopping for today.' })
  for (let i = 0; i < 230; i++) {
    all.push({ ...frame, t: 31 + i * 0.08, id: 1000 + i })
    mockStream(all.slice(-200))
    view.rerender(tree('/session?exercise=abduction&side=left'))
  }
  expect(screen.getByText(/Pain of 8 reported/)).toBeInTheDocument()
})

test('ending from a stop rule records the stop rule as the end reason, never null', () => {
  mockStream([frame, { type: 'stop', t: 12, id: 50, rule: 'exertion', text: 'Sustained high exertion. Session ended and saved.' }])
  renderAt('/session?exercise=abduction&side=left')
  fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
  expect(armSend).toHaveBeenCalledWith(expect.objectContaining({ cmd: 'feedback', ended_early: true, end_reason: 'stop:exertion' }))
})

test('10 Oct: the pain told in the Pain / feel unwell dialog is pre-selected in the feedback', () => {
  mockStream([frame])
  renderAt('/session?exercise=abduction&side=left')
  fireEvent.click(screen.getByRole('button', { name: 'Pain / feel unwell' }))
  fireEvent.click(screen.getByRole('radio', { name: '8' }))
  fireEvent.click(screen.getByRole('button', { name: /Send/ }))
  expect(armSend).toHaveBeenCalledWith({ cmd: 'pain', pain: 8 })
  fireEvent.click(screen.getByRole('button', { name: 'End session' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Too tired to continue' }))
  const end = screen.getAllByRole('button', { name: 'End session' })
  fireEvent.click(end[end.length - 1])
  const fb = screen.getByRole('dialog', { name: 'How was your practice?' })
  expect(within(fb).getByRole('radio', { name: '8' })).toHaveAttribute('aria-checked', 'true')
})

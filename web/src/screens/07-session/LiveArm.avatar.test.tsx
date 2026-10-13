/** The reference figure on 07c is the designers' metronome (`RefAvatar`): the bare figure,
 *  mirrored to face the patient, never paced by the patient's own rep progress. */
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const h = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }))
vi.mock('../../avatar/AvatarPanel', () => ({
  AvatarPanel: (p: Record<string, unknown>) => {
    h.props.push(p)
    return <div data-testid="avatar" />
  },
}))

import * as hook from '../../session/useWebcamStream'
import { LiveArm } from './LiveArm'

const arm = {
  mode: 'arm', state: 'hold', set: 1, rep: 4, sets: 2, reps_per_set: 8, target_deg: 90, ceiling_deg: 90, clamped: false, hold_s: 3, hold_progress: 0.5,
  rep_progress: 0.6, angle_now: 72, peak_this_rep: 80, best_this_set: 88, trunk_lean_deg: 9, reps_total: 4, unverified_total: 0,
  flags: { lean: false, lean_count: 0, hike_count: 0 }, finished: false,
}
const frame = (a: Record<string, unknown>) => ({
  type: 'frame', t: 10, id: 1, calibrated: true, missing: [], arm: a,
  pose: { present: true, landmarks_px: [], visibility: [], conf: 0.9, ms: 8 },
  overlay: { skeleton_px: [], shoulder_px: [300, 200], ghost_target_px: [200, 200], markers_px: {} },
  hand: { present: false }, models: { hand: false, pose: true }, proc_ms: 20,
})

function renderWith(events: Record<string, unknown>[], path: string) {
  vi.spyOn(hook, 'useWebcamStream').mockReturnValue({
    camActive: true, connected: true, lastEvent: (events[events.length - 1] ?? null) as never,
    events: events as never, sessionId: null, error: null, start: vi.fn(async () => {}), stop: vi.fn(), endCapture: vi.fn(), send: vi.fn(), videoRef: { current: null },
  })
  h.props = []
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/session" element={<LiveArm />} />
      </Routes>
    </MemoryRouter>,
  )
  return h.props[h.props.length - 1]
}

test('the reference is the bare abduction figure facing the patient (their right arm is its left)', () => {
  const p = renderWith([frame(arm)], '/session?exercise=abduction&side=right')
  expect(p).toMatchObject({ bare: true, clip: 'abduction', side: 'left', camera: 'front' })
  expect(renderWith([frame(arm)], '/session?exercise=abduction&side=left')).toMatchObject({ side: 'right' })
})

test('never paced by the patient: no rep progress reaches the figure', () => {
  expect(renderWith([frame(arm)], '/session?exercise=abduction&side=left').paced).toBeUndefined()
  expect(renderWith([], '/session?exercise=arm&side=left').paced).toBeUndefined()
})

test('a gentle day (target 60°): the reference line is drawn and labelled at 60°, like the band', () => {
  renderWith([frame({ ...arm, target_deg: 60 })], '/session?exercise=abduction&side=left')
  expect(document.querySelector('.av-tick-t')).toHaveTextContent('60°')
  expect(document.body.textContent).toMatch(/target 60°/)
})

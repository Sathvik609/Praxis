import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import * as hook from '../../session/useWebcamStream'
import { PLAN, PROFILE, mockApi } from '../../test/api-mock'
import { Go } from './Go'

vi.mock('../../avatar/AvatarPanel', () => ({ AvatarPanel: () => <div data-testid="figure" /> }))

const send = vi.fn()

function mockStream(events: Record<string, unknown>[], error: string | null = null) {
  send.mockClear()
  vi.spyOn(hook, 'useWebcamStream').mockReturnValue({
    camActive: true,
    connected: true,
    lastEvent: (events[events.length - 1] ?? null) as never,
    events: events as never,
    error,
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    send,
    videoRef: { current: null },
  })
}

const armFrame = (arm: Record<string, unknown>, id = 1) => ({
  type: 'frame', t: id, id, calibrated: true, missing: [], board: {}, overlay: {},
  arm: { mode: 'arm', state: 'moving', set: 1, rep: 2, sets: 2, reps_per_set: 8, target_deg: 90, ceiling_deg: 90, clamped: false, hold_s: 3, hold_progress: 0, angle_now: 40, peak_this_rep: 40, best_this_set: 60, trunk_lean_deg: 2, reps_total: 2, unverified_total: 0, flags: { lean: false, lean_count: 0, hike_count: 0 }, finished: false, ...arm },
})

function app(exercise = 'flexion') {
  mockApi({ '/api/profile': { profile: PROFILE }, '/api/plan/today': PLAN })
  return render(
    <MemoryRouter initialEntries={[`/go?exercise=${exercise}&side=left&tier=full`]}>
      <Routes>
        <Route path="/go" element={<Go />} />
        <Route path="/done/:id" element={<div>DONE</div>} />
        <Route path="/" element={<div>TODAY</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('the exercise, side and tier go to the service, and the camera says it is not recording', async () => {
  mockStream([])
  app()
  await screen.findByText('Arm to the front')
  expect(hook.useWebcamStream).toHaveBeenCalledWith(expect.objectContaining({ mode: 'arm', params: { sheet: 'none', exercise: 'flexion', side: 'left', tier: 'full' } }))
  expect(screen.getByText('Live · not recording')).toBeInTheDocument()
  expect(screen.getByTestId('figure')).toBeInTheDocument()
})

test('one big count, the phase from the frame and the coach line', async () => {
  mockStream([armFrame({ phase: 'hold', state: 'hold', hold_s: 3, hold_progress: 0.4, rep: 2 })])
  app()
  await screen.findByText('Arm to the front')
  expect(screen.getByText('3')).toBeInTheDocument() // rep 2 done, on rep 3
  expect(screen.getByText(/of 8/)).toBeInTheDocument()
  expect(screen.getByText('Hold it there… 2')).toBeInTheDocument()
  expect(screen.getByText(/left side · hold/)).toBeInTheDocument()
})

test('verified and unverified reps are both counted, from the events only', async () => {
  mockStream([
    { type: 'rep_complete', t: 1, id: 1, verified: true },
    { type: 'rep_complete', t: 2, id: 2, verified: false },
    armFrame({}, 3),
  ])
  app()
  await screen.findByText('Arm to the front')
  expect(screen.getByText(/1 verified · 1 unverified/)).toBeInTheDocument()
  expect(screen.getByText('1 verified')).toBeInTheDocument()
})

test('Pause is the one control and it holds rest, pain and end behind it', async () => {
  mockStream([armFrame({})])
  app()
  await screen.findByText('Arm to the front')
  await userEvent.click(screen.getByRole('button', { name: 'Pause' }))
  expect(send).toHaveBeenCalledWith({ cmd: 'pause' })
  for (const name of ['Carry on', 'Take a rest', 'Pain or feel unwell', 'End session']) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  }
  await userEvent.click(screen.getByRole('button', { name: 'Pain or feel unwell' }))
  await userEvent.click(screen.getByRole('radio', { name: '7' }))
  await userEvent.click(screen.getByRole('button', { name: 'Send to coach' }))
  expect(send).toHaveBeenCalledWith({ cmd: 'pain', pain: 7 })
})

test('finishing the sets asks how it felt and the saved session opens the done screen', async () => {
  mockStream([armFrame({ finished: true }), { type: 'arm_complete', t: 9, id: 9, sets: 2, reps: 8 }])
  app()
  expect(await screen.findByText('How was your practice?')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Skip/ }))
  expect(send).toHaveBeenCalledWith({ cmd: 'feedback' })

  mockStream([{ type: 'command', t: 10, id: 10, cmd: 'feedback', summary: { session_id: 's-42' } }])
  app()
  expect(await screen.findByText('DONE')).toBeInTheDocument()
})

test('a stop rule from the service takes over the screen', async () => {
  mockStream([armFrame({}), { type: 'stop', t: 5, id: 5, rule: 'pain', text: 'Pain 8. Stopping here.' }])
  app()
  expect(await screen.findByText('Pain 8. Stopping here.')).toBeInTheDocument()
  expect(screen.getByText('Session ended · pain at stop level')).toBeInTheDocument()
})

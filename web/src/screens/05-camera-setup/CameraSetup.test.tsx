import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { readDay, todayKey } from '../../lib/day'
import * as hook from '../../session/useWebcamStream'
import { CameraSetup } from './CameraSetup'

function mockStream(lastEvent: Record<string, unknown> | null, camActive = true, error: string | null = null) {
  const start = vi.fn(async () => {})
  vi.spyOn(hook, 'useWebcamStream').mockReturnValue({
    camActive,
    connected: true,
    lastEvent: lastEvent as never,
    events: lastEvent ? [lastEvent as never] : [],
    sessionId: null,
    error,
    start,
    stop: vi.fn(),
    send: vi.fn(),
    videoRef: { current: null },
  })
  return start
}

function Where() {
  const l = useLocation()
  return <div>AT {l.pathname + l.search}</div>
}

function renderSetup(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/setup" element={<CameraSetup />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

const ARM_EVENT = {
  type: 'setup_checks',
  t: 0,
  id: 1,
  all_required_pass: true,
  checks: [
    { id: 'camera', label: 'Camera permission', status: 'pass', hint: null },
    { id: 'person', label: 'One person in view', status: 'pass', hint: null },
    { id: 'front_view', label: 'You face the camera', status: 'pending', hint: null },
    { id: 'lighting', label: 'Lighting', status: 'pass', hint: null },
  ],
}

const pass = (id: string, label = id) => ({ id, label, status: 'pass', hint: null })
const TABLE_PASS = {
  type: 'setup_checks',
  t: 0,
  id: 1,
  all_required_pass: true,
  checks: [pass('camera'), pass('person'), pass('task_area'), pass('markers'), pass('angle'), pass('lighting')],
}

const coach = () => document.querySelector('.cs-coach') as HTMLElement
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('continue is disabled until all required checks pass', () => {
  mockStream({ type: 'setup_checks', t: 0, id: 1, all_required_pass: false, checks: [] })
  renderSetup('/setup?exercise=nhpt')
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
})

test('the live pill says Live · not recording and where the video is processed while the camera is on', () => {
  mockStream(TABLE_PASS)
  renderSetup('/setup?exercise=nhpt&side=left')
  const pill = document.querySelector('.cs-live') as HTMLElement
  expect(within(pill).getByText('Live · not recording')).toBeVisible()
  // jsdom runs on localhost: the edge wording
  expect(pill).toHaveTextContent('Processed on this device')
  expect(screen.getByRole('heading', { name: 'Nine-Hole Peg Test' })).toBeInTheDocument()
  expect(screen.getByText('Camera setup · Left arm')).toBeInTheDocument()
})

test('no live pill while the camera is off', () => {
  mockStream(null, false)
  renderSetup('/setup?exercise=nhpt')
  expect(screen.queryByText('Live · not recording')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Camera is off' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Allow camera' })).toBeInTheDocument()
})

test('the arm setup (Arm out to the side) runs the arm pipeline with no sheet and lists the front-view steps', () => {
  mockStream({ type: 'setup_checks', t: 0, id: 1, all_required_pass: false, checks: [] })
  renderSetup('/setup?exercise=abduction&side=right')
  expect(hook.useWebcamStream).toHaveBeenLastCalledWith(expect.objectContaining({ params: { sheet: 'nhpt_board', for: 'arm' } }))
  const steps = screen.getByRole('list', { name: 'Setup checks' })
  for (const s of ['Camera', 'In frame', 'Facing', 'Both arms', 'Lighting', 'Still pose']) expect(within(steps).getByText(s)).toBeInTheDocument()
  expect(within(steps).queryByText('Sheet')).not.toBeInTheDocument()
  expect(screen.getByText('Camera setup · Right arm')).toBeInTheDocument()
})

test.each(['pendulum', 'arm', 'flexion', 'external_rotation', 'internal_rotation'])('a deep link to hidden %s goes back to Choose and never opens the camera', (id) => {
  const start = mockStream(null)
  renderSetup(`/setup?exercise=${id}&side=left`)
  expect(screen.getByText('AT /details/choose')).toBeInTheDocument()
  expect(start).not.toHaveBeenCalled()
  expect(hook.useWebcamStream).not.toHaveBeenCalled()
})

test('the setup guide lists the front-view rows and placement, never the sheet rows', () => {
  mockStream(null)
  renderSetup('/setup?exercise=abduction&side=left')
  fireEvent.click(screen.getByRole('button', { name: 'Setup guide and camera details' }))
  const guide = screen.getByRole('dialog', { name: 'Setup guide' })
  expect(within(guide).getByText('You face the camera')).toBeInTheDocument()
  expect(within(guide).getByText('Both shoulders and both hands in view')).toBeInTheDocument()
  expect(within(guide).queryByText(/Sheet found/)).not.toBeInTheDocument()
  expect(within(guide).queryByText('Hip in view')).not.toBeInTheDocument()
  expect(within(guide).getByRole('heading', { name: 'Place the camera in front of you' })).toBeInTheDocument()
  expect(within(guide).getByRole('img', { name: /chest height, 2 to 2.5 metres/ })).toBeInTheDocument()
  expect(within(guide).getByText(/Light from the front, no window behind you/)).toBeInTheDocument()
})

test('pose rows the camera does not check yet are confirmed by the patient in the coach pill', () => {
  mockStream(ARM_EVENT)
  renderSetup('/setup?exercise=abduction&side=right')
  const cont = screen.getByRole('button', { name: 'Continue' })
  expect(cont).toBeDisabled()
  expect(coach()).toHaveTextContent('Turn your chair so you face the camera straight on.')
  fireEvent.click(within(coach()).getByRole('button', { name: 'Yes, I can see it' }))
  expect(coach()).toHaveTextContent('Move back until both hands fit with your arms out to the side.')
  fireEvent.click(within(coach()).getByRole('button', { name: 'Yes, I can see it' }))
  expect(cont).toBeEnabled()
  expect(coach()).toHaveTextContent('Hold still in your starting pose')
})

test('once the service decides a pose row, the camera wins and there is no tick for it', () => {
  mockStream({
    ...ARM_EVENT,
    checks: [...ARM_EVENT.checks.filter((c) => c.id !== 'front_view'), { id: 'front_view', label: 'x', status: 'check', hint: null }],
  })
  renderSetup('/setup?exercise=abduction&side=left')
  expect(coach()).toHaveTextContent('Turn your chair so you face the camera straight on.')
  expect(within(coach()).queryByRole('button')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
})

test('the table view asks "Is this your left arm?" and Continue waits for the answer even when the service passes', () => {
  mockStream(TABLE_PASS)
  renderSetup('/setup?exercise=cup&side=left')
  const cont = screen.getByRole('button', { name: 'Continue' })
  expect(cont).toBeDisabled()
  expect(coach()).toHaveTextContent('Is this your left arm?')
  fireEvent.click(within(coach()).getByRole('button', { name: 'Yes, my left arm' }))
  expect(cont).toBeEnabled()
})

test('camera blocked shows why, Try again and a recorded session', () => {
  mockStream(null, false, 'camera: permission denied')
  renderSetup('/setup?exercise=nhpt')
  expect(screen.getByRole('alert')).toHaveTextContent(/Camera permission needed/)
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'No camera? Use a recorded session' }))
  expect(screen.getByText('AT /details/settings')).toBeInTheDocument()
})

test('sheet tasks show the overhead-mount diagram and copy in the guide; the arm task does not', () => {
  mockStream({ type: 'setup_checks', t: 0, id: 1, all_required_pass: false, checks: [] })
  const { unmount } = renderSetup('/setup?exercise=cup')
  fireEvent.click(screen.getByRole('button', { name: 'Setup guide and camera details' }))
  expect(screen.getByRole('heading', { name: 'Mount the camera above the table' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: /45 to 60 centimetres above the table/ })).toBeInTheDocument()
  expect(screen.getByText('Camera looks down at the sheet')).toBeInTheDocument()
  expect(screen.getByText(/ArUco calibration/)).toBeInTheDocument()
  unmount()
  renderSetup('/setup?exercise=abduction')
  fireEvent.click(screen.getByRole('button', { name: 'Setup guide and camera details' }))
  expect(screen.queryByRole('heading', { name: 'Mount the camera above the table' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Place the camera in front of you' })).toBeInTheDocument()
})

test('the coach pill shows the service hint when the camera is too steep', () => {
  mockStream({
    type: 'setup_checks',
    t: 0,
    id: 1,
    all_required_pass: false,
    checks: [pass('camera'), pass('person'), pass('task_area'), pass('markers'), { id: 'angle', label: 'Camera looks down at the sheet', status: 'check', hint: 'Mount the camera above the table, pointing straight down (a phone on a stand works).' }],
  })
  renderSetup('/setup?exercise=nhpt&side=left')
  fireEvent.click(within(coach()).getByRole('button', { name: 'Yes, my left arm' }))
  expect(coach()).toHaveTextContent(/a phone on a stand works/)
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
})

test('ready: a still-pose countdown, then a 4 s auto-continue into the session', () => {
  vi.useFakeTimers()
  mockStream(TABLE_PASS)
  renderSetup('/setup?exercise=cup&side=right')
  fireEvent.click(within(coach()).getByRole('button', { name: 'Yes, my right arm' }))
  expect(coach()).toHaveTextContent('Hold still in your starting pose')
  tick(1000)
  tick(1000)
  expect(coach()).toHaveTextContent('All set. Starting your session')
  expect(screen.getByRole('button', { name: 'Continue · 4' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible()
  for (let i = 0; i < 4; i++) tick(1000)
  expect(screen.getByText('AT /session?exercise=cup&side=right')).toBeInTheDocument()
  expect(readDay().current).toBe('cup')
})

test('Cancel stops the auto-continue (artifact link-button style) and leaves Continue to the patient', () => {
  vi.useFakeTimers()
  mockStream(TABLE_PASS)
  renderSetup('/setup?exercise=nhpt&side=left')
  fireEvent.click(within(coach()).getByRole('button', { name: 'Yes, my left arm' }))
  tick(1000)
  tick(1000)
  tick(1000)
  const cancel = screen.getByRole('button', { name: 'Cancel' })
  expect(cancel).toHaveClass('cs-skip')
  fireEvent.click(cancel)
  expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  for (let i = 0; i < 8; i++) tick(1000)
  expect(screen.queryByText(/^AT /)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(screen.getByText('AT /session?exercise=nhpt&hand=left')).toBeInTheDocument()
})

test('Continue carries rehearse=1 into the session', () => {
  mockStream(TABLE_PASS)
  renderSetup('/setup?exercise=cup&side=left&rehearse=1')
  fireEvent.click(within(coach()).getByRole('button', { name: 'Yes, my left arm' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(screen.getByText('AT /session?exercise=cup&side=left&rehearse=1')).toBeInTheDocument()
})

test('Exit goes back to Choose exercise', () => {
  mockStream(null)
  renderSetup('/setup?exercise=cup&side=left')
  fireEvent.click(screen.getByRole('button', { name: 'Exit' }))
  expect(screen.getByText('AT /details/choose')).toBeInTheDocument()
})

test('a stopped day never opens the camera', () => {
  localStorage.setItem('praxis.day', JSON.stringify({ date: todayKey(), checkin: { pain: 2, new_symptoms: true, tier: 'full', flagged: true, synced: true, side: 'left', minutes: 14 }, done: [], demosSeen: [], current: null, finished: [], stopped: 'new_symptoms' }))
  const start = mockStream(null)
  renderSetup('/setup?exercise=abduction')
  expect(screen.getByRole('heading', { name: 'No exercises today' })).toBeInTheDocument()
  expect(start).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }))
  expect(screen.getByText('AT /details')).toBeInTheDocument()
})

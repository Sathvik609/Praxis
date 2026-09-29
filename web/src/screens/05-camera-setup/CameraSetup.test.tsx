import { fireEvent, render, screen } from '@testing-library/react'
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

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
})
afterEach(() => vi.unstubAllGlobals())

test('continue is disabled until all required checks pass', () => {
  mockStream({ type: 'setup_checks', t: 0, id: 1, all_required_pass: false, checks: [] })
  renderSetup('/setup?exercise=nhpt')
  expect(screen.getByRole('button', { name: /Continue to demonstration/ })).toBeDisabled()
})

test('continue enables when checks pass; the feed shows live, mirrored, where it is processed, and calibration', () => {
  mockStream({ type: 'setup_checks', t: 0, id: 1, all_required_pass: true, checks: [] })
  renderSetup('/setup?exercise=nhpt')
  expect(screen.getByRole('button', { name: /Continue to demonstration/ })).toBeEnabled()
  expect(screen.getByText('Live · not recording')).toBeInTheDocument()
  // jsdom runs on localhost: the edge wording
  expect(screen.getByText('mirrored · processed on this device, never stored')).toBeInTheDocument()
  expect(screen.getByText(/ArUco calibration/)).toBeInTheDocument()
})

test('the arm setup (Arm out to the side) asks to face the camera and needs no sheet', () => {
  mockStream({ type: 'setup_checks', t: 0, id: 1, all_required_pass: false, checks: [] })
  renderSetup('/setup?exercise=abduction')
  expect(screen.getByText(/No sheet needed/)).toBeInTheDocument()
  expect(screen.getByText(/Arm out to the side: face the camera/)).toBeInTheDocument()
  expect(hook.useWebcamStream).toHaveBeenLastCalledWith(expect.objectContaining({ params: { sheet: 'nhpt_board', for: 'arm' } }))
})

test.each(['pendulum', 'arm', 'flexion', 'external_rotation', 'internal_rotation'])('a deep link to hidden %s goes back to Choose and never opens the camera', (id) => {
  const start = mockStream(null)
  renderSetup(`/setup?exercise=${id}&side=left`)
  expect(screen.getByText('AT /details/choose')).toBeInTheDocument()
  expect(start).not.toHaveBeenCalled()
  expect(hook.useWebcamStream).not.toHaveBeenCalled()
})

test('the front view shows pose rows, never the sheet rows, even before the first check arrives', () => {
  mockStream(null)
  renderSetup('/setup?exercise=abduction&side=left')
  expect(screen.queryByText(/Sheet found/)).not.toBeInTheDocument()
  expect(screen.queryByText('Camera looks down at the sheet')).not.toBeInTheDocument()
  expect(screen.getByText('You face the camera')).toBeInTheDocument()
})

test('pose rows the camera does not check yet are labelled self-checks and must be ticked', () => {
  mockStream(ARM_EVENT)
  renderSetup('/setup?exercise=abduction&side=right')
  expect(screen.getAllByText('You check')).toHaveLength(2)
  expect(screen.getByText(/the camera does not check these yet/i)).toBeInTheDocument()
  const cont = screen.getByRole('button', { name: /Continue to demonstration/ })
  expect(cont).toBeDisabled()
  for (const b of screen.getAllByRole('button', { name: /yes, I can see it/ })) fireEvent.click(b)
  expect(screen.getAllByText('You checked')).toHaveLength(2)
  expect(cont).toBeEnabled()
})

test('once the service decides a pose row, the camera wins over the tick', () => {
  mockStream({
    ...ARM_EVENT,
    checks: [...ARM_EVENT.checks.filter((c) => c.id !== 'front_view'), { id: 'front_view', label: 'x', status: 'check', hint: null }],
  })
  renderSetup('/setup?exercise=abduction&side=left')
  expect(screen.getAllByText('You check')).toHaveLength(1)
  expect(screen.getByText('Check')).toBeInTheDocument()
  expect(screen.getByText(/Turn your chair so you face the camera straight on/)).toBeInTheDocument()
  for (const b of screen.getAllByRole('button', { name: /yes, I can see it/ })) fireEvent.click(b)
  expect(screen.getByRole('button', { name: /Continue to demonstration/ })).toBeDisabled()
})

test('the front view asks to face the camera with both shoulders and hands in view, and has no hip row', () => {
  mockStream(ARM_EVENT)
  renderSetup('/setup?exercise=abduction')
  expect(screen.getByText('You face the camera')).toBeInTheDocument()
  expect(screen.getByText('Both shoulders and both hands in view')).toBeInTheDocument()
  expect(screen.queryByText('Hip in view')).not.toBeInTheDocument()
  expect(screen.getByRole('img', { name: /chest height, 2 to 2.5 metres/ })).toBeInTheDocument()
  expect(screen.getByText(/Light from the front, no window behind you/)).toBeInTheDocument()
})

test('camera blocked offers a recorded session and the checklist shows six waiting rows', () => {
  mockStream(null, false, 'camera: permission denied')
  renderSetup('/setup?exercise=nhpt')
  expect(screen.getByRole('alert')).toHaveTextContent(/Camera permission needed/)
  expect(screen.getByRole('button', { name: 'Use a recorded session' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  expect(screen.getAllByText('Waiting')).toHaveLength(6)
})

test('sheet tasks show the overhead-mount diagram and copy; the arm task does not', () => {
  mockStream({ type: 'setup_checks', t: 0, id: 1, all_required_pass: false, checks: [] })
  const { unmount } = renderSetup('/setup?exercise=cup')
  expect(screen.getByRole('heading', { name: 'Mount the camera above the table' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: /45 to 60 centimetres above the table/ })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: /two-thirds of the picture/ })).toBeInTheDocument()
  expect(screen.getByText('Camera looks down at the sheet')).toBeInTheDocument()
  unmount()
  renderSetup('/setup?exercise=abduction')
  expect(screen.queryByRole('heading', { name: 'Mount the camera above the table' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Place the camera in front of you' })).toBeInTheDocument()
})

test('the angle row shows the service hint when the camera is too steep', () => {
  mockStream({
    type: 'setup_checks',
    t: 0,
    id: 1,
    all_required_pass: false,
    checks: [{ id: 'angle', label: 'Camera looks down at the sheet', status: 'check', hint: 'Mount the camera above the table, pointing straight down (a phone on a stand works).' }],
  })
  renderSetup('/setup?exercise=nhpt')
  expect(screen.getByText('Check')).toBeInTheDocument()
  expect(screen.getByText(/a phone on a stand works/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Continue to demonstration/ })).toBeDisabled()
})

test('continue carries the side to the demonstration', () => {
  mockStream({ type: 'setup_checks', t: 0, id: 1, all_required_pass: true, checks: [] })
  renderSetup('/setup?exercise=cup&side=right')
  fireEvent.click(screen.getByRole('button', { name: 'Continue to demonstration' }))
  expect(screen.getByText('AT /details/demo?exercise=cup&side=right')).toBeInTheDocument()
})

test('a demo already seen today can be skipped straight to practice', () => {
  localStorage.setItem('praxis.day', JSON.stringify({ date: todayKey(), checkin: null, done: [], demosSeen: ['cup'], current: null, finished: [], stopped: null }))
  mockStream({ type: 'setup_checks', t: 0, id: 1, all_required_pass: true, checks: [] })
  renderSetup('/setup?exercise=cup&side=left')
  fireEvent.click(screen.getByRole('button', { name: 'Skip demo' }))
  expect(screen.getByText('AT /session?exercise=cup&side=left')).toBeInTheDocument()
  expect(readDay().current).toBe('cup')
})

test('no Skip demo for a demo not seen today', () => {
  mockStream({ type: 'setup_checks', t: 0, id: 1, all_required_pass: true, checks: [] })
  renderSetup('/setup?exercise=cup&side=left')
  expect(screen.queryByRole('button', { name: 'Skip demo' })).not.toBeInTheDocument()
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

test('mid-day the setup shows where this exercise sits in the day', () => {
  localStorage.setItem('praxis.day', JSON.stringify({ date: todayKey(), checkin: { pain: 2, new_symptoms: false, tier: 'full', flagged: false, synced: true, side: 'left', minutes: 14 }, done: ['abduction'], demosSeen: [], current: null, finished: [], stopped: null }))
  mockStream(null)
  renderSetup('/setup?exercise=cup')
  expect(screen.getByTestId('day-title')).toHaveTextContent('Today · 2 of 2 · Waiter – cup')
})

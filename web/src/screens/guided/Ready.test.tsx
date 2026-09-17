import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import * as hook from '../../session/useWebcamStream'
import { PLAN, PROFILE, mockApi } from '../../test/api-mock'
import { Ready } from './Ready'

vi.mock('../../avatar/AvatarPanel', () => ({ AvatarPanel: () => <div data-testid="figure" /> }))

function mockStream(events: Record<string, unknown>[], camActive = true, error: string | null = null) {
  vi.spyOn(hook, 'useWebcamStream').mockReturnValue({
    camActive,
    connected: true,
    lastEvent: (events[events.length - 1] ?? null) as never,
    events: events as never,
    error,
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    send: vi.fn(),
    videoRef: { current: null },
  })
}

const checks = (rows: { id: string; status: string; hint?: string | null }[], pass = false) => [
  { type: 'setup_checks', t: 0, id: 1, all_required_pass: pass, checks: rows.map((r) => ({ label: r.id, hint: null, ...r })) },
]

function app(exercise = 'pendulum') {
  mockApi({ '/api/profile': { profile: PROFILE }, '/api/plan/today': PLAN })
  return render(
    <MemoryRouter initialEntries={[`/ready?exercise=${exercise}`]}>
      <Routes>
        <Route path="/ready" element={<Ready />} />
        <Route path="/go" element={<div>GO</div>} />
        <Route path="/" element={<div>TODAY</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('the camera runs with no sheet: for=arm and the exercise go to the service', async () => {
  mockStream([])
  app()
  await screen.findByText('Pendulum')
  expect(hook.useWebcamStream).toHaveBeenCalledWith(expect.objectContaining({ mode: 'calibrate', params: { sheet: 'none', for: 'arm', exercise: 'pendulum' } }))
  expect(screen.getByText('Live · not recording')).toBeInTheDocument()
})

test('one hint at a time, and no setup table', async () => {
  mockStream(checks([
    { id: 'camera', status: 'pass' },
    { id: 'person', status: 'check', hint: 'Step back so I can see your shoulder and hip.' },
    { id: 'lighting', status: 'check', hint: 'Turn on a light.' },
  ]))
  app()
  await screen.findByText('Pendulum')
  expect(screen.getByText('Step back so I can see your shoulder and hip.')).toBeInTheDocument()
  expect(screen.queryByText('Turn on a light.')).not.toBeInTheDocument()
  expect(screen.queryByText('Pass')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled()
})

test('Go unlocks when the required checks pass and carries the exercise, side and tier', async () => {
  mockStream(checks([{ id: 'camera', status: 'pass' }, { id: 'lighting', status: 'pass' }], true))
  app()
  expect(await screen.findByText(/Go when you are ready/)).toBeInTheDocument()
  expect(screen.getByText('Ready')).toBeInTheDocument()
  const go = screen.getByRole('button', { name: 'Go' })
  expect(go).toBeEnabled()
  await userEvent.click(go)
  expect(screen.getByText('GO')).toBeInTheDocument()
})

test('a blocked camera shows the way forward instead of a dead end', async () => {
  mockStream([], false, 'Permission denied')
  app()
  await screen.findByText('Pendulum')
  expect(screen.getByRole('alert')).toHaveTextContent('Camera blocked')
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
})

test('Not now goes back to today', async () => {
  mockStream([])
  app()
  await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
  expect(screen.getByText('TODAY')).toBeInTheDocument()
})

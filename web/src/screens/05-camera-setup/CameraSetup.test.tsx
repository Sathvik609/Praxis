import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as hook from '../../session/useWebcamStream'
import { CameraSetup } from './CameraSetup'

function mockStream(lastEvent: Record<string, unknown> | null, camActive = true) {
  vi.spyOn(hook, 'useWebcamStream').mockReturnValue({
    camActive,
    connected: true,
    lastEvent: lastEvent as never,
    events: lastEvent ? [lastEvent as never] : [],
    error: null,
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    send: vi.fn(),
    videoRef: { current: null },
  })
}

test('continue is disabled until all required checks pass', () => {
  mockStream({ type: 'setup_checks', t: 0, id: 1, all_required_pass: false, checks: [] })
  render(
    <MemoryRouter initialEntries={['/setup?exercise=nhpt']}>
      <CameraSetup />
    </MemoryRouter>,
  )
  expect(screen.getByRole('button', { name: /Continue to demonstration/ })).toBeDisabled()
})

test('continue enables when checks pass and live indicator shows', () => {
  mockStream({ type: 'setup_checks', t: 0, id: 1, all_required_pass: true, checks: [] })
  render(
    <MemoryRouter initialEntries={['/setup?exercise=nhpt']}>
      <CameraSetup />
    </MemoryRouter>,
  )
  expect(screen.getByRole('button', { name: /Continue to demonstration/ })).toBeEnabled()
  expect(screen.getByText('Live · not recording')).toBeInTheDocument()
})

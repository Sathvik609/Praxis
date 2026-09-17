import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import * as hook from '../../session/useWebcamStream'
import { CameraSetup } from './CameraSetup'

function mockStream(lastEvent: Record<string, unknown> | null, camActive = true, error: string | null = null) {
  vi.spyOn(hook, 'useWebcamStream').mockReturnValue({
    camActive,
    connected: true,
    lastEvent: lastEvent as never,
    events: lastEvent ? [lastEvent as never] : [],
    error,
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

test('continue enables when checks pass; the feed shows live, mirrored and calibration lines', () => {
  mockStream({ type: 'setup_checks', t: 0, id: 1, all_required_pass: true, checks: [] })
  render(
    <MemoryRouter initialEntries={['/setup?exercise=nhpt']}>
      <CameraSetup />
    </MemoryRouter>,
  )
  expect(screen.getByRole('button', { name: /Continue to demonstration/ })).toBeEnabled()
  expect(screen.getByText('Live · not recording')).toBeInTheDocument()
  expect(screen.getByText(/mirrored · processed on this device/)).toBeInTheDocument()
  expect(screen.getByText(/ArUco calibration/)).toBeInTheDocument()
})

test('arm setup asks for a side view and no sheet', () => {
  mockStream({ type: 'setup_checks', t: 0, id: 1, all_required_pass: false, checks: [] })
  render(
    <MemoryRouter initialEntries={['/setup?exercise=arm']}>
      <CameraSetup />
    </MemoryRouter>,
  )
  expect(screen.getByText(/No sheet needed/)).toBeInTheDocument()
  expect(hook.useWebcamStream).toHaveBeenCalledWith(expect.objectContaining({ params: { sheet: 'nhpt_board', for: 'arm' } }))
})

test('camera blocked offers a recorded session and the checklist shows five waiting rows', () => {
  mockStream(null, false, 'camera: permission denied')
  render(
    <MemoryRouter initialEntries={['/setup?exercise=nhpt']}>
      <CameraSetup />
    </MemoryRouter>,
  )
  expect(screen.getByRole('alert')).toHaveTextContent(/Camera permission needed/)
  expect(screen.getByRole('button', { name: 'Use a recorded session' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  expect(screen.getAllByText('Waiting')).toHaveLength(6)
})

test('sheet tasks show the overhead-mount diagram and copy; the arm task does not', () => {
  mockStream({ type: 'setup_checks', t: 0, id: 1, all_required_pass: false, checks: [] })
  const { unmount } = render(
    <MemoryRouter initialEntries={['/setup?exercise=cup']}>
      <CameraSetup />
    </MemoryRouter>,
  )
  expect(screen.getByRole('heading', { name: 'Mount the camera above the table' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: /50 centimetres above the table/ })).toBeInTheDocument()
  expect(screen.getByText('Camera looks down at the sheet')).toBeInTheDocument()
  unmount()
  render(
    <MemoryRouter initialEntries={['/setup?exercise=arm']}>
      <CameraSetup />
    </MemoryRouter>,
  )
  expect(screen.queryByRole('heading', { name: 'Mount the camera above the table' })).not.toBeInTheDocument()
})

test('the angle row shows the service hint when the camera is too steep', () => {
  mockStream({
    type: 'setup_checks',
    t: 0,
    id: 1,
    all_required_pass: false,
    checks: [
      {
        id: 'angle',
        label: 'Camera looks down at the sheet',
        status: 'check',
        hint: 'Mount the camera above the table, pointing straight down (a phone on a stand works).',
      },
    ],
  })
  render(
    <MemoryRouter initialEntries={['/setup?exercise=nhpt']}>
      <CameraSetup />
    </MemoryRouter>,
  )
  expect(screen.getByText('Check')).toBeInTheDocument()
  expect(screen.getByText(/a phone on a stand works/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Continue to demonstration/ })).toBeDisabled()
})

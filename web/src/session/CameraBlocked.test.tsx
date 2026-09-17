import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CameraBlocked, cameraBlockedCopy } from './CameraBlocked'
import { describeCameraError } from './useWebcamStream'

test('camera errors are named, not lumped together', () => {
  expect(describeCameraError(new DOMException('x', 'NotAllowedError'))).toBe('camera: permission denied')
  expect(describeCameraError(new DOMException('x', 'NotReadableError'))).toBe('camera: in use by another app')
  expect(describeCameraError(new DOMException('x', 'NotFoundError'))).toBe('camera: no camera found')
  expect(cameraBlockedCopy('camera_blocked', 'camera: permission denied').title).toBe('Camera permission needed')
  expect(cameraBlockedCopy('camera_blocked', 'camera: in use by another app').title).toBe('Camera is in use')
  expect(cameraBlockedCopy('camera_blocked', 'camera: no camera found').title).toBe('No camera found')
  expect(cameraBlockedCopy('service_unreachable', null).title).toMatch(/service/)
})

test('the card shows the specific advice', () => {
  render(
    <MemoryRouter>
      <CameraBlocked reason="camera_blocked" detail="camera: in use by another app" onRetry={() => {}} />
    </MemoryRouter>,
  )
  expect(screen.getByRole('alert')).toHaveTextContent(/Another app is holding the camera/)
})

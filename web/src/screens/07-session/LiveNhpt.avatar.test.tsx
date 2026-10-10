/** The NHPT reference figure faces the patient like every other reference (Waiter – cup, the arm
 *  reference, the Demonstration): the test hand's arm is the figure's opposite arm. */
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
import { LiveNhpt } from './LiveNhpt'

function renderAt(path: string) {
  vi.spyOn(hook, 'useWebcamStream').mockReturnValue({
    camActive: true, connected: true, lastEvent: null, events: [] as never, sessionId: null, error: null,
    start: vi.fn(async () => {}), stop: vi.fn(), send: vi.fn(), videoRef: { current: null },
  })
  h.props = []
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/session" element={<LiveNhpt />} />
      </Routes>
    </MemoryRouter>,
  )
  return h.props[h.props.length - 1]
}

test('a left-hand test mirrors the figure: its right arm moves, the label names the left hand', () => {
  expect(renderAt('/session?hand=left')).toMatchObject({ bare: true, clip: 'nhpt', side: 'right', patientSide: 'left' })
})

test('a right-hand test: the figure moves its left arm, the label names the right hand', () => {
  expect(renderAt('/session?hand=right')).toMatchObject({ clip: 'nhpt', side: 'left', patientSide: 'right' })
})

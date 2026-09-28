import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('./LiveArm', () => ({ LiveArm: () => <div>LIVE ARM</div> }))
vi.mock('./LiveCup', () => ({ LiveCup: () => <div>LIVE CUP</div> }))
vi.mock('./LiveNhpt', () => ({ LiveNhpt: () => <div>LIVE NHPT</div> }))

import { SessionRouter } from './SessionRouter'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/session" element={<SessionRouter />} />
        <Route path="/details/choose" element={<div>CHOOSE</div>} />
        <Route path="/details/demo" element={<div>DEMO</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('the three visible exercises open their live screens', () => {
  const { unmount } = renderAt('/session?exercise=abduction&side=left')
  expect(screen.getByText('LIVE ARM')).toBeInTheDocument()
  unmount()
  const cup = renderAt('/session?exercise=cup&side=left')
  expect(screen.getByText('LIVE CUP')).toBeInTheDocument()
  cup.unmount()
  renderAt('/session?exercise=nhpt&hand=left')
  expect(screen.getByText('LIVE NHPT')).toBeInTheDocument()
})

test.each(['pendulum', 'arm', 'flexion', 'external_rotation', 'internal_rotation'])('a link to hidden %s goes back to Choose and never opens the camera', (id) => {
  renderAt(`/session?exercise=${id}&side=left`)
  expect(screen.getByText('CHOOSE')).toBeInTheDocument()
  expect(screen.queryByText(/^LIVE/)).not.toBeInTheDocument()
})

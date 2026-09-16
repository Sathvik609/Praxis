import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('./AvatarScene', () => ({
  AvatarScene: ({ clip }: { clip: { name: string } }) => <div data-testid="scene">scene:{clip.name}</div>,
}))

import { AvatarPanel } from './AvatarPanel'

test('renders the scene, caption, controls and the reference-only label', () => {
  render(<AvatarPanel clip="cup" autoplay={false} />)
  expect(screen.getByTestId('scene')).toHaveTextContent('scene:cup')
  expect(screen.getByText(/Step 1 of 5/)).toBeInTheDocument()
  for (const name of ['Play', 'Replay', 'Slower', 'Close-up', 'Captions']) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  }
  expect(screen.getByText(/Reference only/)).toBeInTheDocument()
})

test('compact panel hides the controls and captions can be toggled', () => {
  render(<AvatarPanel clip="armFront" autoplay={false} compact />)
  expect(screen.queryByRole('button', { name: 'Play' })).toBeNull()
  expect(screen.getByText(/Step 1 of 3/)).toBeInTheDocument()
})

test('markers render with text labels', () => {
  render(
    <AvatarPanel
      clip="idle"
      autoplay={false}
      markers={[
        { joint: 'lWrist', status: 'focus', label: 'Left hand' },
        { joint: 'lShoulder', status: 'watch', label: 'Left shoulder' },
        { joint: 'lElbow', status: 'stable', label: 'Left elbow' },
      ]}
      onMarkerTap={vi.fn()}
    />,
  )
  expect(screen.getByRole('button', { name: /Left hand · Focus/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Left shoulder · Watch/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Left elbow · Stable/ })).toBeInTheDocument()
})

test('play toggles to pause and slower halves the speed label', () => {
  render(<AvatarPanel clip="cup" autoplay={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Slower' }))
  expect(screen.getByText(/0\.5×/)).toBeInTheDocument()
})

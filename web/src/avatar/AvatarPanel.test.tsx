import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('./AvatarScene', () => ({
  AvatarScene: ({ clip }: { clip: { name: string; side: string } }) => (
    <div data-testid="scene">
      scene:{clip.name}:{clip.side}
    </div>
  ),
}))

import { AvatarPanel } from './AvatarPanel'

test('renders the scene, caption, controls and the reference-only label', () => {
  render(<AvatarPanel clip="cup" autoplay={false} />)
  expect(screen.getByTestId('scene')).toHaveTextContent('scene:cup:left')
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

test('markers render as tappable labels at least 18 px with a 56 px tap target and a leader line', () => {
  const onTap = vi.fn()
  render(
    <AvatarPanel
      clip="idle"
      autoplay={false}
      markers={[
        { joint: 'lWrist', status: 'focus', label: 'Left hand' },
        { joint: 'lShoulder', status: 'watch', label: 'Left shoulder' },
        { joint: 'lElbow', status: 'stable', label: 'Left elbow' },
      ]}
      onMarkerTap={onTap}
    />,
  )
  const hand = screen.getByRole('button', { name: /Left hand · Focus/ })
  expect(hand.className).toMatch(/text-base/)
  expect(hand.className).not.toMatch(/text-sm/)
  expect(hand.className).toMatch(/min-h-14/)
  expect(screen.getByRole('button', { name: /Left shoulder · Watch/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Left elbow · Stable/ })).toBeInTheDocument()
  expect(document.querySelectorAll('svg line')).toHaveLength(3)
  fireEvent.click(hand)
  expect(onTap).toHaveBeenCalledWith(expect.objectContaining({ joint: 'lWrist' }))
})

test('play toggles to pause and slower halves the speed label', () => {
  render(<AvatarPanel clip="cup" autoplay={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Slower' }))
  expect(screen.getByText(/0\.5×/)).toBeInTheDocument()
})

test('side="right" mirrors the clip; aspect and className reach the stage container', () => {
  const { container } = render(<AvatarPanel clip="cup" side="right" autoplay={false} aspect="3/4" className="my-panel" />)
  expect(screen.getByTestId('scene')).toHaveTextContent('scene:cup:right')
  expect(container.firstElementChild!.className).toMatch(/my-panel/)
  expect(container.querySelector('[data-stage]')!.className).toMatch(/aspect-\[3\/4\]/)
})

test('default aspect is 16/10, compact is 4/5 with a height cap', () => {
  const a = render(<AvatarPanel clip="cup" autoplay={false} />)
  expect(a.container.querySelector('[data-stage]')!.className).toMatch(/aspect-\[16\/10\]/)
  a.unmount()
  const b = render(<AvatarPanel clip="cup" autoplay={false} compact />)
  expect(b.container.querySelector('[data-stage]')!.className).toMatch(/aspect-\[4\/5\]/)
  expect(b.container.querySelector('[data-stage]')!.className).toMatch(/max-h-/)
})

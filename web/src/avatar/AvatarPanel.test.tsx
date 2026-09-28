import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('./AvatarScene', () => ({
  AvatarScene: ({ clip, figure }: { clip: { name: string; side: string }; figure?: string }) => (
    <div data-testid="scene">
      scene:{clip.name}:{clip.side}:{figure ?? 'body'}
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

test('rehab clips mount in skeleton mode (no WebGL in jsdom) with a labelled focus joint and the target readout', () => {
  render(<AvatarPanel clip="abduction" autoplay={false} />)
  expect(screen.getByTestId('scene')).toHaveTextContent('scene:abduction:left:skeleton')
  expect(screen.getByRole('button', { name: /Left shoulder · Focus/ })).toBeInTheDocument()
  expect(screen.getByTestId('arc-readout')).toHaveTextContent(/target 90°/)
  // provenance is for reviewers (title / data-provenance), not the patient's view line
  expect(screen.getByTestId('arc-readout')).not.toHaveTextContent(/UI-PRMD/)
  expect(screen.getByTestId('arc-readout')).toHaveAttribute('title', expect.stringMatching(/UI-PRMD s09 e08 · scaled to 90°/))
  expect(screen.getByTestId('view-line')).toHaveTextContent(/^Front view · 1×$/)
  expect(screen.getByTestId('view-line')).toHaveAttribute('data-provenance', expect.stringMatching(/skeleton view/))
  expect(screen.getByText(/Step 1 of 3/)).toBeInTheDocument()
})

test('the view line tells the patient only the view and the speed', () => {
  render(<AvatarPanel clip="cup" />)
  const line = screen.getByTestId('view-line')
  expect(line).toHaveTextContent(/^Front view · 1×$/)
  expect(line.textContent).not.toMatch(/procedural|UI-PRMD|motion|scaled/)
  expect(line.getAttribute('title')).toMatch(/procedural/)
})

test('rehab clips mirror to the right side and the figure mode can be forced either way', () => {
  const a = render(<AvatarPanel clip="flexion" side="right" autoplay={false} />)
  expect(screen.getByTestId('scene')).toHaveTextContent('scene:flexion:right:skeleton')
  expect(screen.getByRole('button', { name: /Right shoulder · Focus/ })).toBeInTheDocument()
  a.unmount()
  const b = render(<AvatarPanel clip="pendulum" figure="body" autoplay={false} />)
  expect(screen.getByTestId('scene')).toHaveTextContent('scene:pendulum:left:body')
  b.unmount()
  render(<AvatarPanel clip="cup" figure="skeleton" autoplay={false} />)
  expect(screen.getByTestId('scene')).toHaveTextContent('scene:cup:left:skeleton')
})

test('default aspect is 16/10, compact is 4/5 with a height cap', () => {
  const a = render(<AvatarPanel clip="cup" autoplay={false} />)
  expect(a.container.querySelector('[data-stage]')!.className).toMatch(/aspect-\[16\/10\]/)
  a.unmount()
  const b = render(<AvatarPanel clip="cup" autoplay={false} compact />)
  expect(b.container.querySelector('[data-stage]')!.className).toMatch(/aspect-\[4\/5\]/)
  expect(b.container.querySelector('[data-stage]')!.className).toMatch(/max-h-/)
})

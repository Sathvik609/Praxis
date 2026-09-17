import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { ProgressionPrompt } from './ProgressionPrompt'

function Harness({ onAccept = vi.fn(), onDecline = vi.fn() }: { onAccept?: () => void; onDecline?: () => void }) {
  const [why, setWhy] = useState(false)
  return <ProgressionPrompt reason="Two clean slow arcs, no unverified reaches." onAccept={onAccept} onDecline={onDecline} onWhy={() => setWhy((v) => !v)} whyOpen={why} />
}

test('highlight card with an icon, three ≥ 56 px choices, within-prescription chip', () => {
  const onAccept = vi.fn()
  const onDecline = vi.fn()
  const { container } = render(<Harness onAccept={onAccept} onDecline={onDecline} />)
  expect(screen.getByText(/Coach suggests: try the fast arcs/)).toBeInTheDocument()
  expect(screen.getByText('Within prescription')).toBeInTheDocument()
  expect(container.firstElementChild?.className).toMatch(/border-teal-ink/)
  expect(container.querySelector('h2 svg')).not.toBeNull()
  const buttons = screen.getAllByRole('button')
  expect(buttons.map((b) => b.textContent)).toEqual(['Yes, go faster', 'Keep pace', 'Why?'])
  for (const b of buttons) expect(b.className).toMatch(/min-h-14/)
  fireEvent.click(buttons[0])
  fireEvent.click(buttons[1])
  expect(onAccept).toHaveBeenCalled()
  expect(onDecline).toHaveBeenCalled()
})

test('"Why?" expands the explanation inline and is announced as expanded', () => {
  render(<Harness />)
  const why = screen.getByRole('button', { name: 'Why?' })
  expect(why).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText(/Nothing goes above the prescribed level/)).toBeNull()
  fireEvent.click(why)
  expect(why).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText(/Nothing goes above the prescribed level/)).toBeInTheDocument()
  fireEvent.click(why)
  expect(screen.queryByText(/Nothing goes above the prescribed level/)).toBeNull()
})

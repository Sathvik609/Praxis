import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import type { Prompt } from '../../session/agent'
import { CoachPrompt } from './CoachPrompt'

const progression: Prompt = { id: 'progression', title: 'Coach suggests: try the fast arcs', text: 'Two clean slow arcs, no unverified reaches.', options: ['Yes, go faster', 'Keep pace', 'Why?'], within_prescription: true }
const adjustment: Prompt = {
  id: 'p7', kind: 'adjustment', title: 'Coach suggests: a lower target for now', text: 'Your last three lifts peaked lower each time.',
  options: ['Yes, lower it', 'Keep 90°', 'Why?'], within_prescription: true,
  proposal: { exercise: 'arm', field: 'target_deg', value: 75, requested: 75, clamped: false, unit: '°' },
}
const resume: Prompt = { id: 'p9', kind: 'resume', title: 'Setup looks good — resume?', text: 'All four markers are back in view.', options: ['Yes, resume', 'Not yet'], within_prescription: true }

function Harness({ prompt, onChoose = vi.fn(), whyText = 'Your program assigns 2 slow arcs then 2 fast arcs.' }: { prompt: Prompt; onChoose?: (c: string, i: number) => void; whyText?: string | null }) {
  const [why, setWhy] = useState(false)
  return (
    <CoachPrompt
      prompt={prompt}
      proposalContext={{ from: 90, range: [60, 90] }}
      onChoose={(c, i) => {
        if (/^why/i.test(c)) setWhy((v) => !v)
        onChoose(c, i)
      }}
      whyOpen={why}
      whyText={whyText}
    />
  )
}

test('progression: highlight card with an icon, three ≥ 56 px choices, within-prescription badge', () => {
  const onChoose = vi.fn()
  const { container } = render(<Harness prompt={progression} onChoose={onChoose} />)
  expect(screen.getByText(/Coach suggests: try the fast arcs/)).toBeInTheDocument()
  expect(screen.getByText('Within your prescription')).toBeInTheDocument()
  expect(screen.getByText('Two clean slow arcs, no unverified reaches.')).toBeInTheDocument()
  expect(container.firstElementChild?.className).toMatch(/border-teal-ink/)
  expect(container.querySelector('h2 svg')).not.toBeNull()
  const buttons = screen.getAllByRole('button')
  expect(buttons.map((b) => b.textContent)).toEqual(['Yes, go faster', 'Keep pace', 'Why?'])
  for (const b of buttons) expect(b.className).toMatch(/min-h-14/)
  // accept is the primary action; the others are secondary
  expect(buttons[0].className).toMatch(/bg-teal-fill/)
  expect(buttons[1].className).not.toMatch(/bg-teal-fill/)
  fireEvent.click(buttons[0])
  fireEvent.click(buttons[1])
  expect(onChoose).toHaveBeenNthCalledWith(1, 'Yes, go faster', 0)
  expect(onChoose).toHaveBeenNthCalledWith(2, 'Keep pace', 1)
})

test('"Why?" expands the reason inline and is announced as expanded', () => {
  render(<Harness prompt={progression} />)
  const why = screen.getByRole('button', { name: 'Why?' })
  expect(why).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText(/2 slow arcs then 2 fast arcs/)).toBeNull()
  fireEvent.click(why)
  expect(why).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText(/2 slow arcs then 2 fast arcs/)).toBeInTheDocument()
  fireEvent.click(why)
  expect(screen.queryByText(/2 slow arcs then 2 fast arcs/)).toBeNull()
})

test('"Why?" before the reason arrives says the coach is being asked', () => {
  render(<Harness prompt={progression} whyText={null} />)
  fireEvent.click(screen.getByRole('button', { name: 'Why?' }))
  expect(screen.getByRole('status')).toHaveTextContent(/Asking the coach why/)
})

test('adjustment: the proposal in plain words with the program range', () => {
  render(<Harness prompt={adjustment} />)
  expect(screen.getByText('Target 90° → 75° (your program allows 60–90°)')).toBeInTheDocument()
  expect(screen.queryByText(/adjusted to your program’s limit/)).toBeNull()
  expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Yes, lower it', 'Keep 90°', 'Why?'])
})

test('adjustment: a clamped proposal says it was adjusted to the program limit', () => {
  const clamped: Prompt = { ...adjustment, proposal: { exercise: 'arm', field: 'target_deg', value: 60, requested: 45, clamped: true, unit: '°' } }
  render(<Harness prompt={clamped} />)
  expect(screen.getByText(/Target 90° → 60° \(your program allows 60–90°\)/)).toBeInTheDocument()
  expect(screen.getByText(/adjusted to your program’s limit/)).toBeInTheDocument()
})

test('no badge when the proposal is not within the prescription', () => {
  render(<Harness prompt={{ ...adjustment, within_prescription: false }} />)
  expect(screen.queryByText('Within your prescription')).toBeNull()
})

test('resume: "Setup looks good — resume?" with Yes as the primary action and no Why', () => {
  const onChoose = vi.fn()
  render(<Harness prompt={resume} onChoose={onChoose} />)
  expect(screen.getByRole('heading', { name: /Setup looks good — resume\?/ })).toBeInTheDocument()
  const buttons = screen.getAllByRole('button')
  expect(buttons.map((b) => b.textContent)).toEqual(['Yes, resume', 'Not yet'])
  expect(buttons[0].className).toMatch(/bg-teal-fill/)
  fireEvent.click(buttons[1])
  expect(onChoose).toHaveBeenCalledWith('Not yet', 1)
})

test('a prompt with no title falls back to a title for its kind', () => {
  render(<Harness prompt={{ ...resume, title: '' }} />)
  expect(screen.getByRole('heading', { name: /Setup looks good — resume\?/ })).toBeInTheDocument()
})

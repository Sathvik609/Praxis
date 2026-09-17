import { fireEvent, render, screen } from '@testing-library/react'
import { ExertionChip, PainCheck, SessionOverlay } from './SessionOverlays'

test('paused overlay explains why and offers resume', () => {
  const onResume = vi.fn()
  render(<SessionOverlay overlay={{ kind: 'paused', rule: 'perception', text: 'I lost tracking.' }} onResume={onResume} onEnd={vi.fn()} />)
  expect(screen.getByText(/Tracking lost/)).toBeInTheDocument()
  expect(screen.getByText(/I lost tracking/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
  expect(onResume).toHaveBeenCalled()
})

test('stopped overlay names the rule and says the therapist is flagged', () => {
  render(<SessionOverlay overlay={{ kind: 'stopped', rule: 'pain', text: 'Pain 6/10' }} onResume={vi.fn()} onEnd={vi.fn()} />)
  expect(screen.getByText(/Session ended/)).toBeInTheDocument()
  expect(screen.getByText(/therapist/i)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Save and continue/ })).toBeInTheDocument()
})

test('rest overlay offers "Rested — continue"', () => {
  render(<SessionOverlay overlay={{ kind: 'rest', rule: 'exertion', text: 'Take a minute.' }} onResume={vi.fn()} onEnd={vi.fn()} />)
  expect(screen.getByText('Rest break')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Rested — continue' })).toBeInTheDocument()
})

test('pain check sends the chosen level', () => {
  const onSubmit = vi.fn()
  render(<PainCheck open onSubmit={onSubmit} onCancel={vi.fn()} />)
  fireEvent.click(screen.getByRole('radio', { name: '6' }))
  fireEvent.click(screen.getByRole('button', { name: /Send/ }))
  expect(onSubmit).toHaveBeenCalledWith(6)
})

test('exertion chip always carries the behavioural label, an icon, and ≥ 18 px reasons in a card', () => {
  const { container } = render(<ExertionChip exertion={{ level: 'high', reasons: ['RPE 8/10', 'reps getting slower'], method: 'behavioural' }} />)
  expect(screen.getByText(/Exertion: high/)).toBeInTheDocument()
  const reasons = screen.getByText(/behavioural/)
  expect(reasons.textContent).toMatch(/RPE 8\/10 · reps getting slower/)
  expect(reasons.className).toMatch(/text-lg/)
  expect(container.querySelector('svg')).not.toBeNull()
  expect(container.firstElementChild?.className).toMatch(/rounded-\[var\(--r-card\)\]/)
})

test('exertion chip with no data reads low · no signs yet', () => {
  render(<ExertionChip exertion={null} />)
  expect(screen.getByText(/Exertion: low/)).toBeInTheDocument()
  expect(screen.getByText(/no signs yet/)).toBeInTheDocument()
})

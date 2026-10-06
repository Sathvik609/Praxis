import { act, fireEvent, render, screen } from '@testing-library/react'
import { ExertionChip, PainCheck, RestOverlay, SessionOverlay } from './SessionOverlays'

test('paused overlay explains why and offers resume', () => {
  const onResume = vi.fn()
  render(<SessionOverlay overlay={{ kind: 'paused', rule: 'perception', text: 'I lost tracking.' }} onResume={onResume} onEnd={vi.fn()} />)
  expect(screen.getByText(/Tracking lost/)).toBeInTheDocument()
  expect(screen.getByText(/I lost tracking/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
  expect(onResume).toHaveBeenCalled()
})

test('paused overlay carries the coach cue said during the pause and an open coach prompt', () => {
  render(
    <SessionOverlay
      overlay={{ kind: 'paused', rule: 'failed_reps', text: 'Three reps in a row were not verified.' }}
      note={{ text: 'Marker 2 is covered — move the cup a little left.', label: 'Claude agent · Anthropic API (dev)', source: 'agent' }}
      prompt={<button type="button">Yes, resume</button>}
      resumeByPrompt
      onResume={vi.fn()}
      onEnd={vi.fn()}
    />,
  )
  expect(screen.getByText(/Marker 2 is covered/)).toBeInTheDocument()
  expect(screen.getByText('Claude agent · Anthropic API (dev)')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Yes, resume' })).toBeInTheDocument()
  // the prompt's own Yes resumes; the overlay's Resume is not offered twice, End session stays
  expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
  expect(screen.getByRole('button', { name: 'End session' })).toBeInTheDocument()
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

test('pain check states the real stop level (7, from the plan), never 5', () => {
  render(<PainCheck open onSubmit={vi.fn()} onCancel={vi.fn()} />)
  expect(screen.getByText(/Pain at or above 7 ends the session/)).toBeInTheDocument()
  expect(screen.queryByText(/above 5/)).not.toBeInTheDocument()
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

test('rest overlay counts the rest up, offers continue and end, and is not the pause overlay', () => {
  vi.useFakeTimers()
  try {
    const onResume = vi.fn()
    const onEnd = vi.fn()
    const since = Date.now()
    render(<RestOverlay since={since} onResume={onResume} onEnd={onEnd} />)
    expect(screen.getByRole('dialog', { name: 'Resting' })).toBeInTheDocument()
    expect(screen.getByText('0:00')).toBeInTheDocument()
    // the designers' big-number look (designer.css .ui-stat-num), same as Stat
    expect(screen.getByText('0:00')).toHaveClass('ui-stat-num')
    act(() => {
      vi.advanceTimersByTime(65_000)
    })
    expect(screen.getByText('1:05')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Rested — continue' }))
    expect(onResume).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    expect(onEnd).toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

test('no rest overlay without a rest', () => {
  render(<RestOverlay since={null} onResume={vi.fn()} onEnd={vi.fn()} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('compact exertion chip: one line in the artifact classes, word + icon + reasons', () => {
  const { container } = render(<ExertionChip compact exertion={{ level: 'moderate', reasons: ['reps getting slower'], method: 'behavioural' }} />)
  const chip = screen.getByText(/Exertion: moderate/)
  expect(chip).toHaveClass('sx-chip', 'sx-chip-amber')
  expect(chip.querySelector('svg')).not.toBeNull()
  expect(screen.getByText('behavioural index · reps getting slower')).toHaveClass('sx-small')
  expect(container.querySelector('.ui-card, [class*="rounded-[var(--r-card)]"]')).toBeNull()
})

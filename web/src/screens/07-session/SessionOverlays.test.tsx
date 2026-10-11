import { fireEvent, render, screen } from '@testing-library/react'
import { mockApi, PRESCRIPTION } from '../../test/api-mock'
import { ExertionChip, PainCheck, SessionOverlay } from './SessionOverlays'

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

test('stopped overlay names the rule and says the therapist is flagged once, in the service\'s words', () => {
  // 10 Oct walkthrough: the service's stop text and a fixed web line both said "saved" and
  // "therapist is flagged". The service writes the flag with the stop, so its text is the one statement.
  const text = 'Pain 8/10 is at your stop level. Session ended and saved; your therapist is flagged.'
  render(<SessionOverlay overlay={{ kind: 'stopped', rule: 'pain', text }} onResume={vi.fn()} onEnd={vi.fn()} />)
  expect(screen.getByRole('alertdialog', { name: 'Session ended · pain at stop level' })).toBeInTheDocument() // a stop is announced as an alert
  expect(screen.getByText(text)).toBeInTheDocument()
  const body = screen.getByRole('alertdialog').textContent ?? ''
  expect(body.match(/therapist/gi)).toHaveLength(1)
  expect(body.match(/saved/gi)).toHaveLength(1)
  expect(screen.getByRole('button', { name: /Save and continue/ })).toBeInTheDocument()
})

test('pain check states the prescription\'s stop level (stop_rules.pain_max), the one the service applies', async () => {
  mockApi({ '/api/prescription': { ...PRESCRIPTION, stop_rules: { ...PRESCRIPTION.stop_rules, pain_max: 6 } } })
  render(<PainCheck open onSubmit={vi.fn()} onCancel={vi.fn()} />)
  expect(await screen.findByText(/Pain at or above 6 ends the session/)).toBeInTheDocument()
  expect(screen.queryByText(/above 7|above 5/)).not.toBeInTheDocument()
  vi.unstubAllGlobals()
})

test('pain check without the prescription names the stop level, never a number it does not know', async () => {
  mockApi({})
  render(<PainCheck open onSubmit={vi.fn()} onCancel={vi.fn()} />)
  expect(await screen.findByText(/Pain at or above your stop level ends the session/)).toBeInTheDocument()
  vi.unstubAllGlobals()
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

test('compact exertion chip: one line in the artifact classes, word + icon + reasons', () => {
  const { container } = render(<ExertionChip compact exertion={{ level: 'moderate', reasons: ['reps getting slower'], method: 'behavioural' }} />)
  const chip = screen.getByText(/Exertion: moderate/)
  expect(chip).toHaveClass('sx-chip', 'sx-chip-amber')
  expect(chip.querySelector('svg')).not.toBeNull()
  expect(screen.getByText('behavioural index · reps getting slower')).toHaveClass('sx-small')
  expect(container.querySelector('.ui-card, [class*="rounded-[var(--r-card)]"]')).toBeNull()
})

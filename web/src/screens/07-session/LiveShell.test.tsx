import { render, screen } from '@testing-library/react'
import { AgentStatusChip, CoachCard } from './LiveShell'

test('rule coach card: the label and the rule icon', () => {
  const { container } = render(<CoachCard text="Lift slowly." label="Rule-based coach" source="rule" />)
  expect(screen.getByText('Lift slowly.')).toBeInTheDocument()
  const label = screen.getByText('Rule-based coach')
  expect(label.closest('[data-source]')).toHaveAttribute('data-source', 'rule')
  expect(container.querySelector('[data-source="rule"] svg')).not.toBeNull()
})

test('agent coach card: its own label and a different icon, so it never relies on colour', () => {
  const { container } = render(<CoachCard text="Marker 2 is covered — move the cup a little left." label="Claude agent · Anthropic API (dev)" source="agent" />)
  expect(screen.getByText('Claude agent · Anthropic API (dev)')).toBeInTheDocument()
  const agentIcon = container.querySelector('[data-source="agent"] svg')?.getAttribute('class')
  const { container: rule } = render(<CoachCard text="x" label="Rule-based coach" source="rule" />)
  const ruleIcon = rule.querySelector('[data-source="rule"] svg')?.getAttribute('class')
  expect(agentIcon).toBeTruthy()
  expect(agentIcon).not.toEqual(ruleIcon)
  // cue text stays ≥ 24 px
  expect(screen.getByText(/Marker 2 is covered/).className).toMatch(/text-2xl/)
})

test('legacy card with no source renders as the rule coach', () => {
  render(<CoachCard text="Next peg." label="Rule-based coach · LLM agent pending" />)
  expect(screen.getByText('Rule-based coach · LLM agent pending').closest('[data-source]')).toHaveAttribute('data-source', 'rule')
})

test('status chip: nothing when idle or never seen, but the live region is always there', () => {
  const { rerender } = render(<AgentStatusChip status={null} />)
  const region = screen.getByRole('status')
  expect(region).toHaveAttribute('aria-live', 'polite')
  expect(region).toBeEmptyDOMElement()
  rerender(<AgentStatusChip status={{ state: 'idle', label: 'Claude agent · Anthropic API (dev)' }} />)
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
})

test('status chip: "Coach is thinking…" while a run is in progress', () => {
  render(<AgentStatusChip status={{ state: 'thinking', trigger: 'set_complete', label: 'Claude agent · Anthropic API (dev)' }} />)
  expect(screen.getByRole('status')).toHaveTextContent('Coach is thinking…')
})

test('status chip: offline says the rule coach carries on, with the reason as a tooltip and description', () => {
  render(<AgentStatusChip status={{ state: 'offline', reason: 'model timeout', label: 'Rule-based coach' }} />)
  const chip = screen.getByText('Coach offline · rule coach')
  const holder = chip.closest('[title]')
  expect(holder).toHaveAttribute('title', 'model timeout')
  expect(holder).toHaveAccessibleDescription('model timeout')
})

import { render, screen } from '@testing-library/react'
import { AgentStatusChip } from './LiveShell'

test('status chip: nothing when idle or never seen, but the live region is always there', () => {
  const { rerender } = render(<AgentStatusChip status={null} />)
  const region = screen.getByTestId('agent-status')
  expect(region).toHaveAttribute('aria-live', 'polite')
  expect(region).toBeEmptyDOMElement()
  rerender(<AgentStatusChip status={{ state: 'idle', label: 'Claude agent · Anthropic API (dev)' }} />)
  expect(screen.getByTestId('agent-status')).toBeEmptyDOMElement()
})

test('status chip: "Coach is thinking…" while a run is in progress', () => {
  render(<AgentStatusChip status={{ state: 'thinking', trigger: 'set_complete', label: 'Claude agent · Anthropic API (dev)' }} />)
  expect(screen.getByTestId('agent-status')).toHaveTextContent('Coach is thinking…')
})

test('status chip: offline says the rule coach carries on, with the reason as a tooltip and description', () => {
  render(<AgentStatusChip status={{ state: 'offline', reason: 'model timeout', label: 'Rule-based coach' }} />)
  const chip = screen.getByText('Coach offline · rule coach')
  const holder = chip.closest('[title]')
  expect(holder).toHaveAttribute('title', 'model timeout')
  expect(holder).toHaveAccessibleDescription('model timeout')
})

test('status chip: "thinking" is shown but not announced (the caption that follows is), offline is announced', () => {
  const { rerender } = render(<AgentStatusChip status={{ state: 'thinking', trigger: 'set_complete', label: 'Claude agent' }} />)
  expect(screen.getByText('Coach is thinking…').closest('[aria-hidden="true"]')).not.toBeNull()
  rerender(<AgentStatusChip status={{ state: 'offline', reason: 'model timeout', label: 'Rule-based coach' }} />)
  expect(screen.getByText('Coach offline · rule coach').closest('[aria-hidden="true"]')).toBeNull()
})

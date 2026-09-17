import { fireEvent, render, screen } from '@testing-library/react'
import { TracePanel, traceRows } from './TracePanel'

const events = [
  { type: 'frame', t: 0.1, id: 1 },
  { type: 'rep_complete', t: 1.2, id: 2, peg: 1, split_s: 3.4 },
  { type: 'coach', t: 1.3, id: 3, action: 'instruct', cue_id: 'next_peg', reason: 'peg seated', evidence: [2], text: 'Next peg.', tool_calls: [{ tool: 'get_events' }] },
  { type: 'pause', t: 2.0, id: 4, rule: 'perception', detail: 'markers lost' },
]

test('frames are filtered out and rows carry a timestamp, kind and payload', () => {
  const rows = traceRows(events)
  expect(rows.map((r) => r.type)).toEqual(['rep_complete', 'coach', 'pause'])
})

test('panel shows event → decide → tool → action → stop-rule lines in monospace at ≥ 16 px with a sticky header', () => {
  const { container } = render(<TracePanel events={events} />)
  expect(container.firstElementChild?.className).toMatch(/font-mono/)
  expect(container.firstElementChild?.className).toMatch(/text-base/)
  expect(container.querySelector('.sticky')).not.toBeNull()
  expect(screen.getByText('event')).toBeInTheDocument()
  expect(screen.getByText('decide')).toBeInTheDocument()
  expect(screen.getByText('tool')).toBeInTheDocument()
  expect(screen.getByText('action')).toBeInTheDocument()
  expect(screen.getByText('stop-rule')).toBeInTheDocument()
  expect(screen.getByText(/get_events\(\)/)).toBeInTheDocument()
  expect(screen.getByText(/markers lost/)).toBeInTheDocument()
  expect(screen.getByText(/Rule-based coach · LLM agent pending/)).toBeInTheDocument()
})

test('Live / Replay chip follows the replay prop', () => {
  const { rerender } = render(<TracePanel events={[]} />)
  expect(screen.getByText('Live')).toBeInTheDocument()
  rerender(<TracePanel events={[]} replay />)
  expect(screen.getByText('Replay')).toBeInTheDocument()
  expect(screen.getByText(/waiting for events/)).toBeInTheDocument()
})

test('Copy JSON copies the shown rows and confirms', async () => {
  const writeText = vi.fn(async (_text: string) => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  render(<TracePanel events={events} />)
  const btn = screen.getByRole('button', { name: 'Copy JSON' })
  expect(btn.className).toMatch(/min-h-14/)
  fireEvent.click(btn)
  expect(writeText).toHaveBeenCalledTimes(1)
  const copied = JSON.parse(writeText.mock.calls[0][0])
  expect(copied).toHaveLength(3)
  expect(copied[0].type).toBe('rep_complete')
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
})

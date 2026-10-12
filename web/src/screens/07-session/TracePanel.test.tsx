import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { mockApi } from '../../test/api-mock'
import { TracePanel, traceRows } from './TracePanel'

const AGENT = 'Claude agent · Anthropic API (dev)'
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const agentEvents = [
  { type: 'command', t: 0.5, id: 39, cmd: 'checkin', ok: true, session_id: 's1' },
  { type: 'rep_complete', t: 1, id: 40, set: 1, rep: 8 },
  { type: 'set_complete', t: 2, id: 41, set: 1 },
  { type: 'agent_status', t: 2.1, id: 42, state: 'thinking', trigger: 'set_complete', label: AGENT },
  { type: 'coach', t: 4, id: 43, action: 'correct', cue_id: 'agent', reason: 'marker 2 covered', evidence: [41], text: 'Move your sleeve off marker 2.', ui: {}, label: AGENT, source: 'agent' },
  { type: 'rep_complete', t: 5, id: 44, set: 2, rep: 1 },
]
let seq = 0
const row = (kind: string, f: Record<string, unknown> = {}) => ({ ...f, seq: ++seq, ts: 1000 + seq, session: 's1', kind })
const agentRows = () => {
  seq = 0
  return [
    row('event', { type: 'rep_complete', id: 40, t: 1 }),
    row('event', { type: 'set_complete', id: 41, t: 2 }),
    row('agent_run', { phase: 'start', trigger: 'set_complete', model: 'claude-sonnet-5', transport: 'mcp' }),
    row('tool', { server: 'perception', name: 'check_setup', args: {}, ok: true, ms: 120, transport: 'mcp', result_summary: 'marker 2 covered; lighting low' }),
    row('tool', { server: 'coach', name: 'speak', args: {}, ok: false, ms: 2, transport: 'mcp', result_summary: 'rate limited' }),
    row('decide', { action: 'correct', reason: 'marker 2 covered', evidence: [41, 42], label: AGENT }),
    row('action', { text: 'Move your sleeve off marker 2.', label: AGENT }),
    row('agent_run', { phase: 'end', trigger: 'set_complete', model: 'claude-sonnet-5', transport: 'mcp', ms: 2400, input_tokens: 1800, output_tokens: 210, outcome: 'ok' }),
    row('event', { type: 'rep_complete', id: 44, t: 5 }),
    row('agent_run', { phase: 'start', trigger: 'rep_complete', model: 'claude-sonnet-5', transport: 'direct' }),
    row('agent_error', { error_kind: 'timeout', message: 'run exceeded 15 s' }),
  ]
}

test('agent runs render under their perception event: run header, tools with ✓ / ✕, decide, action, error', () => {
  render(<TracePanel events={agentEvents} agentRows={agentRows()} />)
  const runs = screen.getAllByRole('button', { name: /agent run/ })
  expect(runs).toHaveLength(2)
  expect(runs[0]).toHaveTextContent('agent run · trigger set_complete · Sonnet 5 · mcp')
  expect(runs[0]).toHaveTextContent(/2\.4 s/)
  expect(runs[0].className).toMatch(/min-h-14/)
  expect(screen.getByText(/perception\.check_setup/).closest('div')).toHaveTextContent('perception.check_setup ✓ ok 120 ms — marker 2 covered; lighting low')
  expect(screen.getByText(/coach\.speak/).closest('div')).toHaveTextContent('coach.speak ✕ failed 2 ms — rate limited')
  expect(screen.getByText(/correct · evidence #41 #42/)).toBeInTheDocument()
  expect(screen.getByText(/speak “Move your sleeve off marker 2\.”/)).toBeInTheDocument()
  expect(screen.getByText(/agent error · timeout/)).toBeInTheDocument()
  // the run group comes right after its trigger event (set_complete #41), before rep #44
  const text = screen.getByTestId('trace-rows').textContent ?? ''
  expect(text.indexOf('#41 set_complete')).toBeLessThan(text.indexOf('agent run · trigger set_complete'))
  expect(text.indexOf('agent run · trigger set_complete')).toBeLessThan(text.indexOf('#44 rep_complete'))
  // the agent's coach event is shown once, inside its run, not again as a rule-style decide row
  expect(screen.getAllByText(/Move your sleeve off marker 2/)).toHaveLength(1)
  // the header names both coaches
  expect(screen.getByText(new RegExp(`${esc(AGENT)} at checkpoints`))).toBeInTheDocument()
})

test('live events carry wall-clock time: rows show the clock, never raw epoch seconds (e2e 11 Oct)', () => {
  const t = new Date(2026, 9, 11, 14, 3, 21, 400).getTime() / 1000
  render(<TracePanel events={[{ type: 'rep_complete', t, id: 7 }] as never} agentRows={[]} />)
  const rows = screen.getByTestId('trace-rows')
  expect(rows).toHaveTextContent('14:03:21.4')
  expect(rows.textContent).not.toMatch(/\d{9,}/)
})

test('replay events keep clip seconds', () => {
  render(<TracePanel events={[{ type: 'rep_complete', t: 12.34, id: 7 }] as never} agentRows={[]} replay />)
  expect(screen.getByTestId('trace-rows')).toHaveTextContent('12.3 s')
})

test('each agent run collapses and expands from its header', () => {
  render(<TracePanel events={agentEvents} agentRows={agentRows()} />)
  const run = screen.getAllByRole('button', { name: /agent run/ })[0]
  expect(run).toHaveAttribute('aria-expanded', 'true')
  const group = document.getElementById(run.getAttribute('aria-controls') ?? '')!
  expect(within(group).getByText(/perception\.check_setup/)).toBeInTheDocument()
  fireEvent.click(run)
  expect(run).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText(/perception\.check_setup/)).toBeNull()
})

test('without trace rows an agent coach event still shows, tagged with its label', () => {
  render(<TracePanel events={agentEvents} agentRows={[]} />)
  expect(screen.getByText(/Move your sleeve off marker 2/)).toBeInTheDocument()
  expect(screen.getAllByText(new RegExp(esc(AGENT))).length).toBeGreaterThan(0)
})

test('the panel polls /api/trace for the socket session when no rows are passed', async () => {
  const fetchMock = mockApi({ '/api/trace': { session: 's1', rows: agentRows() } })
  render(<TracePanel events={agentEvents} />)
  await waitFor(() => expect(screen.getAllByRole('button', { name: /agent run/ })).toHaveLength(2))
  expect(String(fetchMock.mock.calls[0][0])).toContain('session=s1')
  vi.unstubAllGlobals()
})

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

test('agent runs whose trigger event scrolled out of the 40-event window still show, under "Earlier agent runs"', () => {
  // 60 later events push set_complete #41 (the run's trigger) out of the window
  const later = Array.from({ length: 60 }, (_, i) => ({ type: 'rep_complete', t: 10 + i, id: 100 + i, set: 2, rep: i + 1 }))
  render(<TracePanel events={[...agentEvents, ...later]} agentRows={agentRows()} />)
  expect(screen.getByText('Earlier agent runs')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /agent run/ }).length).toBeGreaterThanOrEqual(1)
  expect(screen.getAllByRole('button', { name: /agent run/ })[0]).toHaveTextContent('trigger set_complete')
})

test('with the agent on and no rule-coach line in the window, the header never says "LLM agent pending"', () => {
  render(<TracePanel events={agentEvents} agentRows={agentRows()} />)
  expect(screen.getByText(new RegExp(`${esc(AGENT)} at checkpoints · Rule-based coach between them`))).toBeInTheDocument()
  expect(screen.queryByText(/LLM agent pending/)).toBeNull()
})

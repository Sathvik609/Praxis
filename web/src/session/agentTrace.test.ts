import { agentRuns, isAgentRow, sessionIdOf, toolLine } from './agentTrace'

const AGENT = 'Claude agent · Anthropic API (dev)'
let seq = 0
// like the service's Trace.log: the row kind wins over a field named kind
const row = (kind: string, f: Record<string, unknown> = {}) => ({ ...f, seq: ++seq, ts: 1000 + seq, session: 's1', kind })

function scenario() {
  seq = 0
  return [
    row('session', { mode: 'arm' }),
    row('event', { type: 'rep_complete', id: 40, t: 1 }),
    row('event', { type: 'set_complete', id: 41, t: 2 }),
    row('event', { type: 'exertion', id: 42, t: 2.1 }),
    row('decide', { action: 'instruct', cue_id: 'set_done', reason: 'set complete', evidence: [41], label: 'Rule-based coach' }),
    row('tool', { tool: 'get_events', args: {} }), // the rule coach's own tool row (no server)
    row('agent_run', { phase: 'start', trigger: 'set_complete', model: 'claude-sonnet-5', transport: 'mcp' }),
    row('tool', { server: 'perception', name: 'get_set_summary', args: {}, ok: true, ms: 40, transport: 'mcp', result_summary: '8 reps, 8 verified, peaks 88→77°' }),
    row('tool', { server: 'exertion', name: 'get_exertion_state', args: {}, ok: true, ms: 12, transport: 'mcp', result_summary: 'moderate' }),
    row('decide', { action: 'regress', reason: 'peaks falling, exertion moderate', evidence: [41, 42], label: AGENT }),
    row('action', { text: 'Try a lower target for set 2?', label: AGENT }),
    row('agent_run', { phase: 'end', trigger: 'set_complete', model: 'claude-sonnet-5', transport: 'mcp', ms: 2400, input_tokens: 1800, output_tokens: 210, outcome: 'ok' }),
    row('event', { type: 'pause', id: 50, t: 9 }),
    row('agent_run', { phase: 'start', trigger: 'pause:perception', model: 'claude-sonnet-5', transport: 'direct' }),
    row('tool', { server: 'perception', name: 'check_setup', args: {}, ok: false, ms: 15000, transport: 'direct', result_summary: 'timeout' }),
    row('agent_error', { error_kind: 'timeout', message: 'run exceeded 15 s' }),
  ]
}

test('agent runs group their tool, decide and action rows; rule rows stay out', () => {
  const runs = agentRuns(scenario())
  expect(runs).toHaveLength(2)
  const [a, b] = runs
  expect(a.trigger).toBe('set_complete')
  expect(a.model).toBe('claude-sonnet-5')
  expect(a.transport).toBe('mcp')
  expect(a.ended).toBe(true)
  expect(a.ms).toBe(2400)
  expect(a.outcome).toBe('ok')
  expect(a.steps.map((s) => s.kind)).toEqual(['tool', 'tool', 'decide', 'action'])
  expect(b.trigger).toBe('pause:perception')
  expect(b.transport).toBe('direct')
  expect(b.steps.map((s) => s.kind)).toEqual(['tool', 'agent_error'])
})

test('a run sits under the perception event that triggered it, else the last event before it', () => {
  const [a, b] = agentRuns(scenario())
  expect(a.anchorId).toBe(41) // set_complete, not the later exertion event
  expect(b.anchorId).toBe(50) // "pause:perception" → the pause event
})

test('agent rows are told apart from rule rows by label, source or tool server', () => {
  expect(isAgentRow({ kind: 'decide', label: AGENT })).toBe(true)
  expect(isAgentRow({ kind: 'decide', label: 'Rule-based coach' })).toBe(false)
  expect(isAgentRow({ kind: 'action', source: 'agent' })).toBe(true)
  expect(isAgentRow({ kind: 'tool', server: 'coach', name: 'speak' })).toBe(true)
  expect(isAgentRow({ kind: 'tool', tool: 'get_events' })).toBe(false)
})

test('tool line: server.name, ok mark, time and result summary', () => {
  expect(toolLine({ server: 'perception', name: 'check_setup', ok: true, ms: 120, result_summary: 'marker 2 covered; lighting low' })).toEqual({ name: 'perception.check_setup', ok: true, ms: '120 ms', summary: 'marker 2 covered; lighting low' })
  expect(toolLine({ server: 'coach', name: 'speak', ok: false, ms: 3 }).ok).toBe(false)
})

test('the session id comes from the latest event that carries one', () => {
  expect(sessionIdOf([{ type: 'frame', t: 1, id: 1 }])).toBeNull()
  expect(sessionIdOf([{ type: 'replay_start', t: 0, id: 1, session_id: 'r1' }, { type: 'command', t: 1, id: 2, cmd: 'checkin', session_id: 'r1' }])).toBe('r1')
})

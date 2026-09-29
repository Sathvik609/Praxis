import type { PraxisEvent } from '../lib/events'
import { COACH_LABEL, coachLabel, coachSource, describeProposal, healthLines, latestAgentStatus, modelName, promptKind } from './agent'

const coach = (id: number, extra: Record<string, unknown> = {}): PraxisEvent => ({ type: 'coach', t: id, id, action: 'instruct', cue_id: 'x', text: `Cue ${id}`, reason: 'r', evidence: [], ui: {}, ...extra })

test('coach source: agent only when the event says so; legacy events without source are rule', () => {
  expect(coachSource(coach(1, { source: 'agent', label: 'Claude agent · Anthropic API (dev)' }))).toBe('agent')
  expect(coachSource(coach(2, { source: 'rule', label: 'Rule-based coach' }))).toBe('rule')
  expect(coachSource(coach(3, { label: 'Rule-based coach · LLM agent pending' }))).toBe('rule')
  expect(coachSource(null)).toBe('rule')
})

test('coach label: the event label, else the pending rule label', () => {
  expect(coachLabel(coach(1, { source: 'agent', label: 'Claude agent · Amazon Bedrock' }))).toBe('Claude agent · Amazon Bedrock')
  expect(coachLabel(coach(2))).toBe(COACH_LABEL)
  expect(coachLabel(null)).toBe('Rule-based coach · LLM agent pending')
})

test('agent status: the latest agent_status event, null when never seen', () => {
  expect(latestAgentStatus([coach(1)])).toBeNull()
  const evs: PraxisEvent[] = [
    { type: 'agent_status', t: 1, id: 1, state: 'thinking', trigger: 'set_complete', label: 'Claude agent · Anthropic API (dev)' },
    { type: 'agent_status', t: 2, id: 2, state: 'offline', reason: 'timeout', label: 'Rule-based coach' },
  ]
  expect(latestAgentStatus(evs)).toEqual({ state: 'offline', trigger: undefined, reason: 'timeout', label: 'Rule-based coach' })
  expect(latestAgentStatus(evs.slice(0, 1))?.state).toBe('thinking')
})

test('model ids read as family + version', () => {
  expect(modelName('claude-sonnet-5')).toBe('Sonnet 5')
  expect(modelName('us.anthropic.claude-sonnet-5-v1:0')).toBe('Sonnet 5')
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelName('scripted')).toBe('scripted')
  expect(modelName(undefined)).toBe('')
})

test('prompt kind: explicit kind, else the legacy progression prompt', () => {
  expect(promptKind({ id: 'p1', kind: 'resume', title: '', text: '', options: [] })).toBe('resume')
  expect(promptKind({ id: 'progression', title: '', text: '', options: [] })).toBe('progression')
  expect(promptKind({ id: 'x', title: '', text: '', options: [] })).toBe('adjustment')
})

test('proposal in plain words, with the program range and the clamp note', () => {
  const p = { exercise: 'arm', field: 'target_deg', value: 75, requested: 75, clamped: false, unit: '°' }
  expect(describeProposal(p, { from: 90, range: [60, 90] })).toBe('Target 90° → 75° (your program allows 60–90°)')
  expect(describeProposal({ ...p, value: 60, requested: 50, clamped: true }, { from: 90, range: [60, 90] })).toBe('Target 90° → 60° (your program allows 60–90°) · adjusted to your program’s limit')
  expect(describeProposal({ exercise: 'arm', field: 'hold_s', value: 2, requested: 2, clamped: false, unit: 's' }, { from: 3, range: [2, 3] })).toBe('Hold 3 s → 2 s (your program allows 2–3 s)')
  expect(describeProposal({ exercise: 'arm', field: 'reps', value: 6, requested: 6, clamped: false, unit: 'reps' }, {})).toBe('Reps per set → 6 reps')
  expect(describeProposal({ exercise: 'cup', field: 'phase', value: 'fast', requested: 'fast', clamped: false, unit: '' }, { from: 'slow' })).toBe('Pace slow → fast')
})

test('health lines: off, Anthropic dev, Bedrock with MCP, not ready with a reason', () => {
  expect(healthLines(undefined)).toEqual({ title: 'Off — rule-based coach', details: [] })
  expect(healthLines({ mode: 'off', model: '', mcp: false, ready: false })).toEqual({ title: 'Off — rule-based coach', details: [] })
  expect(healthLines({ mode: 'anthropic', model: 'claude-sonnet-5', mcp: true, ready: true })).toEqual({ title: 'Claude Sonnet 5 via Anthropic API (dev)', details: ['MCP tools connected'] })
  expect(healthLines({ mode: 'bedrock', model: 'us.anthropic.claude-sonnet-5-v1:0', mcp: false, ready: true }).title).toBe('Claude Sonnet 5 via Amazon Bedrock')
  expect(healthLines({ mode: 'bedrock', model: 'x', mcp: false, ready: true }).details).toEqual(['Tools called directly (MCP not connected)'])
  expect(healthLines({ mode: 'anthropic', model: 'claude-sonnet-5', mcp: false, ready: false, reason: 'ANTHROPIC_API_KEY not set' }).details).toContain('Not ready: ANTHROPIC_API_KEY not set · the rule-based coach runs')
  expect(healthLines({ mode: 'scripted', model: 'scripted', mcp: true, ready: true }).title).toBe('Scripted agent (test) — no model calls')
})

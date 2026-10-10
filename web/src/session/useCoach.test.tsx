import { act, renderHook } from '@testing-library/react'
import type { PraxisEvent } from '../lib/events'
import { useCoach } from './useCoach'

const coach = (id: number, extra: Record<string, unknown> = {}): PraxisEvent => ({ type: 'coach', t: id, id, action: 'instruct', cue_id: 'x', text: `Cue ${id}`, reason: 'r', evidence: [1], ui: {}, label: 'Rule-based coach · LLM agent pending', ...extra })

test('captions follow coach events and prompts are surfaced', () => {
  const { result, rerender } = renderHook(({ events }) => useCoach(events), { initialProps: { events: [coach(1)] } })
  expect(result.current.caption?.text).toBe('Cue 1')
  rerender({ events: [coach(1), coach(2, { action: 'progress', ui: { prompt: { id: 'progression', title: 'T', text: 'why', options: ['Yes, go faster', 'Keep pace', 'Why?'] } } })] })
  expect(result.current.prompt?.id).toBe('progression')
  act(() => result.current.dismissPrompt())
  expect(result.current.prompt).toBeNull()
})

test('stop, pause and resume drive the overlay state', () => {
  const { result, rerender } = renderHook(({ events }) => useCoach(events), { initialProps: { events: [] as PraxisEvent[] } })
  expect(result.current.overlay).toBeNull()
  rerender({ events: [{ type: 'pause', t: 1, id: 1, rule: 'perception', text: 'lost' } as PraxisEvent] })
  expect(result.current.overlay?.kind).toBe('paused')
  rerender({ events: [{ type: 'pause', t: 1, id: 1, rule: 'perception', text: 'lost' } as PraxisEvent, { type: 'resume', t: 2, id: 2 } as PraxisEvent] })
  expect(result.current.overlay).toBeNull()
  rerender({ events: [{ type: 'stop', t: 3, id: 3, rule: 'pain', text: 'ended' } as PraxisEvent] })
  expect(result.current.overlay?.kind).toBe('stopped')
})

test('exertion chip reflects the latest exertion event', () => {
  const { result } = renderHook(() => useCoach([{ type: 'exertion', t: 1, id: 1, level: 'moderate', reasons: ['RPE 5/10'], method: 'behavioural' } as PraxisEvent]))
  expect(result.current.exertion?.level).toBe('moderate')
})

test('a caption expires after 4 s of frames so the state caption returns', () => {
  const frameAt = (t: number, id: number): PraxisEvent => ({ type: 'frame', t, id })
  const { result, rerender } = renderHook(({ events }) => useCoach(events), { initialProps: { events: [coach(1), frameAt(2, 2)] } })
  expect(result.current.caption?.text).toBe('Cue 1')
  rerender({ events: [coach(1), frameAt(2, 2), frameAt(6, 3)] })
  expect(result.current.caption).toBeNull()
})

test('an agent resume command (after the patient said yes) clears the paused overlay like a resume event', () => {
  const pause = { type: 'pause', t: 1, id: 1, rule: 'perception', text: 'lost' } as PraxisEvent
  const { result, rerender } = renderHook(({ events }) => useCoach(events), { initialProps: { events: [pause] } })
  expect(result.current.overlay?.kind).toBe('paused')
  rerender({ events: [pause, { type: 'command', t: 2, id: 2, cmd: 'resume', source: 'agent', ok: true } as PraxisEvent] })
  expect(result.current.overlay).toBeNull()
  // a refused command changes nothing
  rerender({ events: [pause, { type: 'command', t: 2, id: 2, cmd: 'resume', source: 'agent', ok: false } as PraxisEvent] })
  expect(result.current.overlay?.kind).toBe('paused')
})

test('caption carries its source; the latest rule label is kept for the screen-state captions', () => {
  const { result } = renderHook(() =>
    useCoach([coach(1, { source: 'rule', label: 'Rule-based coach' }), coach(2, { source: 'agent', label: 'Claude agent · Amazon Bedrock' })]),
  )
  expect(result.current.caption?.label).toBe('Claude agent · Amazon Bedrock')
  expect(result.current.captionSource).toBe('agent')
  expect(result.current.ruleLabel).toBe('Rule-based coach')
})

test('legacy coach events (no source) read as the rule coach with their own label', () => {
  const { result } = renderHook(() => useCoach([coach(1)]))
  expect(result.current.captionSource).toBe('rule')
  expect(result.current.ruleLabel).toBe('Rule-based coach · LLM agent pending')
})

test('agent_status events surface as the agent state', () => {
  const { result } = renderHook(() => useCoach([{ type: 'agent_status', t: 1, id: 1, state: 'thinking', trigger: 'set_complete', label: 'Claude agent · Anthropic API (dev)' } as PraxisEvent]))
  expect(result.current.agent?.state).toBe('thinking')
})

import { act, renderHook } from '@testing-library/react'
import type { PraxisEvent } from '../lib/events'
import { useCoach } from './useCoach'

const coach = (id: number, extra: Record<string, unknown> = {}): PraxisEvent => ({ type: 'coach', t: id, id, action: 'instruct', cue_id: 'x', text: `Cue ${id}`, reason: 'r', evidence: [1], ui: {}, label: 'Rule-based coach · LLM agent pending', ...extra })

test('captions follow coach events and prompts are surfaced', () => {
  const speak = vi.fn()
  const { result, rerender } = renderHook(({ events }) => useCoach(events, { speak }), { initialProps: { events: [coach(1)] } })
  expect(result.current.caption?.text).toBe('Cue 1')
  expect(speak).toHaveBeenCalledWith('Cue 1')
  rerender({ events: [coach(1), coach(2, { action: 'progress', ui: { prompt: { id: 'progression', title: 'T', text: 'why', options: ['Yes, go faster', 'Keep pace', 'Why?'] } } })] })
  expect(result.current.prompt?.id).toBe('progression')
  act(() => result.current.dismissPrompt())
  expect(result.current.prompt).toBeNull()
})

test('stop, pause and resume drive the overlay state', () => {
  const { result, rerender } = renderHook(({ events }) => useCoach(events, { speak: vi.fn() }), { initialProps: { events: [] as PraxisEvent[] } })
  expect(result.current.overlay).toBeNull()
  rerender({ events: [{ type: 'pause', t: 1, id: 1, rule: 'perception', text: 'lost' } as PraxisEvent] })
  expect(result.current.overlay?.kind).toBe('paused')
  rerender({ events: [{ type: 'pause', t: 1, id: 1, rule: 'perception', text: 'lost' } as PraxisEvent, { type: 'resume', t: 2, id: 2 } as PraxisEvent] })
  expect(result.current.overlay).toBeNull()
  rerender({ events: [{ type: 'stop', t: 3, id: 3, rule: 'pain', text: 'ended' } as PraxisEvent] })
  expect(result.current.overlay?.kind).toBe('stopped')
})

test('exertion chip reflects the latest exertion event', () => {
  const { result } = renderHook(() => useCoach([{ type: 'exertion', t: 1, id: 1, level: 'moderate', reasons: ['RPE 5/10'], method: 'behavioural' } as PraxisEvent], { speak: vi.fn() }))
  expect(result.current.exertion?.level).toBe('moderate')
})

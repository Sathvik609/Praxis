import { act, renderHook } from '@testing-library/react'
import type { PraxisEvent } from '../lib/events'
import { browserSpeak, resetSpeech, useCoach } from './useCoach'

const coach = (id: number, extra: Record<string, unknown> = {}): PraxisEvent => ({ type: 'coach', t: id, id, action: 'instruct', cue_id: 'x', text: `Cue ${id}`, reason: 'r', evidence: [1], ui: {}, label: 'Rule-based coach · LLM agent pending', ...extra })

test('captions follow coach events and prompts are surfaced', () => {
  const speak = vi.fn()
  const { result, rerender } = renderHook(({ events }) => useCoach(events, { speak }), { initialProps: { events: [coach(1)] } })
  expect(result.current.caption?.text).toBe('Cue 1')
  expect(speak).toHaveBeenCalledWith('Cue 1', 'instruct')
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

test('a caption expires after 4 s of frames so the state caption returns', () => {
  const frameAt = (t: number, id: number): PraxisEvent => ({ type: 'frame', t, id })
  const { result, rerender } = renderHook(({ events }) => useCoach(events, { speak: vi.fn() }), { initialProps: { events: [coach(1), frameAt(2, 2)] } })
  expect(result.current.caption?.text).toBe('Cue 1')
  rerender({ events: [coach(1), frameAt(2, 2), frameAt(6, 3)] })
  expect(result.current.caption).toBeNull()
})

test('speech queues instead of cancelling; corrections drop queued instructions', () => {
  const speak = vi.fn()
  const utterances: { text: string; onend?: () => void }[] = []
  class FakeUtterance {
    text: string
    rate = 1
    onend?: () => void
    onerror?: () => void
    constructor(text: string) {
      this.text = text
      utterances.push(this)
    }
  }
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() })
  resetSpeech()
  browserSpeak('Dot 2. Good.')
  browserSpeak('Onto 3.')
  browserSpeak('Sit tall.', 'correct')
  expect(speak).toHaveBeenCalledTimes(1) // first cue is speaking; the rest wait
  utterances[0].onend?.()
  expect(speak).toHaveBeenCalledTimes(2)
  expect(utterances[1].text).toBe('Sit tall.') // the queued instruction was dropped by the correction
  vi.unstubAllGlobals()
})

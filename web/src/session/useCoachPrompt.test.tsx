import { act, renderHook } from '@testing-library/react'
import type { PraxisEvent } from '../lib/events'
import { useCoach } from './useCoach'
import { useCoachPrompt } from './useCoachPrompt'

const coach = (id: number, extra: Record<string, unknown> = {}): PraxisEvent => ({ type: 'coach', t: id, id, action: 'instruct', cue_id: 'x', text: `Cue ${id}`, reason: 'r', evidence: [1], ui: {}, label: 'Claude agent · Anthropic API', source: 'agent', ...extra })
const adjust = (id: number) =>
  coach(id, {
    action: 'regress',
    ui: { prompt: { id: 'p7', kind: 'adjustment', title: 'Lower target', text: 'Peaks are falling.', options: ['Yes, lower it', 'Keep 90°', 'Why?'], within_prescription: true, proposal: { exercise: 'arm', field: 'target_deg', value: 75, requested: 75, clamped: false, unit: '°' } } },
  })

function useBoth(events: PraxisEvent[], send: (m: Record<string, unknown>) => void) {
  const c = useCoach(events)
  return useCoachPrompt(events, c.prompt, c.dismissPrompt, send)
}

test('accept sends option 0 as the answer and closes the prompt', () => {
  const send = vi.fn()
  const { result } = renderHook(({ events }) => useBoth(events, send), { initialProps: { events: [adjust(5)] } })
  expect(result.current.prompt?.id).toBe('p7')
  act(() => result.current.choose('Yes, lower it', 0))
  expect(send).toHaveBeenCalledWith({ cmd: 'answer', prompt: 'p7', choice: 'Yes, lower it' })
  expect(result.current.prompt).toBeNull()
})

test('decline sends option 1 as the answer and closes the prompt', () => {
  const send = vi.fn()
  const { result } = renderHook(({ events }) => useBoth(events, send), { initialProps: { events: [adjust(5)] } })
  act(() => result.current.choose('Keep 90°', 1))
  expect(send).toHaveBeenCalledWith({ cmd: 'answer', prompt: 'p7', choice: 'Keep 90°' })
  expect(result.current.prompt).toBeNull()
})

test('"Why?" is sent once, keeps the prompt open and shows the next coach instruct as the reason', () => {
  const send = vi.fn()
  const { result, rerender } = renderHook(({ events }) => useBoth(events, send), { initialProps: { events: [coach(3), adjust(5)] } })
  act(() => result.current.choose('Why?', 2))
  expect(send).toHaveBeenCalledWith({ cmd: 'answer', prompt: 'p7', choice: 'Why?' })
  expect(result.current.prompt?.id).toBe('p7')
  expect(result.current.whyOpen).toBe(true)
  expect(result.current.whyText).toBeNull() // asked, not answered yet
  const reply = coach(6, { cue_id: 'why', text: 'Your last three lifts peaked at 84°, 80° and 77°, so a lower target keeps the hold clean.' })
  rerender({ events: [coach(3), adjust(5), { type: 'frame', t: 6, id: 7 } as PraxisEvent, reply] })
  expect(result.current.whyText).toMatch(/peaked at 84°/)
  expect(result.current.prompt?.id).toBe('p7')
  // toggling closes and reopens without asking again
  act(() => result.current.choose('Why?', 2))
  expect(result.current.whyOpen).toBe(false)
  act(() => result.current.choose('Why?', 2))
  expect(result.current.whyOpen).toBe(true)
  expect(send).toHaveBeenCalledTimes(1)
  // then the answer still goes out with the prompt id
  act(() => result.current.choose('Yes, lower it', 0))
  expect(send).toHaveBeenLastCalledWith({ cmd: 'answer', prompt: 'p7', choice: 'Yes, lower it' })
})

test('a resume prompt closes once the session resumes, however it was resumed', () => {
  const send = vi.fn()
  const resumePrompt = coach(5, { ui: { prompt: { id: 'p9', kind: 'resume', title: 'Setup looks good — resume?', text: '', options: ['Yes, resume', 'Not yet'], within_prescription: true } } })
  const pause = { type: 'pause', t: 4, id: 4, rule: 'perception', text: 'Tracking lost' } as PraxisEvent
  const { result, rerender } = renderHook(({ events }) => useBoth(events, send), { initialProps: { events: [pause, resumePrompt] } })
  expect(result.current.prompt?.kind).toBe('resume')
  rerender({ events: [pause, resumePrompt, { type: 'resume', t: 6, id: 6 } as PraxisEvent] })
  expect(result.current.prompt).toBeNull()
})

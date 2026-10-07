import { renderHook } from '@testing-library/react'
import type { PraxisEvent } from '../lib/events'
import { HISTORY_MAX, useEventHistory } from './eventHistory'

const ev = (type: string, id: number, extra: Record<string, unknown> = {}): PraxisEvent => ({ type, t: id / 10, id, ...extra }) as PraxisEvent

/** The socket hook's window: the last 200 events. */
const windowOf = (all: PraxisEvent[]) => all.slice(-200)

test('one-off events that scroll out of the 200-event window stay in the history; frames do not', () => {
  const all: PraxisEvent[] = [ev('session_start', 1), ev('reach_complete', 2), ev('cup_complete', 3, { arcs: 4 })]
  const { result, rerender } = renderHook(({ events }) => useEventHistory(events), { initialProps: { events: windowOf(all) } })
  expect(result.current.map((e) => e.type)).toEqual(['session_start', 'reach_complete', 'cup_complete'])

  // 250 frames arrive one render at a time, as the socket delivers them
  for (let i = 0; i < 250; i++) {
    all.push(ev('frame', 10 + i))
    rerender({ events: windowOf(all) })
  }
  const h = result.current
  expect(h.find((e) => e.type === 'cup_complete')).toMatchObject({ arcs: 4 })
  expect(h.filter((e) => e.type === 'reach_complete')).toHaveLength(1)
  expect(h[0].type).toBe('session_start')
  // the frames are the window's own (the newest 200), never piled up
  expect(h.filter((e) => e.type === 'frame')).toHaveLength(200)
  expect(h[h.length - 1]).toBe(all[all.length - 1])
})

test('a window that jumps several events at once keeps every one-off that left it', () => {
  const all: PraxisEvent[] = [ev('wrong_dot', 1), ev('perception_lost', 2)]
  const { result, rerender } = renderHook(({ events }) => useEventHistory(events), { initialProps: { events: windowOf(all) } })
  for (let i = 0; i < 205; i++) all.push(ev('frame', 10 + i))
  rerender({ events: windowOf(all) })
  expect(result.current.filter((e) => e.type !== 'frame').map((e) => e.type)).toEqual(['wrong_dot', 'perception_lost'])
})

test('an emptied window (a new start) clears the history', () => {
  const all: PraxisEvent[] = [ev('cup_complete', 1)]
  const { result, rerender } = renderHook(({ events }) => useEventHistory(events), { initialProps: { events: all } })
  for (let i = 0; i < 210; i++) all.push(ev('frame', 10 + i))
  rerender({ events: windowOf(all) })
  expect(result.current.some((e) => e.type === 'cup_complete')).toBe(true)
  rerender({ events: [] })
  expect(result.current).toEqual([])
  rerender({ events: [ev('session_start', 500)] })
  expect(result.current.map((e) => e.type)).toEqual(['session_start'])
})

test('the history is bounded', () => {
  const all: PraxisEvent[] = []
  const { result, rerender } = renderHook(({ events }) => useEventHistory(events), { initialProps: { events: [] as PraxisEvent[] } })
  for (let i = 1; i <= HISTORY_MAX + 400; i++) {
    all.push(ev('state_change', i))
    if (i % 50 === 0) rerender({ events: windowOf(all) })
  }
  expect(result.current.length).toBeLessThanOrEqual(HISTORY_MAX + 200)
})

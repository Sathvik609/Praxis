import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { readDay } from '../lib/day'
import { ACK_WAIT_MS, useSessionFlow } from './useSessionFlow'

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>

afterEach(() => localStorage.clear())

test('an early end carries its reason into the feedback and keeps the pain for today', () => {
  const send = vi.fn()
  const { result } = renderHook(() => useSessionFlow([], send, vi.fn(), true), { wrapper })
  expect(result.current.early).toBe(false)
  act(() => result.current.finish(true, 'tired'))
  expect(result.current.feedbackOpen).toBe(true)
  expect(result.current.early).toBe(true)
  act(() => result.current.save({ pain_after: 3 }))
  expect(send).toHaveBeenLastCalledWith({ cmd: 'feedback', pain_after: 3, end_reason: 'tired', ended_early: true })
  expect(readDay().lastPainAfter).toBe(3)
  expect(result.current.feedbackOpen).toBe(false)
})

test('a completed session sends no reason, and a skipped form still says how it ended', () => {
  const send = vi.fn()
  const { result } = renderHook(() => useSessionFlow([], send, vi.fn(), true), { wrapper })
  act(() => result.current.finish(false))
  expect(result.current.early).toBe(false)
  act(() => result.current.skip())
  expect(send).toHaveBeenLastCalledWith({ cmd: 'feedback', end_reason: null, ended_early: false })
})

test('feedback without a pain answer keeps the pain already recorded today', () => {
  localStorage.setItem('praxis.day', JSON.stringify({ ...readDay(), lastPainAfter: 5 }))
  const { result } = renderHook(() => useSessionFlow([], vi.fn(), vi.fn(), true), { wrapper })
  act(() => result.current.finish(true, 'blocked'))
  act(() => result.current.save({ effort: 4 }))
  expect(readDay().lastPainAfter).toBe(5)
})

test('offline: the fallback state carries how it ended to the report', () => {
  const stop = vi.fn()
  const { result } = renderHook(() => ({ flow: useSessionFlow([], vi.fn(), stop, false), loc: useLocation() }), { wrapper })
  act(() => result.current.flow.finish(true, 'finished', { kind: 'nhpt' }))
  expect(stop).toHaveBeenCalled()
  expect(result.current.flow.feedbackOpen).toBe(false)
  expect(result.current.loc.pathname).toBe('/report')
  expect(result.current.loc.state).toEqual({ kind: 'nhpt', ended_early: true, end_reason: 'finished' })
})

test('"Next exercise" still asks for feedback, then binds the report to today and opens the next demonstration', () => {
  localStorage.setItem('praxis.day', JSON.stringify({ ...readDay(), checkin: { pain: 2, location: '', energy: 'ok', minutes: 20, new_symptoms: false, tier: 'full', at: new Date().toISOString() }, current: 'cup' }))
  const send = vi.fn()
  const ack = { type: 'command', t: 9, id: 9, cmd: 'feedback', ok: true, summary: { session_id: 's7' } }
  let events: Record<string, unknown>[] = []
  const { result, rerender } = renderHook(() => ({ flow: useSessionFlow(events as never, send, vi.fn(), true), loc: useLocation() }), { wrapper })
  act(() => result.current.flow.finish(false, undefined, { kind: 'cup' }, { url: '/details/demo?exercise=abduction&side=left', mode: 'cup' }))
  expect(result.current.flow.feedbackOpen).toBe(true)
  act(() => result.current.flow.save({ pain_after: 2 }))
  events = [ack]
  rerender()
  expect(result.current.loc.pathname + result.current.loc.search).toBe('/details/demo?exercise=abduction&side=left')
  expect(readDay().done).toContain('cup')
  expect(readDay().finished).toEqual([{ exercise: 'cup', reportId: 's7' }])
})

const replayEnd = { type: 'replay_end', t: 30, id: 99, clip: 'synthetic_cup_01', frames: 300 }

test('a replay that ends before the session finished is flagged; finishing it records the recording ending, not an early end', () => {
  const send = vi.fn()
  let events: Record<string, unknown>[] = []
  const { result, rerender } = renderHook(() => useSessionFlow(events as never, send, vi.fn(), true), { wrapper })
  expect(result.current.replayOver).toBe(false)
  events = [replayEnd]
  rerender()
  expect(result.current.replayOver).toBe(true)
  expect(result.current.recordingEnded).toBe(false)
  act(() => result.current.finish(false, 'replay_end'))
  expect(result.current.replayOver).toBe(false)
  expect(result.current.feedbackOpen).toBe(true)
  expect(result.current.early).toBe(false)
  expect(result.current.recordingEnded).toBe(true)
  act(() => result.current.skip())
  expect(send).toHaveBeenLastCalledWith({ cmd: 'feedback', end_reason: 'replay_end', ended_early: false })
})

test('a session that already finished is not flagged when the recording ends, and never finishes twice', () => {
  const send = vi.fn()
  let events: Record<string, unknown>[] = []
  const { result, rerender } = renderHook(() => useSessionFlow(events as never, send, vi.fn(), true), { wrapper })
  act(() => result.current.finish(true, 'tired'))
  act(() => result.current.save({ pain_after: 2 }))
  events = [replayEnd]
  rerender()
  expect(result.current.replayOver).toBe(false)
  act(() => result.current.finish(false, 'replay_end'))
  expect(result.current.feedbackOpen).toBe(false)
  expect(result.current.recordingEnded).toBe(false)
  expect(send.mock.calls.filter(([c]) => c.cmd === 'feedback')).toEqual([[{ cmd: 'feedback', pain_after: 2, ended_early: true, end_reason: 'tired' }]])
})

// 13 Oct team test: the socket dropped while the feedback form was open, Save / Skip went
// nowhere and every later End session click was a no-op ("End session does not end").
test('the socket dropped while the feedback form was open: Save still leaves for the report', () => {
  const stop = vi.fn()
  const send = vi.fn()
  let connected = true
  const { result, rerender } = renderHook(() => ({ flow: useSessionFlow([], send, stop, connected), loc: useLocation() }), { wrapper })
  act(() => result.current.flow.finish(true, 'tired', { kind: 'arm' }))
  expect(result.current.flow.feedbackOpen).toBe(true)
  connected = false
  rerender()
  expect(result.current.flow.feedbackOpen).toBe(true) // the answers are not thrown away
  act(() => result.current.flow.save({ pain_after: 2 }))
  expect(stop).toHaveBeenCalled()
  expect(result.current.loc.pathname).toBe('/report')
  expect(result.current.loc.state).toEqual({ kind: 'arm', ended_early: true, end_reason: 'tired' })
})

test('the socket drops after the feedback was sent: the screen leaves for the report', () => {
  const stop = vi.fn()
  let connected = true
  const { result, rerender } = renderHook(() => ({ flow: useSessionFlow([], vi.fn(), stop, connected), loc: useLocation() }), { wrapper })
  act(() => result.current.flow.finish(true, 'finished', { kind: 'arm' }))
  act(() => result.current.flow.skip())
  expect(result.current.loc.pathname).toBe('/')
  connected = false
  rerender()
  expect(stop).toHaveBeenCalled()
  expect(result.current.loc.pathname).toBe('/report')
})

test('no answer from the service after the feedback: the screen still leaves for the report', () => {
  vi.useFakeTimers()
  try {
    const stop = vi.fn()
    const { result } = renderHook(() => ({ flow: useSessionFlow([], vi.fn(), stop, true), loc: useLocation() }), { wrapper })
    act(() => result.current.flow.finish(true, 'finished', { kind: 'cup' }))
    act(() => result.current.flow.skip())
    expect(result.current.loc.pathname).toBe('/')
    act(() => vi.advanceTimersByTime(ACK_WAIT_MS))
    expect(stop).toHaveBeenCalled()
    expect(result.current.loc.pathname).toBe('/report')
    expect(result.current.loc.state).toEqual({ kind: 'cup', ended_early: true, end_reason: 'finished' })
  } finally {
    vi.useRealTimers()
  }
})

test('the stored report wins over the timeout, and the screen navigates once', () => {
  vi.useFakeTimers()
  try {
    const ack = { type: 'command', t: 9, id: 9, cmd: 'feedback', ok: true, summary: { session_id: 's9' } }
    let events: Record<string, unknown>[] = []
    const { result, rerender } = renderHook(() => ({ flow: useSessionFlow(events as never, vi.fn(), vi.fn(), true), loc: useLocation() }), { wrapper })
    act(() => result.current.flow.finish(true, 'finished'))
    act(() => result.current.flow.skip())
    events = [ack]
    rerender()
    expect(result.current.loc.pathname).toBe('/report/s9')
    act(() => vi.advanceTimersByTime(ACK_WAIT_MS * 2))
    expect(result.current.loc.pathname).toBe('/report/s9')
  } finally {
    vi.useRealTimers()
  }
})

test('End session stops the camera at once and the session reads as ended until the report opens', () => {
  const endCapture = vi.fn()
  const { result } = renderHook(() => useSessionFlow([], vi.fn(), vi.fn(), true, endCapture), { wrapper })
  expect(result.current.ended).toBe(false)
  act(() => result.current.finish(true, 'tired'))
  expect(endCapture).toHaveBeenCalledTimes(1)
  expect(result.current.ended).toBe(true)
  act(() => result.current.skip())
  expect(result.current.ended).toBe(true)
})


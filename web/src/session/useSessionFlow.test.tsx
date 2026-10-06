import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { readDay } from '../lib/day'
import { useSessionFlow } from './useSessionFlow'

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

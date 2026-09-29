import { renderHook, waitFor } from '@testing-library/react'
import { api } from '../lib/api'
import type { PraxisEvent } from '../lib/events'
import { useAgentTrace } from './agentTrace'

const ev = (id: number, extra: Record<string, unknown> = {}) => ({ type: 'coach', id, t: id, ...extra }) as unknown as PraxisEvent

test('keeps polling the session after the event that named it scrolls out of the window', async () => {
  const trace = vi.spyOn(api, 'trace').mockResolvedValue({ session: 'abc123', rows: [{ kind: 'agent_run', phase: 'start' }] })
  try {
    const { rerender } = renderHook(({ events }) => useAgentTrace(events), { initialProps: { events: [ev(1, { type: 'replay_start', session_id: 'abc123' }), ev(2)] } })
    await waitFor(() => expect(trace).toHaveBeenCalledWith('abc123'))
    trace.mockClear()
    // later: the socket window no longer holds any event with a session id
    rerender({ events: [ev(40), ev(41)] })
    await waitFor(() => expect(trace).toHaveBeenCalledWith('abc123'), { timeout: 3000 })
  } finally {
    trace.mockRestore()
  }
})

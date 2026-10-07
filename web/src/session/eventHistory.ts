import { useMemo, useState } from 'react'
import type { PraxisEvent } from '../lib/events'
import { ACK_TYPES } from './latency'

/** Per-frame types (one per frame or per calibration pass): they live only in the socket's own
 *  window, the history never keeps them. */
const PER_FRAME: ReadonlySet<string> = new Set([...ACK_TYPES, 'quality'])
/** Upper bound on the one-off events kept from before the window (a long session has a few
 *  hundred; this is a memory guard, not a working limit). */
export const HISTORY_MAX = 5000

type St = { prev: PraxisEvent[]; dropped: PraxisEvent[] }
const EMPTY: St = { prev: [], dropped: [] }

const sameWindow = (a: PraxisEvent[], b: PraxisEvent[]) => a === b || (a.length === b.length && a.every((e, i) => e === b[i]))

/** The next state for a new window: whatever of the previous window precedes the new window's
 *  first event has left it (the window only ever slides forward); its one-off events are kept. */
function advance(s: St, events: PraxisEvent[]): St {
  if (events.length === 0) return EMPTY
  const i = s.prev.indexOf(events[0])
  const gone = i === -1 ? s.prev : s.prev.slice(0, i)
  const keep = gone.filter((e) => !PER_FRAME.has(e.type) && !events.includes(e))
  return { prev: events, dropped: keep.length ? [...s.dropped, ...keep].slice(-HISTORY_MAX) : s.dropped }
}

/** The session's events since the latest start: every one-off event (reach, completion, stop,
 *  pause, coach decision…) that has scrolled out of `useWebcamStream`'s 200-event window,
 *  followed by the window itself. Frames fill the window in ~16 s, so anything a screen latches
 *  on (a completion, the first lift, a set check-in, a stop) must be read from here, not from
 *  the window. An empty window (a new `start()`) clears it. */
export function useEventHistory(events: PraxisEvent[]): PraxisEvent[] {
  const [st, setSt] = useState<St>(EMPTY)
  let s = st
  if (!sameWindow(events, st.prev)) {
    // derived state, adjusted during render (React re-renders before committing)
    s = advance(st, events)
    setSt(s)
  }
  const dropped = s.dropped
  return useMemo(() => (dropped.length ? [...dropped, ...events] : events), [dropped, events])
}

import type { PraxisEvent } from '../../lib/events'
import type { FrameEvent } from '../../session/OverlayCanvas'

/** Pure views of the Waiter – cup session for the designers' 6 Oct cup look, derived only from
 *  the service's cup events (the session history from `useEventHistory`, never the socket's
 *  200-event window, which frames fill in ~16 s) and frame snapshot (`perception/cup.py`): one arc runs dot
 *  1→5→1 (`ARC = [0,1,2,3,4,3,2,1,0]`, 8 reaches), 2 slow then 2 fast arcs. The artifact's
 *  start mark, sets and between-set rest do not exist in the FSM and are not drawn. */

export type CupDotState = 'done' | 'amber' | 'next' | 'todo'
export type CupDot = { k: number; state: CupDotState }
export type CupBand = { text: string; tone: 'mint' | 'amber' | 'neutral' }

type Ev = PraxisEvent
const REACHES_ACROSS = 4

/** Events since the newest `arc_complete` (the current arc). */
function sinceArc(events: Ev[]): Ev[] {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].type === 'arc_complete') return events.slice(i + 1)
  return events
}

/** The five dots of the current arc: a verified placement is done, an unverified one or a
 *  placement on the wrong dot is amber, the dot the cup started the arc on is done, the next
 *  dot comes from the frame (`expected_next`). */
export function cupDots(events: Ev[], frame: FrameEvent | null): CupDot[] {
  const cup = frame?.cup
  const marks = new Map<number, CupDotState>()
  for (const k of cup?.dots_in_arc ?? []) marks.set(k, 'done')
  const wrongAt = new Map<number, number>()
  for (const e of sinceArc(events)) {
    if (e.type === 'wrong_dot') {
      marks.set(Number(e.dot), 'amber')
      wrongAt.set(Number(e.dot), e.t)
    } else if (e.type === 'reach_complete') {
      const k = Number(e.to_dot)
      if (wrongAt.get(k) === e.t) continue
      marks.set(k, e.verified ? 'done' : 'amber')
    }
  }
  const next = cup?.expected_next ?? null
  return [0, 1, 2, 3, 4].map((k) => ({ k, state: k === next ? 'next' : (marks.get(k) ?? 'todo') }))
}

const lostNow = (events: Ev[]) => {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'perception_lost') return true
    if (e.type === 'perception_regained') return false
  }
  return false
}

/** The measurement band over the camera: the newest placement (seated and verified, not
 *  visible, wrong dot), the arc or the exercise finished, the cup moving, or tracking paused. */
export function cupBand(events: Ev[], frame: FrameEvent | null): CupBand | null {
  if (lostNow(events)) return { text: 'Tracking paused · counters held', tone: 'neutral' }
  const cup = frame?.cup
  let last: Ev | undefined
  let wrong: Ev | undefined
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (!last && ['reach_complete', 'arc_complete', 'cup_complete', 'wrong_dot'].includes(e.type)) last = e
    if (last && e.type === 'wrong_dot' && e.t === last.t) wrong = e
    if (last && e.t < last.t) break
  }
  if (cup && last && frame && frame.t > last.t && (cup.state === 'lifted' || cup.state === 'in_transit')) return { text: 'Cup moving', tone: 'mint' }
  if (wrong) return { text: `Cup on dot ${Number(wrong.dot) + 1} · expected dot ${Number(wrong.expected) + 1}`, tone: 'amber' }
  if (last?.type === 'cup_complete') return { text: `All ${Number(last.arcs)} arcs complete`, tone: 'mint' }
  if (last?.type === 'arc_complete') {
    const n = Number(last.reaches ?? 0)
    return { text: `Arc ${Number(last.arc)} complete · ${n - Number(last.unverified ?? 0)} of ${n} verified`, tone: 'mint' }
  }
  if (last?.type === 'reach_complete') {
    if (last.verified) return { text: `Dot ${Number(last.to_dot) + 1} seated · hand clear · verified`, tone: 'mint' }
    return { text: last.reason === 'marker_lost' ? 'Placement not visible · a corner marker was hidden' : 'Placement not visible · hand over the cup', tone: 'neutral' }
  }
  if (cup && cup.dot != null && frame?.calibrated) return { text: 'Cup found · sheet locked', tone: 'mint' }
  return null
}

/** Which arc of which pace, and whether the cup is going across (dot 1 → 5) or back. */
export function cupArc(events: Ev[], frame: FrameEvent | null): { arc: number; of: number; phase: 'slow' | 'fast'; dir: 'across' | 'back' } {
  const cup = frame?.cup
  const planned = cup?.arcs_planned ?? { slow: 2, fast: 2 }
  const phase = cup?.phase ?? 'slow'
  const idx = cup?.arc_index ?? 1
  const arc = phase === 'slow' ? Math.min(idx, planned.slow) : Math.max(1, Math.min(idx, planned.slow + planned.fast) - planned.slow)
  const reaches = sinceArc(events).filter((e) => e.type === 'reach_complete').length
  return { arc, of: phase === 'slow' ? planned.slow : planned.fast, phase, dir: reaches < REACHES_ACROSS ? 'across' : 'back' }
}

/** Seconds from the first lift of the session to now, or to the completion once the cup is
 *  done (the cup's active clock), or null before it. `events` is the session history
 *  (`useEventHistory`), not the socket window. Pauses are not taken out here; the session
 *  summary's `active_s` does that at the end. */
export function cupActiveS(events: Ev[], frame: FrameEvent | null): number | null {
  const first = events.find((e) => e.type === 'reach_complete')
  if (!first || !frame) return null
  const done = events.find((e) => e.type === 'cup_complete')
  return Math.max(0, Math.floor((done?.t ?? frame.t) - Number(first.t_lift ?? first.t)))
}

/** What the progression prompt is based on: slow-arc reaches verified by the camera, and how
 *  much faster the second slow arc's mean reach was than the first (`arc_means_ms`). */
export function cupProgressFacts(events: Ev[], frame: FrameEvent | null): { verified: number; total: number; fasterPct: number | null } {
  const slow = events.filter((e) => e.type === 'reach_complete' && (e.phase ?? 'slow') === 'slow')
  const means = (frame?.cup as { arc_means_ms?: (number | null)[] } | undefined)?.arc_means_ms ?? []
  const [a, b] = means
  const fasterPct = a && b ? Math.round(((a - b) / a) * 100) : null
  return { verified: slow.filter((e) => e.verified).length, total: slow.length, fasterPct }
}

/** Arc 2's pace against arc 1 for the progression evidence line. A change under 5 % either way
 *  is reach-time noise and reads "same pace as arc 1" (never "0% faster"); null when unknown. */
export function paceVsArc1(fasterPct: number | null): string | null {
  if (fasterPct == null) return null
  if (Math.abs(fasterPct) < 5) return 'same pace as arc 1'
  return `reach time ${Math.abs(fasterPct)}% ${fasterPct > 0 ? 'faster' : 'slower'} than arc 1`
}

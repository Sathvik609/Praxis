import { useMemo, useRef } from 'react'
import type { PraxisEvent } from '../lib/events'

/** Frame-stream latency.
 *
 *  Wire format, browser → service: every binary WebSocket message is an 8-byte little-endian
 *  IEEE-754 float64 `t_capture` (milliseconds since the Unix epoch, `performance.timeOrigin +
 *  performance.now()` at the moment the frame was drawn) followed by the 640×480 JPEG. The
 *  service echoes it as `t_capture` and answers with `latency = {capture_to_event_ms, proc_ms}`
 *  on every frame event and `latency = {event_to_cue_ms, capture_to_cue_ms}` on every coach
 *  cue that followed perception events. `latency.split_capture_prefix` on the service also
 *  accepts a bare JPEG (no prefix). */

export const PREFIX_BYTES = 8

/** The browser sends the next frame only after one of these answered the previous one
 *  (nhpt/cup/arm emit `frame`; calibrate emits `setup_checks` last; heartbeat echoes;
 *  a bad frame answers with `error`). */
export const ACK_TYPES: ReadonlySet<string> = new Set(['frame', 'setup_checks', 'heartbeat', 'error'])

/** Frames sent but not yet answered. One at a time capped a far service at one frame per
 *  round trip (13 Oct team test: ~230 ms to a far region, ~4 fps), so up to this many are
 *  pipelined; the service still drops the oldest queued frame when it falls behind, so the
 *  newest frame is always the one processed. */
export const MAX_IN_FLIGHT = 3

/** Safety valve: a frame unanswered this long frees its slot (an ack lost or never sent). */
export const ACK_TIMEOUT_MS = 1000

export function nowEpochMs(): number {
  return performance.timeOrigin + performance.now()
}

export function withCaptureTime(jpeg: ArrayBuffer, tCaptureMs: number): ArrayBuffer {
  const out = new Uint8Array(PREFIX_BYTES + jpeg.byteLength)
  new DataView(out.buffer).setFloat64(0, tCaptureMs, true)
  out.set(new Uint8Array(jpeg), PREFIX_BYTES)
  return out.buffer
}

export function readCaptureTime(buf: ArrayBuffer): number {
  return new DataView(buf).getFloat64(0, true)
}

/** Nearest-rank percentile (p in 0..100); null on empty input. Mirrors `latency.percentile`. */
export function percentile(xs: readonly number[], p: number): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const k = Math.max(1, Math.min(s.length, Math.ceil((p / 100) * s.length)))
  return s[k - 1]
}

export type P = { p50: number; p95: number }
export type LatencySummary = { captureToEvent: P | null; proc: P | null; eventToCue: P | null; frames: number; dropped: number }

export const WINDOW = 60

class Ring {
  xs: number[] = []
  push(v: number) {
    this.xs.push(v)
    if (this.xs.length > WINDOW) this.xs.shift()
  }
  stats(): P | null {
    const p50 = percentile(this.xs, 50)
    const p95 = percentile(this.xs, 95)
    return p50 == null || p95 == null ? null : { p50, p95 }
  }
}

type Acc = { seen: number; capture: Ring; proc: Ring; cue: Ring; frames: number; dropped: number }

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Rolling p50/p95 over the last 60 frames and the last 60 coach cues from the event stream.
 *  Events are counted once by id, so the window survives the hook's 200-event cap. */
export function useLatency(events: PraxisEvent[]): LatencySummary {
  const acc = useRef<Acc>({ seen: 0, capture: new Ring(), proc: new Ring(), cue: new Ring(), frames: 0, dropped: 0 })
  const last = events.length ? events[events.length - 1].id : 0
  return useMemo(() => {
    const a = acc.current
    for (const e of events) {
      if (e.id <= a.seen) continue
      a.seen = e.id
      const lat = (e.latency ?? null) as Record<string, unknown> | null
      if (e.type === 'frame' || e.type === 'heartbeat') {
        a.frames += 1
        a.dropped += num(e.dropped) ?? 0
        const c = num(lat?.capture_to_event_ms)
        if (c != null) a.capture.push(c)
        const p = num(lat?.proc_ms)
        if (p != null) a.proc.push(p)
      } else if (e.type === 'coach') {
        const c = num(lat?.event_to_cue_ms)
        if (c != null) a.cue.push(c)
      }
    }
    return { captureToEvent: a.capture.stats(), proc: a.proc.stats(), eventToCue: a.cue.stats(), frames: a.frames, dropped: a.dropped }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last, events.length])
}

const ms = (p: P | null) => (p ? `${Math.round(p.p50)}/${Math.round(p.p95)} ms` : '—')

/** The live feed's bottom-band line. Capture→event needs the browser's capture time; replay
 *  frames have none, so the line shows the service's processing time instead. */
export function latencyLine(s: LatencySummary): string {
  const first = s.captureToEvent ? `capture→event ${ms(s.captureToEvent)}` : s.proc ? `processing ${ms(s.proc)}` : 'capture→event —'
  const dropped = s.dropped > 0 ? ` · ${s.dropped} dropped` : ''
  return `latency p50/p95 · ${first} · event→cue ${ms(s.eventToCue)}${dropped}`
}

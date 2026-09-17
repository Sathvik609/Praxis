import { act, renderHook } from '@testing-library/react'
import type { PraxisEvent } from '../lib/events'
import { ACK_TYPES, latencyLine, percentile, readCaptureTime, useLatency, withCaptureTime } from './latency'

test('withCaptureTime prefixes the JPEG with an 8-byte little-endian float64', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).buffer
  const out = withCaptureTime(jpeg, 1758000000123.5)
  expect(out.byteLength).toBe(8 + 7)
  expect(readCaptureTime(out)).toBe(1758000000123.5)
  expect(new Uint8Array(out).slice(8)).toEqual(new Uint8Array(jpeg))
  // little-endian: the exponent byte sits last
  expect(new Uint8Array(out)[7]).toBe(0x42)
})

test('percentile is nearest-rank and null on empty', () => {
  expect(percentile([], 50)).toBeNull()
  expect(percentile([7], 95)).toBe(7)
  const xs = Array.from({ length: 100 }, (_, i) => i + 1)
  expect(percentile(xs, 50)).toBe(50)
  expect(percentile(xs, 95)).toBe(95)
})

test('every per-frame event type acks a frame; coach and state events do not', () => {
  expect([...ACK_TYPES].sort()).toEqual(['error', 'frame', 'heartbeat', 'setup_checks'])
})

function frame(id: number, capture: number | null, proc = 12, dropped = 0): PraxisEvent {
  return { type: 'frame', t: id, id, latency: { capture_to_event_ms: capture, proc_ms: proc }, dropped }
}
function cue(id: number, ms: number): PraxisEvent {
  return { type: 'coach', t: id, id, latency: { event_to_cue_ms: ms, capture_to_cue_ms: null } }
}

test('useLatency keeps a rolling window of 60 per metric and only counts each event once', () => {
  const events: PraxisEvent[] = []
  const { result, rerender } = renderHook(({ evs }: { evs: PraxisEvent[] }) => useLatency(evs), { initialProps: { evs: events } })
  expect(result.current.captureToEvent).toBeNull()
  expect(result.current.frames).toBe(0)

  // 70 frames with capture->event 1..70 ms: the window keeps the last 60 (11..70)
  const many = Array.from({ length: 70 }, (_, i) => frame(i + 1, i + 1, 10, i === 3 ? 2 : 0))
  act(() => rerender({ evs: many }))
  expect(result.current.frames).toBe(70)
  expect(result.current.dropped).toBe(2)
  expect(result.current.captureToEvent).toEqual({ p50: 40, p95: 67 })
  expect(result.current.proc).toEqual({ p50: 10, p95: 10 })

  // re-rendering with the same events adds nothing
  act(() => rerender({ evs: many }))
  expect(result.current.frames).toBe(70)

  // a coach cue feeds event->cue
  act(() => rerender({ evs: [...many, cue(71, 3), cue(72, 5)] }))
  expect(result.current.eventToCue).toEqual({ p50: 3, p95: 5 })

  // events without a latency block (older service, replay frames without capture time) are skipped for that metric
  act(() => rerender({ evs: [...many, cue(71, 3), cue(72, 5), frame(73, null, 8)] }))
  expect(result.current.frames).toBe(71)
  expect(result.current.captureToEvent).toEqual({ p50: 40, p95: 67 })
  expect(result.current.proc).toEqual({ p50: 10, p95: 10 })
})

test('latencyLine reads p50/p95 for capture->event and event->cue, falls back to proc in replay', () => {
  expect(latencyLine({ captureToEvent: null, proc: null, eventToCue: null, frames: 0, dropped: 0 })).toBe('latency p50/p95 · capture→event — · event→cue —')
  expect(latencyLine({ captureToEvent: { p50: 48.4, p95: 91 }, proc: { p50: 20, p95: 30 }, eventToCue: { p50: 2.2, p95: 5.6 }, frames: 10, dropped: 0 })).toBe(
    'latency p50/p95 · capture→event 48/91 ms · event→cue 2/6 ms',
  )
  expect(latencyLine({ captureToEvent: null, proc: { p50: 20, p95: 30 }, eventToCue: null, frames: 10, dropped: 3 })).toBe(
    'latency p50/p95 · processing 20/30 ms · event→cue — · 3 dropped',
  )
})

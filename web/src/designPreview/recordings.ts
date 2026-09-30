/** Design preview only: recorded session-socket streams (server -> client messages with their
 *  ms offsets). Each loads lazily in its own chunk the first time a screen opens a socket.
 *
 *  - nhpt, cup: the service's replay of the synthetic dataset_v0 clips, recorded over the live
 *    service's WebSocket (`scripts/capture-design-fixtures.mjs`).
 *  - abduction: no replay clip exists; the synthetic landmark stream run offline through the
 *    service's pipeline + rule coach (`scripts/record-design-streams.py`).
 *  - calibrate-*: Camera setup; the synthetic sheet renders run offline through the service's
 *    calibrate pipeline (same script). */
import type { SessionRecord } from '../lib/api'

export type RecordedMessage = { at: number; msg: Record<string, unknown> & { type: string; t?: number; id?: number } }
export type Recording = {
  exercise: string
  mode: string
  clip: string
  source: string
  synthetic_clip: boolean
  session_id: string
  summary: SessionRecord['summary'] & { t_start?: number; t_end?: number }
  trace: unknown
  messages: RecordedMessage[]
}

export type RecordingKey = 'abduction' | 'cup' | 'nhpt' | 'calibrate-nhpt' | 'calibrate-cup' | 'calibrate-arm'

const LOADERS: Record<RecordingKey, () => Promise<{ default: string }>> = {
  abduction: () => import('./fixtures/ws/abduction.json?raw'),
  cup: () => import('./fixtures/ws/cup.json?raw'),
  nhpt: () => import('./fixtures/ws/nhpt.json?raw'),
  'calibrate-nhpt': () => import('./fixtures/ws/calibrate-nhpt.json?raw'),
  'calibrate-cup': () => import('./fixtures/ws/calibrate-cup.json?raw'),
  'calibrate-arm': () => import('./fixtures/ws/calibrate-arm.json?raw'),
}

const cache = new Map<RecordingKey, Promise<Recording>>()

export function loadRecording(key: RecordingKey): Promise<Recording> {
  let p = cache.get(key)
  if (!p) {
    p = LOADERS[key]().then((m) => JSON.parse(m.default) as Recording)
    cache.set(key, p)
  }
  return p
}

/** Which recording answers a session-socket URL (the query the live screens send).
 *  A replay id wins (both replay clips map to their exercise); otherwise the mode decides, so a
 *  "live camera" session in the preview plays the same exercise's recording. */
export function recordingFor(q: URLSearchParams): RecordingKey | null {
  const mode = q.get('mode') ?? ''
  const replay = q.get('replay') ?? ''
  if (mode === 'calibrate') {
    if (q.get('for') === 'arm') return 'calibrate-arm'
    return q.get('sheet') === 'cup_targets' ? 'calibrate-cup' : 'calibrate-nhpt'
  }
  if (/nhpt/.test(replay) || mode === 'nhpt') return 'nhpt'
  if (/cup/.test(replay) || mode === 'cup') return 'cup'
  if (mode === 'arm') return 'abduction' // the only visible arm exercise (28 Sep lock)
  return null
}

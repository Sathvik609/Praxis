/** Session-service event stream types. Mirrors services/session/praxis_session/events.py. */

export interface BaseEvent {
  type: string
  t: number
}

export interface HeartbeatEvent extends BaseEvent {
  type: 'heartbeat'
  frame_index: number
  frame: { width: number; height: number; bytes: number }
}

export interface ErrorEvent extends BaseEvent {
  type: 'error'
  code: string
  frame_index?: number
}

export type SessionEvent = HeartbeatEvent | ErrorEvent | (BaseEvent & Record<string, unknown>)

export function parseEvent(raw: string): SessionEvent | null {
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const rec = obj as Record<string, unknown>
  if (typeof rec.type !== 'string' || typeof rec.t !== 'number') return null
  return rec as SessionEvent
}

export function isHeartbeat(ev: SessionEvent | null): ev is HeartbeatEvent {
  return !!ev && ev.type === 'heartbeat' && typeof (ev as HeartbeatEvent).frame === 'object'
}

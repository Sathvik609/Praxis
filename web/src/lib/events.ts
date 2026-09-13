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

export interface FsmSnapshot {
  state: string
  target: number | null
  reps: number
  finished: boolean
}

export interface NhptSnapshot extends FsmSnapshot {
  mode: 'nhpt'
  started: boolean
  completed: boolean
  pegs_done: number
  elapsed_s: number
  total_s: number | null
}

export interface Overlay {
  markers_px: Record<string, number[][]>
  holes_px: number[][] // [x, y, r] in frame pixels
  target: number | null
}

export interface FrameEvent extends BaseEvent {
  type: 'frame'
  frame_index: number
  calibrated: boolean
  paused: boolean
  mode: 'calibrate' | 'pegboard' | 'nhpt'
  fsm: FsmSnapshot | null
  nhpt: NhptSnapshot | null
  occupancy: Record<string, 'empty' | 'occupied'> | null
  free_pegs_mm: number[][]
  overlay: Overlay
}

export interface PerceptionLostEvent extends BaseEvent {
  type: 'perception_lost'
  reason: string
  missing_ids: number[]
}

export type SessionEvent =
  | HeartbeatEvent
  | ErrorEvent
  | FrameEvent
  | PerceptionLostEvent
  | (BaseEvent & Record<string, unknown>)

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

export function isFrame(ev: SessionEvent | null): ev is FrameEvent {
  return !!ev && ev.type === 'frame' && typeof (ev as FrameEvent).overlay === 'object'
}

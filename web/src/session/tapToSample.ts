import type { PraxisEvent } from '../lib/events'

/** The frame the service reports in (and the browser sends): 640 × 480. */
export const FRAME_W = 640
export const FRAME_H = 480

export type Rect = { left: number; top: number; width: number; height: number }

/** A tap on the camera picture -> a point in the frame the service received, or null when the
 *  tap missed the picture. `rect` is the 4:3 `.sx-frame` box that both the video
 *  (object-fit: cover of the 4:3 crop the browser sends) and the overlay canvas fill, so the
 *  letterbox bars around it in the feed panel are outside it. The live preview is mirrored
 *  (`scaleX(-1)`) but the frames sent are not, so a mirrored tap is flipped back. */
export function tapToFramePx(clientX: number, clientY: number, rect: Rect, mirrored: boolean, w = FRAME_W, h = FRAME_H): [number, number] | null {
  if (!(rect.width > 0 && rect.height > 0)) return null
  let u = (clientX - rect.left) / rect.width
  const v = (clientY - rect.top) / rect.height
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null
  if (mirrored) u = 1 - u
  return [Math.round(u * w * 10) / 10, Math.round(v * h * 10) / 10]
}

export type SampleReply = { id: number; ok: boolean; message: string; reason?: string; detected?: boolean }

/** The service's answer to the newest `sample_colour` command sent after event `afterId`. */
export function latestSampleReply(events: PraxisEvent[], afterId: number): SampleReply | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.id <= afterId) break
    if (e.type === 'command' && e.cmd === 'sample_colour') {
      const message = typeof e.message === 'string' ? e.message : typeof e.error === 'string' ? e.error : e.ok ? 'Colour set.' : 'That did not work. Try again.'
      return { id: e.id, ok: e.ok === true, message, reason: typeof e.reason === 'string' ? e.reason : undefined, detected: typeof e.detected === 'boolean' ? e.detected : undefined }
    }
  }
  return null
}

/** The id of the newest event (0 when none): a sample sent now is answered after it. */
export function lastEventId(events: PraxisEvent[]): number {
  return events.length ? events[events.length - 1].id : 0
}

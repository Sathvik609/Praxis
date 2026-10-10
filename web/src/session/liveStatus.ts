import type { ChipTone } from '../design/Chip'
import { processingPlace } from '../lib/config'
import type { Overlay } from './useCoach'

/** One status for the header chip, the feed label and the coach fallback, so the screen
 *  never says "Tracking ready" next to "Getting the camera ready" (audit 17 Sep, A7). */
export type LiveStatus =
  | 'connecting'
  | 'camera_blocked'
  | 'service_unreachable'
  | 'waiting_for_frames'
  | 'calibrating'
  | 'tracking'
  | 'lost'
  | 'replay'
  | 'paused'
  | 'ended'

export function liveStatus(a: {
  connected: boolean
  camActive: boolean
  error: string | null
  replay: boolean
  frame: { calibrated?: boolean } | null
  lost: boolean
  overlay: Overlay | null
  ended: boolean
}): LiveStatus {
  if (a.ended || a.overlay?.kind === 'stopped') return 'ended'
  if (a.overlay) return 'paused'
  if (a.error) return /unreachable/i.test(a.error) ? 'service_unreachable' : 'camera_blocked'
  if (a.lost) return 'lost'
  if (!a.connected) return 'connecting'
  if (!a.frame) return a.replay ? 'replay' : 'waiting_for_frames'
  if (a.frame.calibrated === false) return 'calibrating'
  return a.replay ? 'replay' : 'tracking'
}

export type StatusLabel = { chip: string; tone: ChipTone; feed: string; coach: string | null }

/** Which way the camera looks at the task: Arm out to the side is scored from the front (the
 *  side view serves the exercises hidden on 28 Sep); cup and NHPT look down at a sheet. */
export type CameraView = 'side' | 'front' | 'table'

const FIND: Record<CameraView, string> = {
  side: 'Turn your practising side to the camera.',
  front: 'Face the camera with both shoulders and hips in view.',
  table: 'Show all four corner markers of the sheet. Nothing is counted until I can see it.',
}
const LOST: Record<CameraView, string> = {
  side: 'I cannot see your shoulder and hip. Turn your practising side to the camera.',
  front: 'I cannot see both shoulders. Face the camera with your shoulders and hips in view.',
  table: 'I lost the sheet. Keep all four corner markers in view.',
}

/** `view` defaults to the side view for arm work and the sheet for cup / NHPT. */
export function statusLabel(s: LiveStatus, mode: 'nhpt' | 'cup' | 'arm', view?: CameraView): StatusLabel {
  const v: CameraView = mode === 'arm' ? (view === 'front' ? 'front' : 'side') : 'table'
  const sheet = FIND[v]
  switch (s) {
    case 'connecting':
      return { chip: 'Connecting', tone: 'neutral', feed: 'Connecting to the coach service', coach: 'Connecting to the coach service.' }
    case 'camera_blocked':
      return { chip: 'Camera blocked', tone: 'red', feed: 'Camera blocked', coach: 'Camera blocked. Allow it in the address bar, or use a recorded session.' }
    case 'service_unreachable':
      return { chip: 'Coach offline', tone: 'red', feed: 'Coach service unreachable', coach: 'I cannot reach the coach service. Check that it is running, then try again.' }
    case 'waiting_for_frames':
      return { chip: 'Starting camera', tone: 'neutral', feed: 'Starting the camera', coach: 'Getting the camera ready.' }
    case 'calibrating':
      return { chip: mode === 'arm' ? 'Looking for you' : 'Looking for the sheet', tone: 'amber', feed: sheet, coach: sheet }
    case 'tracking':
      return { chip: 'Tracking', tone: 'mint', feed: `Live · ${processingPlace()}`, coach: null }
    case 'lost':
      return { chip: 'Tracking lost', tone: 'amber', feed: 'Tracking lost', coach: LOST[v] }
    case 'replay':
      return { chip: 'Replay', tone: 'amber', feed: 'Replay · processed on the service', coach: null }
    case 'paused':
      return { chip: 'Paused', tone: 'neutral', feed: 'Paused', coach: null }
    case 'ended':
      return { chip: 'Ended', tone: 'neutral', feed: 'Session ended', coach: null }
  }
}

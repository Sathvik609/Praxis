import type { ChipTone } from '../design/Chip'
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

export function statusLabel(s: LiveStatus, mode: 'nhpt' | 'cup' | 'arm'): StatusLabel {
  const sheet = mode === 'arm' ? 'Turn your practising side to the camera.' : 'Show all four corner markers of the sheet.'
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
      return { chip: 'Tracking', tone: 'mint', feed: 'Live · processed on this device', coach: null }
    case 'lost':
      return { chip: 'Tracking lost', tone: 'amber', feed: 'Tracking lost', coach: mode === 'arm' ? 'I cannot see your shoulder and hip. Turn your practising side to the camera.' : 'I lost the sheet. Keep all four corner markers in view.' }
    case 'replay':
      return { chip: 'Replay', tone: 'amber', feed: 'Replay · processed on the service', coach: null }
    case 'paused':
      return { chip: 'Paused', tone: 'neutral', feed: 'Paused', coach: null }
    case 'ended':
      return { chip: 'Ended', tone: 'neutral', feed: 'Session ended', coach: null }
  }
}

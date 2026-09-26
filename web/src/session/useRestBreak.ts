import { useState } from 'react'

/** "Take a rest" on the live screens. It is not Pause: the socket gets a pause tagged
 *  `reason: 'rest'` (the service logs pauses; see the service note in the report on logging it
 *  as a rest), and the screen shows a rest overlay with a running timer instead of the pause
 *  overlay. `cancel` closes it without resuming (used when the session is ended from it). */
export function useRestBreak(send: (o: Record<string, unknown>) => void, clearOverlay: () => void) {
  const [since, setSince] = useState<number | null>(null)
  return {
    since,
    start: () => {
      send({ cmd: 'pause', reason: 'rest' })
      setSince(Date.now())
    },
    end: () => {
      send({ cmd: 'resume' })
      clearOverlay()
      setSince(null)
    },
    cancel: () => setSince(null),
  }
}

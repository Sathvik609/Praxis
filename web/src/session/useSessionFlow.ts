import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PraxisEvent } from '../lib/events'
import type { Feedback } from '../screens/08-feedback/FeedbackOverlay'

/** End-of-session flow shared by the live screens: forward the stored check-in when the
 *  socket opens; on End/complete show the feedback overlay; after the service acknowledges
 *  the feedback (session persisted) navigate to the report by id. */
export function useSessionFlow(events: PraxisEvent[], send: (o: Record<string, unknown>) => void, stop: () => void, connected: boolean) {
  const nav = useNavigate()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const fallback = useRef<unknown>(null)
  const sentCheckin = useRef(false)

  useEffect(() => {
    if (!connected || sentCheckin.current) return
    sentCheckin.current = true
    try {
      const raw = sessionStorage.getItem('praxis.checkin')
      if (raw) {
        const c = JSON.parse(raw)
        send({ cmd: 'checkin', pain: c.pain ?? 0, energy: c.energy ?? '', minutes: c.minutes ?? 0, new_symptoms: !!c.new_symptoms })
      }
    } catch {
      /* no check-in stored */
    }
  }, [connected, send])

  const ack = [...events].reverse().find((e) => e.type === 'command' && e.cmd === 'feedback') as (PraxisEvent & { summary?: { session_id?: string } }) | undefined
  useEffect(() => {
    if (!ack) return
    const sid = ack.summary?.session_id
    stop()
    nav(sid ? `/report/${sid}` : '/report', { state: fallback.current })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ack?.id])

  return {
    feedbackOpen,
    finish: (fallbackState: unknown) => {
      fallback.current = fallbackState
      if (!connected) {
        stop()
        nav('/report', { state: fallbackState })
        return
      }
      setFeedbackOpen(true)
    },
    save: (f: Feedback) => {
      send({ cmd: 'feedback', ...f })
      setFeedbackOpen(false)
    },
    skip: () => {
      send({ cmd: 'feedback' })
      setFeedbackOpen(false)
    },
  }
}

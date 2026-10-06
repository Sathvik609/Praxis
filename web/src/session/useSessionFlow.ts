import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { finishReport, recordPainAfter } from '../lib/day'
import type { PraxisEvent } from '../lib/events'
import type { Feedback } from '../screens/08-feedback/FeedbackOverlay'

/** Why a session ended early: the End dialog's reasons (`pain` opens the pain check instead),
 *  or the hold it was ended from (`rest`, `paused`). */
export type EndReason = 'pain' | 'tired' | 'blocked' | 'finished' | 'rest' | 'paused'

/** End-of-session flow shared by the live screens: forward the stored check-in when the
 *  socket opens; on End/complete show the feedback overlay; after the service acknowledges
 *  the feedback (session persisted) navigate to the report by id. How the session ended
 *  (`ended_early`, `end_reason`) travels in the feedback payload, which the service stores and
 *  traces verbatim, and in the offline fallback state. */
/** Where to go after the feedback is stored instead of the report (`mode` = the live screen). */
export type Then = { url: string; mode: 'arm' | 'cup' | 'nhpt' }

export function useSessionFlow(events: PraxisEvent[], send: (o: Record<string, unknown>) => void, stop: () => void, connected: boolean) {
  const nav = useNavigate()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [early, setEarly] = useState(false)
  const fallback = useRef<unknown>(null)
  const then = useRef<Then | null>(null)
  const ending = useRef<{ ended_early: boolean; end_reason: EndReason | null }>({ ended_early: false, end_reason: null })
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
    const next = then.current
    if (next && sid) {
      // the report is stored; bind it to today (as the report page would) and go on
      finishReport(sid, next.mode, false)
      nav(next.url)
      return
    }
    nav(sid ? `/report/${sid}` : '/report', { state: fallback.current })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ack?.id])

  return {
    feedbackOpen,
    /** The session ended early (the feedback form adds its "What got in the way?" step). */
    early,
    /** `fallbackState` is the report's state when the service never answers (offline).
     *  `next` ("Next exercise"): after the feedback is stored, bind the report to today's run
     *  and open `next.url` instead of the report (offline still goes to the report). */
    finish: (endedEarly: boolean, reason?: EndReason, fallbackState?: Record<string, unknown>, next?: Then) => {
      then.current = next ?? null
      ending.current = { ended_early: endedEarly, end_reason: reason ?? null }
      fallback.current = { ...fallbackState, ...ending.current }
      setEarly(endedEarly)
      if (!connected) {
        stop()
        nav('/report', { state: fallback.current })
        return
      }
      setFeedbackOpen(true)
    },
    save: (f: Feedback) => {
      recordPainAfter(f.pain_after)
      send({ cmd: 'feedback', ...f, ...ending.current })
      setFeedbackOpen(false)
    },
    skip: () => {
      send({ cmd: 'feedback', ...ending.current })
      setFeedbackOpen(false)
    },
  }
}

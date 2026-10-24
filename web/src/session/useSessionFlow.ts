import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { finishReport, recordPainAfter } from '../lib/day'
import type { PraxisEvent } from '../lib/events'
import type { Feedback } from '../screens/08-feedback/FeedbackOverlay'

/** Why a session ended early: the End dialog's reasons (`pain` opens the pain check instead),
 *  or the hold it was ended from (`rest`, `paused`); `replay_end` is a replay clip that ran out
 *  before the session finished by itself (not early, not the patient's doing). */
export type EndReason = 'pain' | 'tired' | 'blocked' | 'finished' | 'rest' | 'paused' | 'replay_end'
/** A stop rule ended the session (`stop:<rule id>`, e.g. `stop:exertion`); events.schema.json
 *  documents `end_reason` as free text or a stop rule id. */
export type StopEnd = `stop:${string}`

/** End-of-session flow shared by the live screens: forward the stored check-in when the
 *  socket opens; on End/complete show the feedback overlay; after the service acknowledges
 *  the feedback (session persisted) navigate to the report by id. How the session ended
 *  (`ended_early`, `end_reason`) travels in the feedback payload, which the service stores and
 *  traces verbatim, and in the offline fallback state. */
/** Where to go after the feedback is stored instead of the report (`mode` = the live screen). */
export type Then = { url: string; mode: 'arm' | 'cup' | 'nhpt' }

/** How long the screen waits for the service to acknowledge the feedback before it leaves for
 *  the report on its own (13 Oct team test: a dropped socket left the patient on the live screen
 *  with End session doing nothing). */
export const ACK_WAIT_MS = 5000

/** `replayOver` (10 Oct walkthrough): the service sent `replay_end` (the clip ran out; the socket
 *  stays open for the feedback) and the session has not been finished yet. The screen then
 *  finishes with `finish(false, 'replay_end', …)` and its own fallback state, unless it already
 *  finished by itself (e.g. the cup's done modal is open); before this a replay that never
 *  completed froze on its last frame. */
/** `endCapture` (optional) stops the camera the moment the session is ended, keeping the socket
 *  open for the feedback: nothing is measured behind the feedback form. */
export function useSessionFlow(events: PraxisEvent[], send: (o: Record<string, unknown>) => void, stop: () => void, connected: boolean, endCapture?: () => void) {
  const nav = useNavigate()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [early, setEarly] = useState(false)
  const [recordingEnded, setRecordingEnded] = useState(false)
  const [done, setDone] = useState(false)
  const finished = useRef(false)
  const left = useRef(false)
  const [awaitingAck, setAwaitingAck] = useState(false)
  const fallback = useRef<unknown>(null)
  const then = useRef<Then | null>(null)
  const ending = useRef<{ ended_early: boolean; end_reason: EndReason | StopEnd | null }>({ ended_early: false, end_reason: null })
  const sentCheckin = useRef(false)

  useEffect(() => {
    if (!connected || sentCheckin.current) return
    sentCheckin.current = true
    try {
      const raw = sessionStorage.getItem('praxis.checkin')
      if (raw) {
        const c = JSON.parse(raw)
        send({ cmd: 'checkin', pain: c.pain ?? 0, energy: c.energy ?? '', minutes: c.minutes ?? 0, new_symptoms: !!c.new_symptoms, ...(c.continue_gently ? { continue_gently: true } : {}) })
      }
    } catch {
      /* no check-in stored */
    }
  }, [connected, send])

  const ack = [...events].reverse().find((e) => e.type === 'command' && e.cmd === 'feedback') as (PraxisEvent & { summary?: { session_id?: string } }) | undefined
  /** Leave for the report with the screen's own state (no stored report to open). Once. */
  function leave() {
    if (left.current) return
    left.current = true
    setAwaitingAck(false)
    stop()
    nav('/report', { state: fallback.current })
  }

  useEffect(() => {
    if (!ack || left.current) return
    left.current = true
    setAwaitingAck(false)
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

  // The feedback was sent but the service never answered, or the socket closed meanwhile: leave
  // anyway, so ending a session can never strand the patient on the live screen.
  useEffect(() => {
    if (!awaitingAck) return
    if (!connected) {
      leave()
      return
    }
    const id = window.setTimeout(leave, ACK_WAIT_MS)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingAck, connected])

  const replayOver = !done && events.some((e) => e.type === 'replay_end')

  function sendFeedback(f: Partial<Feedback>) {
    setFeedbackOpen(false)
    if (!connected) {
      leave() // the socket is gone: nothing can store it, go to the report
      return
    }
    send({ cmd: 'feedback', ...f, ...ending.current })
    setAwaitingAck(true)
  }

  /** `fallbackState` is the report's state when the service never answers (offline).
   *  `next` ("Next exercise"): after the feedback is stored, bind the report to today's run
   *  and open `next.url` instead of the report (offline still goes to the report). */
  function finish(endedEarly: boolean, reason?: EndReason | StopEnd, fallbackState?: Record<string, unknown>, next?: Then) {
    if (finished.current) return
    finished.current = true
    setDone(true)
    then.current = next ?? null
    ending.current = { ended_early: endedEarly, end_reason: reason ?? null }
    fallback.current = { ...fallbackState, ...ending.current }
    setEarly(endedEarly)
    setRecordingEnded(reason === 'replay_end')
    if (!connected) {
      leave()
      return
    }
    endCapture?.()
    setFeedbackOpen(true)
  }

  return {
    feedbackOpen,
    /** The session ended early (the feedback form adds its "What got in the way?" step). */
    early,
    /** The session was finished by the replay clip running out (the feedback says so). */
    recordingEnded,
    /** The replay clip ran out and nothing has finished the session yet. */
    replayOver,
    /** The session has been ended (feedback open, or waiting to open the report). */
    ended: done,
    finish,
    /** `ended_early` / `end_reason` come from `finish()` and override the form's. */
    save: (f: Partial<Feedback>) => {
      recordPainAfter(f.pain_after)
      sendFeedback(f)
    },
    skip: () => sendFeedback({}),
  }
}

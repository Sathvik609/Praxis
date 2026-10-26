import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import type { PraxisEvent } from '../../lib/events'
import { lastEventId, latestSampleReply, tapToFramePx, type SampleReply } from '../../session/tapToSample'

export type SampleTarget = 'cup' | 'pegs'

const COPY: Record<SampleTarget, { entry: string; tap: string; picture: string; noKeys: string }> = {
  cup: {
    entry: 'Cup not found? Tap the cup base on the picture',
    tap: 'Tap the cup base on the picture',
    picture: 'Camera picture: tap the cup base',
    noKeys: '',
  },
  pegs: {
    entry: 'Pegs not found? Tap a peg on the picture',
    tap: 'Tap a peg on the picture',
    picture: 'Camera picture: tap a peg',
    noKeys: 'With a keyboard, use the hole buttons on the board picture to sample a seated peg.',
  },
}

/** Seconds the service's answer stays in the feed band. */
const SHOW_S = 8

export type TapToSampleState = {
  mode: boolean
  pending: boolean
  reply: SampleReply | null
  start: () => void
  cancel: () => void
  sample: (px: [number, number]) => void
  /** NHPT: the board inset's hole buttons sample the peg seated in hole k (same answer path). */
  sampleHole: (hole: number) => void
}

/** Tap-to-sample (12 Oct): the patient taps the cup base (07b) or a peg (07) on
 *  the camera picture; the service samples its colour on the warped sheet and answers with a
 *  caption (`command` · `sample_colour` · `message`), traced as a patient-initiated `ui` action. */
export function useTapToSample(events: PraxisEvent[], send: (o: Record<string, unknown>) => void): TapToSampleState {
  const [mode, setMode] = useState(false)
  const [after, setAfter] = useState<number | null>(null)
  const [hidden, setHidden] = useState<number | null>(null)
  const reply = after == null ? null : latestSampleReply(events, after)
  const replyId = reply?.id ?? null
  useEffect(() => {
    if (replyId == null) return
    const id = setTimeout(() => setHidden(replyId), SHOW_S * 1000)
    return () => clearTimeout(id)
  }, [replyId])
  const lastId = lastEventId(events)
  const request = useCallback(
    (point: Record<string, number>) => {
      send({ cmd: 'sample_colour', ...point })
      setAfter(lastId)
      setMode(false)
    },
    [send, lastId],
  )
  const sample = useCallback((px: [number, number]) => request({ x_px: px[0], y_px: px[1] }), [request])
  const sampleHole = useCallback((hole: number) => request({ hole }), [request])
  const start = useCallback(() => setMode(true), [])
  const cancel = useCallback(() => setMode(false), [])
  return { mode, pending: after != null && !reply, reply: reply && reply.id !== hidden ? reply : null, start, cancel, sample, sampleHole }
}

/** What the feed band says about tap-to-sample right now, or null to keep the screen's own band. */
export function sampleBand(target: SampleTarget, s: TapToSampleState): { text: string; tone: 'amber' | 'mint' | 'neutral' } | null {
  if (s.mode) return { text: `${COPY[target].tap} · Esc to cancel`, tone: 'amber' }
  if (s.pending) return { text: 'Checking that colour…', tone: 'neutral' }
  if (s.reply) return { text: s.reply.message, tone: s.reply.ok && s.reply.detected ? 'mint' : 'amber' }
  return null
}

/** The entry button (bottom-right of the camera card) and, in sample mode, a tap layer over the
 *  picture. Keyboard: the button enters sample mode and focuses the layer; Enter on the layer
 *  samples `keyboardPx` (where the cup should be: its dot) when the screen has one; Escape
 *  cancels and focus returns to the button. A status line repeats the band for screen readers. */
export function TapToSample({ target, state, mirrored, keyboardPx = null, keyboardLabel = '' }: { target: SampleTarget; state: TapToSampleState; mirrored: boolean; keyboardPx?: [number, number] | null; keyboardLabel?: string }) {
  const copy = COPY[target]
  const entryRef = useRef<HTMLButtonElement>(null)
  const layerRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const { mode, cancel, sample } = state

  useEffect(() => {
    if (mode) layerRef.current?.focus()
    else if (wasOpen.current) entryRef.current?.focus()
    wasOpen.current = mode
  }, [mode])

  useEffect(() => {
    if (!mode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mode, cancel])

  const onTap = (e: MouseEvent<HTMLButtonElement>) => {
    if (e.detail === 0) {
      // Enter / Space on the layer: no pointer position, so use the screen's keyboard point
      if (keyboardPx) sample(keyboardPx)
      return
    }
    const pic = e.currentTarget.parentElement?.querySelector('.sx-frame')
    if (!pic) return
    const px = tapToFramePx(e.clientX, e.clientY, pic.getBoundingClientRect(), mirrored)
    if (px) sample(px)
  }

  const keys = keyboardPx ? `Press Enter to use ${keyboardLabel || 'the marked spot'}.` : copy.noKeys
  const band = sampleBand(target, state)
  return (
    <>
      {mode && (
        <button ref={layerRef} type="button" className="sx-sample-layer" aria-label={`${copy.picture}. ${keys} Escape cancels.`.replace(/\s+/g, ' ')} onClick={onTap} />
      )}
      <button ref={entryRef} type="button" className="sx-btn sx-btn-secondary sx-sample" onClick={mode ? cancel : state.start}>
        {mode ? 'Cancel' : copy.entry}
      </button>
      <p role="status" className="sr-only">{band?.text ?? ''}</p>
    </>
  )
}

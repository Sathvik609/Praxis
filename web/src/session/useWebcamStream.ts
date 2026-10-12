import { useCallback, useEffect, useRef, useState } from 'react'
import { parseEvent, type PraxisEvent } from '../lib/events'
import { ACK_TIMEOUT_MS, ACK_TYPES, nowEpochMs, withCaptureTime } from './latency'
import { testerParams } from '../lib/tester'

/** Plain-language camera failure, prefixed so screens can tell it from a service error. */
export function describeCameraError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : e instanceof Error ? e.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'camera: permission denied'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'camera: no camera found'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'camera: in use by another app'
    default:
      return `camera: ${e instanceof Error && e.message ? e.message : 'unavailable'}`
  }
}

/** Ask for 640×480 first; if the device rejects the size or is momentarily busy, ask again
 *  with no constraints before giving up (the service resizes whatever it gets). */
async function acquireCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('no mediaDevices', 'NotFoundError')
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
  } catch (e) {
    const name = e instanceof DOMException ? e.name : ''
    if (name === 'OverconstrainedError' || name === 'NotReadableError' || name === 'AbortError') {
      await new Promise((r) => setTimeout(r, 400))
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    }
    throw e
  }
}

/** Source rectangle [sx, sy, sw, sh] that centre-crops a `vw`×`vh` video to 4:3 (what the
 *  preview's object-fit: cover shows), so a 16:9 camera — the `video: true` fallback above gets
 *  the native size — is not squashed into the 640×480 frame. A squash breaks the square-pixel
 *  camera model behind the service's camera-angle row (11 Oct 2026 synthetic sweep: 45° read
 *  as 23°) and misaligns the overlay. */
export function crop43(vw: number, vh: number): [number, number, number, number] {
  if (!(vw > 0 && vh > 0)) return [0, 0, vw, vh]
  if (vw * 3 > vh * 4) {
    const sw = (vh * 4) / 3
    return [(vw - sw) / 2, 0, sw, vh]
  }
  const sh = (vw * 3) / 4
  return [0, (vh - sh) / 2, vw, sh]
}

type Opts = { wsUrl: string; mode: string; fps?: number; params?: Record<string, string>; replay?: string | null }

/** Streams 640x480 JPEG frames to the session service and collects the JSON events it returns.
 *  Frames are built on a canvas from the <video>; nothing is recorded.
 *
 *  Back-pressure (Sprint D, D-LAT): every frame is prefixed with its capture time (8-byte
 *  little-endian float64, ms since epoch — see `latency.ts`), and the next frame is captured
 *  only after the service answered the previous one with a per-frame event (`ACK_TYPES`) or
 *  after `ACK_TIMEOUT_MS`. `fps` is therefore a ceiling, not a rate: a slow host gets fewer,
 *  fresher frames instead of a growing queue. */
export function useWebcamStream({ wsUrl, mode, fps = 12, params = {}, replay = null }: Opts) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const genRef = useRef(0) // bumps on every start/stop so a stale getUserMedia result is discarded
  const inflightRef = useRef<{ waiting: boolean; sentAt: number }>({ waiting: false, sentAt: 0 })
  const [camActive, setCamActive] = useState(false)
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<PraxisEvent | null>(null)
  const [events, setEvents] = useState<PraxisEvent[]>([])
  // The session this socket feeds: the event that names it (session_start / replay_start) soon
  // leaves the 200-event window, so it is kept here for the trace panel.
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback(() => {
    genRef.current += 1
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = null
    inflightRef.current = { waiting: false, sentAt: 0 }
    const ws = wsRef.current
    if (ws) {
      // Detach before closing: a socket closed before it opened (StrictMode double mount)
      // must not report "service unreachable" for the connection that replaced it.
      ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null
      ws.close()
    }
    wsRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamActive(false)
    setConnected(false)
  }, [])

  const attach = useCallback((ws: WebSocket) => {
    const mine = () => wsRef.current === ws
    ws.onopen = () => mine() && setConnected(true)
    ws.onclose = () => mine() && setConnected(false)
    ws.onerror = () => mine() && setError('session service unreachable')
    ws.onmessage = (m) => {
      if (!mine()) return
      const e = parseEvent(String(m.data))
      if (e) {
        if (ACK_TYPES.has(e.type)) inflightRef.current.waiting = false
        setLastEvent(e)
        setEvents((xs) => [...xs.slice(-199), e])
        const sid = (e as { session_id?: unknown }).session_id
        if (typeof sid === 'string' && sid) setSessionId(sid)
      }
    }
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setSessionId(null)
    // A new run starts from an empty window: nothing the previous run sent (a completion, setup
    // checks) may be read as this run's (`useEventHistory` clears on the empty window too).
    setEvents([])
    setLastEvent(null)
    const gen = ++genRef.current
    if (replay) {
      // Replay mode: no camera; the service streams the recorded clip through the same pipeline.
      const q = new URLSearchParams({ mode, ...params, ...testerParams(), replay }).toString()
      const ws = new WebSocket(`${wsUrl}?${q}`)
      wsRef.current = ws
      attach(ws)
      setCamActive(true)
      return
    }
    try {
      const stream = await acquireCamera()
      if (gen !== genRef.current) {
        // A stop() or a newer start() happened while the prompt was open (React StrictMode
        // double-mount does this): release this stream and let the newer call own the camera.
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        try {
          await videoRef.current.play()
        } catch (e) {
          if (!(e instanceof DOMException && e.name === 'AbortError')) throw e
        }
      }
      setCamActive(true)
      const q = new URLSearchParams({ mode, ...params, ...testerParams() }).toString()
      const ws = new WebSocket(`${wsUrl}?${q}`)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws
      attach(ws)
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 480
      const ctx = canvas.getContext('2d')!
      const inflight = inflightRef.current
      inflight.waiting = false
      timerRef.current = window.setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN || !videoRef.current) return
        const now = Date.now()
        if (inflight.waiting && now - inflight.sentAt < ACK_TIMEOUT_MS) return // previous frame still unanswered
        inflight.waiting = true
        inflight.sentAt = now
        const tCapture = nowEpochMs()
        const v = videoRef.current
        if (v.videoWidth > 0 && v.videoHeight > 0) {
          const [sx, sy, sw, sh] = crop43(v.videoWidth, v.videoHeight)
          ctx.drawImage(v, sx, sy, sw, sh, 0, 0, 640, 480)
        } else {
          ctx.drawImage(v, 0, 0, 640, 480)
        }
        canvas.toBlob(
          (b) => {
            if (b && ws.readyState === WebSocket.OPEN) {
              b.arrayBuffer().then((buf) => ws.send(withCaptureTime(buf, tCapture)))
            } else {
              inflight.waiting = false
            }
          },
          'image/jpeg',
          0.7,
        )
      }, Math.round(1000 / fps))
    } catch (e) {
      if (gen !== genRef.current) return
      setError(describeCameraError(e))
      stop()
    }
  }, [wsUrl, mode, fps, params, replay, stop, attach])

  const send = useCallback((obj: Record<string, unknown>) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
  }, [])

  useEffect(() => stop, [stop])
  return { camActive, connected, lastEvent, events, sessionId, error, start, stop, send, videoRef }
}

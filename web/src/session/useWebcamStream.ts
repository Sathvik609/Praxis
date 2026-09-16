import { useCallback, useEffect, useRef, useState } from 'react'
import { parseEvent, type PraxisEvent } from '../lib/events'

type Opts = { wsUrl: string; mode: string; fps?: number; params?: Record<string, string> }

/** Streams 640x480 JPEG frames to the session service and collects the JSON events it returns.
 *  Frames are built on a canvas from the <video>; nothing is recorded. */
export function useWebcamStream({ wsUrl, mode, fps = 12, params = {} }: Opts) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const genRef = useRef(0) // bumps on every start/stop so a stale getUserMedia result is discarded
  const [camActive, setCamActive] = useState(false)
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<PraxisEvent | null>(null)
  const [events, setEvents] = useState<PraxisEvent[]>([])
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback(() => {
    genRef.current += 1
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = null
    wsRef.current?.close()
    wsRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamActive(false)
    setConnected(false)
  }, [])

  const start = useCallback(async () => {
    setError(null)
    const gen = ++genRef.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      })
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
      const q = new URLSearchParams({ mode, ...params }).toString()
      const ws = new WebSocket(`${wsUrl}?${q}`)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws
      ws.onopen = () => setConnected(true)
      ws.onclose = () => setConnected(false)
      ws.onerror = () => setError('session service unreachable')
      ws.onmessage = (m) => {
        const e = parseEvent(String(m.data))
        if (e) {
          setLastEvent(e)
          setEvents((xs) => [...xs.slice(-199), e])
        }
      }
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 480
      const ctx = canvas.getContext('2d')!
      timerRef.current = window.setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN || !videoRef.current) return
        ctx.drawImage(videoRef.current, 0, 0, 640, 480)
        canvas.toBlob(
          (b) => {
            if (b && ws.readyState === WebSocket.OPEN) b.arrayBuffer().then((buf) => ws.send(buf))
          },
          'image/jpeg',
          0.7,
        )
      }, Math.round(1000 / fps))
    } catch (e) {
      if (gen !== genRef.current) return
      setError(e instanceof Error ? e.message : 'camera unavailable')
      stop()
    }
  }, [wsUrl, mode, fps, params, stop])

  useEffect(() => stop, [stop])
  return { camActive, connected, lastEvent, events, error, start, stop, videoRef }
}

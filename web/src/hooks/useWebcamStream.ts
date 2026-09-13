import { useCallback, useEffect, useRef, useState } from 'react'
import { parseEvent, type SessionEvent } from '../lib/events'

export interface WebcamStreamOptions {
  wsUrl: string
  fps?: number
  width?: number
  height?: number
  jpegQuality?: number
}

export interface WebcamStreamState {
  camActive: boolean
  connected: boolean
  lastEvent: SessionEvent | null
  events: SessionEvent[]
  error: string | null
  start: () => Promise<void>
  stop: () => void
  videoRef: React.RefObject<HTMLVideoElement | null>
}

/**
 * Captures the webcam, downsamples to 640x480 JPEG, and streams frames over a WebSocket at
 * `fps`. Frames are sent as binary; every reply is parsed as a session event. Nothing is stored.
 */
export function useWebcamStream(opts: WebcamStreamOptions): WebcamStreamState {
  const { wsUrl, fps = 10, width = 640, height = 480, jpegQuality = 0.7 } = opts
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const [camActive, setCamActive] = useState(false)
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<SessionEvent | null>(null)
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCamActive(true)
    } catch (e) {
      setError(`Webcam unavailable: ${(e as Error).message}`)
      return
    }

    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws
    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onerror = () => setError('Session service connection failed')
    ws.onmessage = (m) => {
      const ev = parseEvent(typeof m.data === 'string' ? m.data : '')
      if (!ev) return
      setLastEvent(ev)
      setEvents((prev) => (prev.length >= 200 ? [...prev.slice(-199), ev] : [...prev, ev]))
    }

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas')
      canvasRef.current.width = width
      canvasRef.current.height = height
    }
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    timerRef.current = window.setInterval(() => {
      const video = videoRef.current
      if (!video || !ctx || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 0) return
      ctx.drawImage(video, 0, 0, width, height)
      canvas.toBlob(
        (blob) => {
          if (blob && ws.readyState === WebSocket.OPEN) blob.arrayBuffer().then((buf) => ws.send(buf))
        },
        'image/jpeg',
        jpegQuality,
      )
    }, Math.round(1000 / fps))
  }, [wsUrl, fps, width, height, jpegQuality])

  useEffect(() => stop, [stop])

  return { camActive, connected, lastEvent, events, error, start, stop, videoRef }
}

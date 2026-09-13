import { useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { SessionView } from '../components/SessionView'
import { useWebcamStream } from '../hooks/useWebcamStream'
import { SESSION_WS_URL } from '../lib/config'
import { isFrame } from '../lib/events'

const SIZE = { width: 640, height: 480 }

/** Screen 08 route: /session?mode=nhpt|pegboard|calibrate&targets=0,1,2 */
export function Session() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const mode = (params.get('mode') ?? 'nhpt') as 'calibrate' | 'pegboard' | 'nhpt'
  const targets = params.get('targets')
  const wsUrl = useMemo(() => {
    const u = new URL(SESSION_WS_URL, window.location.href)
    u.searchParams.set('mode', mode)
    if (targets) u.searchParams.set('targets', targets)
    return u.toString()
  }, [mode, targets])

  const { camActive, events, lastEvent, error, start, stop, videoRef } = useWebcamStream({ wsUrl, fps: 10, ...SIZE })

  useEffect(() => {
    void start()
    return stop
  }, [start, stop])

  const frame = useMemo(() => {
    if (isFrame(lastEvent)) return lastEvent
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (isFrame(e)) return e
    }
    return null
  }, [lastEvent, events])

  const end = (reason: 'stop' | 'pain') => {
    stop()
    navigate(`/?ended=${reason}`)
  }

  return (
    <SessionView
      mode={mode}
      frame={frame}
      events={events}
      camActive={camActive}
      videoRef={videoRef}
      videoSize={SIZE}
      onStop={() => end('stop')}
      onPain={() => end('pain')}
      connectionError={error}
    />
  )
}

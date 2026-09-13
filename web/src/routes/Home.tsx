import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CamOnIndicator } from '../components/CamOnIndicator'
import { useWebcamStream } from '../hooks/useWebcamStream'
import { SESSION_API_URL, SESSION_WS_URL } from '../lib/config'
import { isHeartbeat } from '../lib/events'

/** Screen 03 Home (placeholder). Week 1: proves webcam → WebSocket → heartbeat round trip. */
export function Home() {
  const { camActive, connected, lastEvent, error, start, stop, videoRef } = useWebcamStream({
    wsUrl: SESSION_WS_URL,
    fps: 10,
  })
  const [health, setHealth] = useState<string>('checking…')

  useEffect(() => {
    fetch(`${SESSION_API_URL}/health`)
      .then((r) => r.json())
      .then((j) => setHealth(`OpenCV ${j.opencv_version} · ${j.mode} mode`))
      .catch(() => setHealth('session service offline'))
  }, [])

  const hb = lastEvent

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Praxis</h1>
          <p className="text-lg text-slate-600">Your rehab coach, at home. {health}</p>
        </div>
        <CamOnIndicator active={camActive} />
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video ref={videoRef} muted playsInline className="aspect-4/3 w-full object-cover" />
        </div>
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-lg">
          <div>Service: <b>{connected ? 'connected' : 'not connected'}</b></div>
          <div>Last event: <b>{hb ? hb.type : '—'}</b></div>
          {isHeartbeat(hb) && (
            <div className="text-slate-600">
              frame #{hb.frame_index} · {hb.frame.width}×{hb.frame.height} · {hb.frame.bytes} bytes · t={hb.t.toFixed(3)}
            </div>
          )}
          {error && <div className="text-red-700">{error}</div>}
        </div>
      </section>

      {camActive ? (
        <button
          onClick={stop}
          className="min-h-14 w-full rounded-2xl bg-slate-800 text-xl font-semibold text-white"
        >
          Stop camera
        </button>
      ) : (
        <button
          onClick={start}
          className="min-h-14 w-full rounded-2xl bg-blue-700 text-xl font-semibold text-white"
        >
          Start camera test
        </button>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Link to="/session?mode=nhpt" className="flex min-h-14 items-center justify-center rounded-2xl border-2 border-blue-700 text-xl font-semibold text-blue-800">
          Start Nine-Hole Peg Test
        </Link>
        <Link to="/session?mode=pegboard" className="flex min-h-14 items-center justify-center rounded-2xl border-2 border-blue-700 text-xl font-semibold text-blue-800">
          Start pegboard transfer
        </Link>
      </div>
      <p className="text-base text-slate-500">
        Video is processed in memory and never stored. Only events leave your device.
      </p>
    </div>
  )
}

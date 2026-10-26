import { useNavigate } from 'react-router-dom'
import { Button } from '../design/Button'
import { Card } from '../design/Card'
import { Camera, Play, RotateCcw } from '../design/Icon'

/** Shown in the feed when the camera is blocked or the coach service is unreachable, so a
 *  judge without a webcam always has a way forward. A highlight card on
 *  the dark stage; the text carries the state, the icon is decorative. */
export function cameraBlockedCopy(reason: 'camera_blocked' | 'service_unreachable', detail?: string | null): { title: string; text: string } {
  if (reason === 'service_unreachable') {
    return { title: 'Coach service unreachable', text: 'The coach service is not answering. Check that it is running, then try again, or run a recorded session.' }
  }
  const d = (detail ?? '').toLowerCase()
  if (d.includes('permission denied')) {
    return { title: 'Camera permission needed', text: 'Click the camera icon at the right end of the address bar, choose Allow, then try again. On a Mac also check System Settings → Privacy & Security → Camera for Chrome. Nothing is recorded.' }
  }
  if (d.includes('in use')) {
    return { title: 'Camera is in use', text: 'Another app is holding the camera (Zoom, Teams, FaceTime, Photo Booth). Quit it, then try again.' }
  }
  if (d.includes('no camera')) {
    return { title: 'No camera found', text: 'This device has no camera the browser can see. Plug one in, or run a recorded session instead.' }
  }
  return { title: 'Camera blocked', text: `The camera could not start${detail ? ` (${detail.replace(/^camera: /, '')})` : ''}. Allow it in the address bar and try again, or run a recorded session instead. Nothing is recorded either way.` }
}

export function CameraBlocked({ reason, detail, onRetry }: { reason: 'camera_blocked' | 'service_unreachable'; detail?: string | null; onRetry: () => void }) {
  const nav = useNavigate()
  const { title, text } = cameraBlockedCopy(reason, detail)
  return (
    <div role="alert" className="flex h-full w-full items-center justify-center bg-[var(--stage-a)]/95 p-6">
      <Card tone="highlight" className="w-full max-w-md text-center text-ink">
        <div aria-hidden className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-tint-red text-red-ink">
          <Camera className="h-7 w-7" />
        </div>
        <h2 className="text-2xl">{title}</h2>
        <p className="mt-2 text-lg text-muted">{text}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Button icon={<RotateCcw />} onClick={onRetry}>Try again</Button>
          <Button variant="secondary" icon={<Play />} onClick={() => nav('/details/settings')}>Use a recorded session</Button>
        </div>
      </Card>
    </div>
  )
}

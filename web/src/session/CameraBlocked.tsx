import { useNavigate } from 'react-router-dom'
import { Button } from '../design/Button'
import { Card } from '../design/Card'
import { Camera, Play, RotateCcw } from '../design/Icon'

/** Shown in the feed when the camera is blocked or the coach service is unreachable, so a
 *  judge without a webcam always has a way forward (audit 17 Sep, A6). A highlight card on
 *  the dark stage; the text carries the state, the icon is decorative. */
export function CameraBlocked({ reason, onRetry }: { reason: 'camera_blocked' | 'service_unreachable'; onRetry: () => void }) {
  const nav = useNavigate()
  const title = reason === 'camera_blocked' ? 'Camera blocked' : 'Coach service unreachable'
  const text =
    reason === 'camera_blocked'
      ? 'Allow the camera in the address bar and try again, or run a recorded session instead. Nothing is recorded either way.'
      : 'The coach service is not answering. Check that it is running, then try again, or run a recorded session.'
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

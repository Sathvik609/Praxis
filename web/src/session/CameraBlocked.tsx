import { useNavigate } from 'react-router-dom'
import { Button } from '../design/Button'

/** Shown in the feed when the camera is blocked or the coach service is unreachable, so a
 *  judge without a webcam always has a way forward (audit 17 Sep, A6). */
export function CameraBlocked({ reason, onRetry }: { reason: 'camera_blocked' | 'service_unreachable'; onRetry: () => void }) {
  const nav = useNavigate()
  const title = reason === 'camera_blocked' ? 'Camera blocked' : 'Coach service unreachable'
  const text =
    reason === 'camera_blocked'
      ? 'Allow the camera in the address bar and try again, or run a recorded session instead. Nothing is recorded either way.'
      : 'The coach service is not answering. Check that it is running, then try again, or run a recorded session.'
  return (
    <div role="alert" className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[var(--stage-a)]/95 p-8 text-center text-white">
      <div className="text-2xl font-bold">{title}</div>
      <p className="max-w-md text-lg text-white/80">{text}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button variant="inverse" onClick={onRetry}>Try again</Button>
        <Button variant="inverse" onClick={() => nav('/settings')}>Use a recorded session</Button>
      </div>
    </div>
  )
}

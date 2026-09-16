import { Button } from '../../design/Button'
import { Chip } from '../../design/Chip'

/** Wireframe 07b: the coach proposes a within-prescription progression; the patient accepts,
 *  declines or asks why. Nothing changes until the patient answers. */
export function ProgressionPrompt({
  reason,
  onAccept,
  onDecline,
  onWhy,
  whyOpen,
}: {
  reason: string
  onAccept: () => void
  onDecline: () => void
  onWhy: () => void
  whyOpen: boolean
}) {
  return (
    <div className="rounded-2xl border-2 border-amber bg-amber/10 p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-2xl">Coach suggests: try the fast arcs</h2>
        <Chip tone="amber">Within prescription</Chip>
      </div>
      <p className="mt-1 text-muted">{reason}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button onClick={onAccept}>Yes, go faster</Button>
        <Button variant="secondary" onClick={onDecline}>Keep pace</Button>
        <Button variant="secondary" onClick={onWhy}>Why?</Button>
      </div>
      {whyOpen && (
        <p className="mt-3 text-muted">
          Your program (Hospital GRASP L2) assigns 2 slow arcs then 2 fast arcs. The camera verified the slow arcs, so the fast arcs are the next step your therapist planned. Nothing goes above the prescribed level.
        </p>
      )}
    </div>
  )
}

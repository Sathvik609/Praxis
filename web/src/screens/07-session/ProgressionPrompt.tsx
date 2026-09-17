import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Chip } from '../../design/Chip'
import { Sparkles } from '../../design/Icon'

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
    <Card
      tone="highlight"
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles aria-hidden className="h-6 w-6 shrink-0 text-teal-ink" />
          Coach suggests: try the fast arcs
        </span>
      }
      action={<Chip tone="amber">Within prescription</Chip>}
    >
      <p className="text-muted">{reason}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button onClick={onAccept}>Yes, go faster</Button>
        <Button variant="secondary" onClick={onDecline}>Keep pace</Button>
        <Button variant="secondary" aria-expanded={whyOpen} onClick={onWhy}>Why?</Button>
      </div>
      {whyOpen && (
        <p className="mt-3 rounded-[var(--r-control)] bg-tint-mint p-3 text-lg">
          Your program (Hospital GRASP L2) assigns 2 slow arcs then 2 fast arcs. The camera verified the slow arcs, so the fast arcs are the next step your therapist planned. Nothing goes above the prescribed level.
        </p>
      )}
    </Card>
  )
}

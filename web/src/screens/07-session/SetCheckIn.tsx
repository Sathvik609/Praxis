import { useState } from 'react'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Sparkles } from '../../design/Icon'
import { NumberScale } from '../../design/NumberScale'
import { Overlay } from '../../design/Overlay'

/** Set check-in (wireframe 08b, in-session state): RPE between sets feeds the behavioural
 *  exertion index. The session is frozen behind the overlay until the patient answers or skips. */
export function SetCheckIn({ open, setNumber, onSubmit }: { open: boolean; setNumber: number; onSubmit: (rpe: number | null) => void }) {
  const [rpe, setRpe] = useState<number | null>(null)
  if (!open) return null
  return (
    <Overlay open title={`Set ${setNumber} done · how hard was that?`}>
      <p className="mt-2 flex items-start gap-2 text-muted">
        <Sparkles aria-hidden className="mt-1 h-5 w-5 shrink-0 text-teal-ink" />
        <span>0 = nothing at all, 10 = the hardest you can imagine. This sets the coach's pace; it is never a score.</span>
      </p>
      <Card tone="highlight" className="mt-5">
        <NumberScale label="Effort for that set" value={rpe} onChange={setRpe} leftAnchor="Nothing" rightAnchor="Maximal" />
      </Card>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={() => onSubmit(null)}>Skip</Button>
        <Button disabled={rpe === null} onClick={() => onSubmit(rpe)}>Continue to set {setNumber + 1}</Button>
      </div>
    </Overlay>
  )
}

import { useState } from 'react'
import { Button } from '../../design/Button'
import { NumberScale } from '../../design/NumberScale'
import { Overlay } from '../../design/Overlay'

/** Set check-in (wireframe 08b): RPE between sets feeds the behavioural exertion index. */
export function SetCheckIn({ open, setNumber, onSubmit }: { open: boolean; setNumber: number; onSubmit: (rpe: number | null) => void }) {
  const [rpe, setRpe] = useState<number | null>(null)
  if (!open) return null
  return (
    <Overlay open title={`Set ${setNumber} done · how hard was that?`}>
      <p className="text-muted">0 = nothing at all, 10 = the hardest you can imagine. This sets the coach's pace; it is never a score.</p>
      <div className="mt-5"><NumberScale label="Effort for that set" value={rpe} onChange={setRpe} leftAnchor="Nothing" rightAnchor="Maximal" /></div>
      <div className="mt-6 flex justify-end gap-3"><Button variant="secondary" onClick={() => onSubmit(null)}>Skip</Button><Button disabled={rpe === null} onClick={() => onSubmit(rpe)}>Continue to set {setNumber + 1}</Button></div>
    </Overlay>
  )
}

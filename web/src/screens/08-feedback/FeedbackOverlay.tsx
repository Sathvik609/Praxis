import { useState } from 'react'
import { Button } from '../../design/Button'
import { NumberScale } from '../../design/NumberScale'
import { Overlay } from '../../design/Overlay'

export type Feedback = { pain_after?: number; effort?: number; compared?: 'easier' | 'same' | 'harder' | 'first' }

/** Screen 08 · Post-session feedback. Camera and microphone are off. Missing = not recorded, never zero. */
export function FeedbackOverlay({ open, onSave, onSkip }: { open: boolean; onSave: (f: Feedback) => void; onSkip: () => void }) {
  const [pain, setPain] = useState<number | null>(null)
  const [effort, setEffort] = useState<number | null>(null)
  const [compared, setCompared] = useState<Feedback['compared'] | null>(null)
  const [more, setMore] = useState(false)
  const chip = (v: NonNullable<Feedback['compared']>, label: string) => (
    <button key={v} type="button" aria-pressed={compared === v} onClick={() => setCompared(v)} className={`min-h-14 rounded-full border-2 px-5 text-lg font-bold ${compared === v ? 'border-teal bg-teal text-white' : 'border-line bg-surface'}`}>{label}</button>
  )
  const save = () => {
    const f: Feedback = {}
    if (pain !== null) f.pain_after = pain
    if (effort !== null) f.effort = effort
    if (compared) f.compared = compared
    onSave(f)
  }
  return (
    <Overlay open={open} title="How was your practice?">
      <p className="text-muted">Camera and microphone are off. Tap or speak.</p>
      <div className="mt-5 space-y-6">
        <NumberScale label="Pain after practice" value={pain} onChange={setPain} leftAnchor="No pain" rightAnchor="Worst imaginable" />
        <NumberScale label="Effort" value={effort} onChange={setEffort} leftAnchor="No effort" rightAnchor="Maximum effort" />
        <div><div className="mb-2 font-bold">Compared with last time</div><div className="flex flex-wrap gap-3">{chip('easier', 'Easier')}{chip('same', 'About the same')}{chip('harder', 'Harder')}{chip('first', 'First time')}</div></div>
        <button type="button" className="text-muted underline" onClick={() => setMore((m) => !m)}>More (optional): feeling · barriers · pain location · spoken note to your therapist</button>
        {more && <textarea className="w-full rounded-xl border border-line p-3 text-lg" rows={3} placeholder="Anything for your therapist (optional)" />}
      </div>
      <div className="mt-6 flex justify-between">
        <Button variant="secondary" onClick={onSkip}>Skip optional feedback</Button>
        <Button onClick={save}>Save and view report</Button>
      </div>
    </Overlay>
  )
}

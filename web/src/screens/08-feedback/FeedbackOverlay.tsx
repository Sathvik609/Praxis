import { useState } from 'react'
import { Button } from '../../design/Button'
import { TextArea } from '../../design/Field'
import { Camera } from '../../design/Icon'
import { NumberScale } from '../../design/NumberScale'
import { Overlay, OverlayActions } from '../../design/Overlay'
import { Pill } from '../../design/Pill'

export type Feedback = { pain_after?: number; effort?: number; compared?: 'easier' | 'same' | 'harder' | 'first'; detail?: string }

type Compared = NonNullable<Feedback['compared']>
const COMPARED: { value: Compared; label: string }[] = [
  { value: 'easier', label: 'Easier' },
  { value: 'same', label: 'About the same' },
  { value: 'harder', label: 'Harder' },
  { value: 'first', label: 'First time' },
]

/** Screen 08 · Post-session feedback. Camera and microphone are off. Missing = not recorded,
 *  never zero. An optional free-text note travels with the payload as `detail`. */
export function FeedbackOverlay({ open, onSave, onSkip }: { open: boolean; onSave: (f: Feedback) => void; onSkip: () => void }) {
  const [pain, setPain] = useState<number | null>(null)
  const [effort, setEffort] = useState<number | null>(null)
  const [compared, setCompared] = useState<Compared | null>(null)
  const [more, setMore] = useState(false)
  const [detail, setDetail] = useState('')
  const save = () => {
    const f: Feedback = {}
    if (pain !== null) f.pain_after = pain
    if (effort !== null) f.effort = effort
    if (compared) f.compared = compared
    const note = detail.trim()
    if (note) f.detail = note
    onSave(f)
  }
  return (
    <Overlay
      open={open}
      title="How was your practice?"
      description="Three optional questions about how the practice felt. Nothing here is recorded by the camera or microphone; anything you skip is marked not recorded."
    >
      <p className="mt-2 flex items-center gap-2 text-lg text-muted">
        <Camera aria-hidden className="h-5 w-5 shrink-0" />
        Camera and microphone are off. Tap or speak.
      </p>
      <div className="mx-auto mt-6 max-w-3xl space-y-6">
        <NumberScale label="Pain after practice" value={pain} onChange={setPain} leftAnchor="No pain" rightAnchor="Worst imaginable" />
        <NumberScale label="Effort" value={effort} onChange={setEffort} leftAnchor="No effort" rightAnchor="Maximum effort" />
        <div>
          <div className="mb-2 font-bold">Compared with last time</div>
          <Pill<Compared | ''> ariaLabel="Compared with last time" value={compared ?? ''} options={COMPARED} onChange={(v) => v && setCompared(v)} />
        </div>
        {more ? (
          <TextArea
            label="A note for your therapist (optional)"
            hint="Feeling, barriers, where it hurt. Goes into your report; your therapist reads it, no one else."
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={3}
          />
        ) : (
          <Button variant="link" onClick={() => setMore(true)}>
            Add a note for your therapist (optional)
          </Button>
        )}
      </div>
      <OverlayActions>
        <Button variant="secondary" onClick={onSkip}>Skip optional feedback</Button>
        <Button onClick={save}>Save and view report</Button>
      </OverlayActions>
    </Overlay>
  )
}

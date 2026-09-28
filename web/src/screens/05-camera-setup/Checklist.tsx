import { Button } from '../../design/Button'
import { Chip } from '../../design/Chip'
import { AlertTriangle, Check, Info } from '../../design/Icon'

export type Check = {
  id: string
  label: string
  status: 'pass' | 'check' | 'fail' | 'pending'
  hint: string | null
  /** `camera`: status comes from the service. `self`: the camera does not measure this yet;
   *  the patient looks at the picture and taps. Absent means camera. */
  source?: 'camera' | 'self'
}

const tone = { pass: 'mint', check: 'amber', fail: 'red', pending: 'neutral' } as const
const word = { pass: 'Pass', check: 'Check', fail: 'Fail', pending: 'Waiting' } as const
const icon = { pass: <Check />, check: <AlertTriangle />, fail: <AlertTriangle />, pending: <Info /> } as const

/** The sheet tasks' rows before the first `setup_checks` event (Waiter – cup, NHPT). */
export const DEFAULT_CHECKS: Check[] = [
  { id: 'camera', label: 'Camera permission', status: 'pending', hint: null },
  { id: 'person', label: 'One person in view', status: 'pending', hint: null },
  { id: 'task_area', label: 'Hand and task area in view', status: 'pending', hint: null },
  { id: 'markers', label: 'Sheet found · all four corner markers visible', status: 'pending', hint: null },
  { id: 'angle', label: 'Camera looks down at the sheet', status: 'pending', hint: null },
  { id: 'lighting', label: 'Lighting and steady tracking', status: 'pending', hint: null },
]

/** Setup checks. Each row carries a status word and an icon (never colour alone) and a hint at
 *  body size when there is one. A `self` row is one the camera does not check yet: it says so
 *  ("You check") and has a 56 px "Yes, I can see it" toggle. */
export function Checklist({ checks, onTick }: { checks: Check[]; onTick?: (id: string) => void }) {
  const rows = checks.length ? checks : DEFAULT_CHECKS
  return (
    <ul className="divide-y divide-line">
      {rows.map((c) => {
        const self = c.source === 'self'
        const ticked = self && c.status === 'pass'
        return (
          <li key={c.id} className="flex min-h-14 items-start gap-4 py-3">
            <div className="w-32 shrink-0 pt-0.5">
              {self ? (
                <Chip tone={ticked ? 'mint' : 'neutral'} icon={ticked ? <Check /> : <Info />}>{ticked ? 'You checked' : 'You check'}</Chip>
              ) : (
                <Chip tone={tone[c.status]} icon={icon[c.status]}>{word[c.status]}</Chip>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-lg">{c.label}</div>
              {c.hint && !ticked && <div className="text-lg text-muted">{c.hint}</div>}
            </div>
            {self && onTick && (
              <Button variant="secondary" aria-pressed={ticked} aria-label={`${c.label}: ${ticked ? 'ticked, tap to undo' : 'yes, I can see it'}`} onClick={() => onTick(c.id)} className="shrink-0">
                {ticked ? 'Undo' : 'Yes, I can see it'}
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

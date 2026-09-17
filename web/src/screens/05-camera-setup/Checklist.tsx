import { Chip } from '../../design/Chip'
import { AlertTriangle, Check, Info } from '../../design/Icon'

export type Check = {
  id: string
  label: string
  status: 'pass' | 'check' | 'fail' | 'pending'
  hint: string | null
}

const tone = { pass: 'mint', check: 'amber', fail: 'red', pending: 'neutral' } as const
const word = { pass: 'Pass', check: 'Check', fail: 'Fail', pending: 'Waiting' } as const
const icon = { pass: <Check />, check: <AlertTriangle />, fail: <AlertTriangle />, pending: <Info /> } as const

export const DEFAULT_CHECKS: Check[] = [
  { id: 'camera', label: 'Camera permission', status: 'pending', hint: null },
  { id: 'person', label: 'One person in view', status: 'pending', hint: null },
  { id: 'task_area', label: 'Hand and task area in view', status: 'pending', hint: null },
  { id: 'markers', label: 'Sheet found · all four corner markers visible', status: 'pending', hint: null },
  { id: 'angle', label: 'Camera looks down at the sheet', status: 'pending', hint: null },
  { id: 'lighting', label: 'Lighting and steady tracking', status: 'pending', hint: null },
]

/** Setup checks from the service. Each row carries a status word and an icon (never colour
 *  alone) and a hint at body size when the service has one. */
export function Checklist({ checks }: { checks: Check[] }) {
  const rows = checks.length ? checks : DEFAULT_CHECKS
  return (
    <ul className="divide-y divide-line">
      {rows.map((c) => (
        <li key={c.id} className="flex min-h-14 items-start gap-4 py-3">
          <div className="w-28 shrink-0 pt-0.5">
            <Chip tone={tone[c.status]} icon={icon[c.status]}>{word[c.status]}</Chip>
          </div>
          <div className="min-w-0">
            <div className="text-lg">{c.label}</div>
            {c.hint && <div className="text-lg text-muted">{c.hint}</div>}
          </div>
        </li>
      ))}
    </ul>
  )
}

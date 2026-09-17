import { Chip } from '../../design/Chip'

export type Check = {
  id: string
  label: string
  status: 'pass' | 'check' | 'fail' | 'pending'
  hint: string | null
}

const tone = { pass: 'mint', check: 'amber', fail: 'red', pending: 'neutral' } as const
const word = { pass: 'Pass', check: 'Check', fail: 'Fail', pending: 'Waiting' } as const

export const DEFAULT_CHECKS: Check[] = [
  { id: 'camera', label: 'Camera permission', status: 'pending', hint: null },
  { id: 'person', label: 'One person in view', status: 'pending', hint: null },
  { id: 'task_area', label: 'Hand and task area in view', status: 'pending', hint: null },
  { id: 'markers', label: 'Sheet found · all four corner markers visible', status: 'pending', hint: null },
  { id: 'lighting', label: 'Lighting and steady tracking', status: 'pending', hint: null },
]

export function Checklist({ checks }: { checks: Check[] }) {
  const rows = checks.length ? checks : DEFAULT_CHECKS
  return (
    <ul className="divide-y divide-line">
      {rows.map((c) => (
        <li key={c.id} className="flex items-start gap-4 py-4">
          <div className="w-24 shrink-0">
            <Chip tone={tone[c.status]}>{word[c.status]}</Chip>
          </div>
          <div>
            <div className="text-lg">{c.label}</div>
            {c.hint && <div className="text-muted">{c.hint}</div>}
          </div>
        </li>
      ))}
    </ul>
  )
}

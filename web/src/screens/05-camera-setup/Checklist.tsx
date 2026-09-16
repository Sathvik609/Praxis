import { Chip } from '../../design/Chip'

export type Check = {
  id: string
  label: string
  status: 'pass' | 'check' | 'fail' | 'pending'
  hint: string | null
}

const tone = { pass: 'mint', check: 'amber', fail: 'red', pending: 'neutral' } as const
const word = { pass: 'Pass', check: 'Check', fail: 'Fail', pending: 'Waiting' } as const

export function Checklist({ checks }: { checks: Check[] }) {
  if (checks.length === 0) {
    return <p className="py-6 text-muted">Waiting for the first frames from the camera…</p>
  }
  return (
    <ul className="divide-y divide-line">
      {checks.map((c) => (
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

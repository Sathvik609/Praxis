import type { ReactNode } from 'react'

export function FlowBar({
  step,
  total = 6,
  label,
  left,
  right,
}: {
  step: number
  total?: number
  label: string
  left?: ReactNode
  right: ReactNode
}) {
  return (
    <footer className="flex h-20 items-center gap-4 border-t border-line bg-surface px-8">
      <div className="flex items-center gap-2">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-3 rounded-full ${i < step ? 'w-3 bg-mint' : i === step ? 'w-8 bg-teal' : 'w-3 bg-line'}`}
          />
        ))}
        <span className="ml-3 text-muted">{label}</span>
      </div>
      <div className="ml-auto flex gap-4">
        {left}
        {right}
      </div>
    </footer>
  )
}

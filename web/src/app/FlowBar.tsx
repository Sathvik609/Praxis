import type { ReactNode } from 'react'

export function FlowBar({
  step,
  total = 6,
  label,
  labelId,
  left,
  right,
}: {
  step: number
  total?: number
  label: string
  /** When set, the step label gets this id and becomes a polite live region (screens that
   *  change the label in place, e.g. check-in, point aria-describedby / announce through it). */
  labelId?: string
  left?: ReactNode
  right: ReactNode
}) {
  return (
    <footer className="ui-flowbar sticky bottom-0 z-10 flex h-20 shrink-0 items-center gap-4 border-t border-line bg-surface px-8">
      <div className="flex items-center gap-2">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-3 rounded-full ${i < step ? 'w-3 bg-mint' : i === step ? 'w-8 bg-teal' : 'w-3 bg-line'}`}
          />
        ))}
        <span id={labelId} aria-live={labelId ? 'polite' : undefined} className="ml-3 text-muted">
          {label}
        </span>
      </div>
      <div className="ml-auto flex gap-4">
        {left}
        {right}
      </div>
    </footer>
  )
}

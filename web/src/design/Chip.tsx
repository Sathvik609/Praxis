import type { ReactNode } from 'react'

const tones = {
  mint: 'bg-tint-mint text-mint-ink',
  amber: 'bg-tint-amber text-amber-ink',
  red: 'bg-tint-red text-red-ink',
  neutral: 'bg-line/60 text-muted',
  focus: 'bg-tint-focus text-focus',
}

export type ChipTone = keyof typeof tones

/** Status chip: tint background + AA ink (design/contrast.test.ts). Text always carries the
 *  meaning; the optional icon is decorative. `ui-chip ui-chip--<tone>` are the designer.css hooks.
 *  Unlike the designers' build, a "Sample…" chip is never `judge-only`: sample data is always labelled. */
export function Chip({ tone = 'neutral', icon, children, className = '' }: { tone?: ChipTone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={`ui-chip ui-chip--${tone} inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1 text-base font-bold ${tones[tone]} ${className}`}>
      {icon && <span aria-hidden className="inline-flex [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
      {children}
    </span>
  )
}

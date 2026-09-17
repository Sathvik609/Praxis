import type { ReactNode } from 'react'

export type Line = { from: 'coach' | 'you'; text: string }

/** The onboarding conversation column: what the coach said on the left, what the patient
 *  answered on the right. Both bubbles carry a visible speaker name, so the side of the column
 *  is never the only thing telling them apart. */
export function Bubble({ from, children }: { from: Line['from']; children: ReactNode }) {
  const coach = from === 'coach'
  return (
    <div className={`flex ${coach ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[85%] rounded-[var(--r-card)] px-5 py-4 ${coach ? 'border border-line border-l-8 border-l-teal-ink bg-tint-mint text-ink' : 'bg-teal-fill text-white'}`}>
        <div className={`text-base ${coach ? 'text-muted' : 'text-white/80'}`}>{coach ? 'Coach' : 'You'}</div>
        <p className="text-xl">{children}</p>
      </div>
    </div>
  )
}

export function Conversation({ lines, children }: { lines: Line[]; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      {lines.map((l, i) => (
        <Bubble key={`${i}-${l.text}`} from={l.from}>{l.text}</Bubble>
      ))}
      {children}
    </div>
  )
}

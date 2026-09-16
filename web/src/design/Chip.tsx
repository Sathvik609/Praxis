import type { ReactNode } from 'react'

const tones = {
  mint: 'bg-mint/15 text-teal',
  amber: 'bg-amber/15 text-amber',
  red: 'bg-red/15 text-red',
  neutral: 'bg-line text-muted',
  focus: 'bg-[#DDEBFF] text-[#1F4E9E]',
}

export type ChipTone = keyof typeof tones

export function Chip({ tone = 'neutral', children }: { tone?: ChipTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-lg px-3 py-1 text-base font-bold ${tones[tone]}`}>
      {children}
    </span>
  )
}

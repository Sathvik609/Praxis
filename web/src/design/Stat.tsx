import type { ReactNode } from 'react'

/** A number with its unit and label. Numbers never wrap or break across lines. */
export function Stat({ value, unit, label, size = 'md', tone = 'default', extra }: { value: ReactNode; unit?: string; label: string; size?: 'md' | 'lg' | 'xl'; tone?: 'default' | 'amber' | 'red'; extra?: ReactNode }) {
  const v = size === 'xl' ? 'text-6xl' : size === 'lg' ? 'text-4xl' : 'text-3xl'
  const t = tone === 'amber' ? 'text-amber-ink' : tone === 'red' ? 'text-red-ink' : ''
  return (
    <div className="min-w-0">
      <div className={`ui-stat-num whitespace-nowrap font-heading font-semibold tabular-nums ${v} ${t}`}>
        {value}
        {unit && <span className="ml-1 text-xl font-normal text-muted">{unit}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-base text-muted">
        <span>{label}</span>
        {extra}
      </div>
    </div>
  )
}

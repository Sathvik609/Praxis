import { useId } from 'react'
import { Check } from './Icon'

/** Custom checkbox in a 56 px row: keyboard-operable native input (visually hidden) with a
 *  drawn box, a check icon and the label text. */
export function Checkbox({ label, checked, onChange, description, className = '' }: { label: string; checked: boolean; onChange: (v: boolean) => void; description?: string; className?: string }) {
  const id = useId()
  return (
    <label htmlFor={id} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-[var(--r-control)] px-1 text-lg hover:bg-tint-mint ${className}`}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 border-teal-ink bg-surface text-white peer-checked:bg-teal-fill peer-focus-visible:ring-4 peer-focus-visible:ring-[var(--focus)]/40"
      >
        {checked && <Check className="h-5 w-5" strokeWidth={3} />}
      </span>
      <span>
        {label}
        {description && <span className="block text-base text-muted">{description}</span>}
      </span>
    </label>
  )
}

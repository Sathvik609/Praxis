import { useRef, type KeyboardEvent } from 'react'

type Props = {
  label: string
  value: number | null
  onChange: (v: number) => void
  min?: number
  max?: number
  leftAnchor: string
  rightAnchor: string
}

/** 0–10 scale as a radio group with one tab stop: roving tabindex, Left/Right/Home/End move
 *  and select. The chosen cell is filled, the rest outlined, so state is not colour-only.
 *  Cells shrink (`flex-1 min-w-0`) so eleven fit a 1280 px column without wrapping. */
export function NumberScale({ label, value, onChange, min = 0, max = 10, leftAnchor, rightAnchor }: Props) {
  const ns = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const focusIdx = value != null && value >= min && value <= max ? value - min : 0

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(ns.length - 1, i + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, i - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = ns.length - 1
    if (next == null) return
    e.preventDefault()
    onChange(ns[next])
    refs.current[next]?.focus()
  }

  return (
    <div>
      <div className="mb-2 font-bold">{label}</div>
      <div role="radiogroup" aria-label={label} className="flex gap-1.5">
        {ns.map((n, i) => (
          <button
            key={n}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={String(n)}
            tabIndex={i === focusIdx ? 0 : -1}
            onClick={() => onChange(n)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`min-h-14 min-w-0 flex-1 rounded-[var(--r-control)] border-2 px-0 text-lg font-bold tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--focus)]/40 active:translate-y-px ${
              value === n ? 'border-teal-fill bg-teal-fill text-white' : 'border-line bg-surface text-ink hover:bg-tint-mint'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-base text-muted">
        <span>{leftAnchor}</span>
        <span>{rightAnchor}</span>
      </div>
    </div>
  )
}

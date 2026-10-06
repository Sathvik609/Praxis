import * as ToggleGroup from '@radix-ui/react-toggle-group'

type Option<T extends string> = { value: T; label: string; disabled?: boolean }

/** Segmented control (one choice). Radix ToggleGroup gives roving focus and radio
 *  semantics; the selected item is filled, the others stay outlined so state is not colour-only. */
export function Pill<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  size = 'md',
  className = '',
}: {
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
  ariaLabel: string
  size?: 'md' | 'sm'
  className?: string
}) {
  const h = size === 'md' ? 'min-h-14' : 'min-h-12'
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={ariaLabel}
      className={`ui-seg inline-flex gap-1 rounded-[var(--r-pill)] border border-line bg-surface p-1 ${className}`}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          className={`ui-seg-btn ${h} whitespace-nowrap rounded-[var(--r-pill)] px-4 text-lg font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--focus)]/40 disabled:opacity-40 data-[state=on]:bg-teal-fill data-[state=on]:text-white data-[state=off]:text-ink data-[state=off]:hover:bg-tint-mint`}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

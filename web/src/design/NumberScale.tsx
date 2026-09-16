type Props = {
  label: string
  value: number | null
  onChange: (v: number) => void
  min?: number
  max?: number
  leftAnchor: string
  rightAnchor: string
}

export function NumberScale({ label, value, onChange, min = 0, max = 10, leftAnchor, rightAnchor }: Props) {
  const ns = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  return (
    <div>
      <div className="mb-2 font-bold">{label}</div>
      <div role="radiogroup" aria-label={label} className="flex gap-2">
        {ns.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={String(n)}
            onClick={() => onChange(n)}
            className={`h-14 flex-1 rounded-xl border-2 text-xl font-bold ${value === n ? 'border-teal bg-teal text-white' : 'border-line bg-surface'}`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-muted">
        <span>{leftAnchor}</span>
        <span>{rightAnchor}</span>
      </div>
    </div>
  )
}

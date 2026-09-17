import { useId } from 'react'

type Props = {
  values: (number | null)[]
  unit: string
  labels?: string[]
  verified?: boolean[]
  height?: number
  title: string
  target?: number
}

function ticks(max: number): number[] {
  if (max <= 0) return [0]
  const step = [0.5, 1, 2, 5, 10, 20, 50, 100].find((s) => max / s <= 4) ?? 100
  const top = Math.ceil(max / step - 1e-9) * step // axis always reaches the tallest bar / target
  const out: number[] = []
  for (let v = 0; v <= top + 1e-9; v += step) out.push(Math.round(v * 100) / 100)
  return out
}

/** Bar chart with a y-axis, value labels and a legend. Unverified bars are amber AND
 *  hatched so colour never carries the meaning alone. */
export function Bars({ values, unit, labels, verified, height = 160, title, target }: Props) {
  const id = useId().replace(/:/g, '')
  const nums = values.map((v) => v ?? 0)
  const max = Math.max(target ?? 0, ...nums, 1)
  const tk = ticks(max)
  const top = tk[tk.length - 1] || max
  const w = 320
  const padL = 40
  const padB = labels ? 26 : 10
  const plotH = height - padB - 8
  const n = Math.max(values.length, 1)
  const slot = (w - padL - 8) / n
  const bw = Math.min(28, slot * 0.6)
  const y = (v: number) => 8 + plotH - (v / top) * plotH
  const summary = `${title}: ${values.map((v, i) => `${labels?.[i] ?? i + 1} ${v == null ? 'missing' : `${v} ${unit}`}${verified && !verified[i] ? ' unverified' : ''}`).join(', ')}`
  const anyUnverified = verified?.some((v) => v === false)
  return (
    <figure className="min-w-0">
      <svg role="img" aria-label={summary} viewBox={`0 0 ${w} ${height}`} className="h-auto w-full">
        <defs>
          <pattern id={`hatch-${id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--amber)" opacity="0.35" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--amber-ink)" strokeWidth="2" />
          </pattern>
        </defs>
        {tk.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - 4} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{t}</text>
          </g>
        ))}
        {target != null && <line x1={padL} x2={w - 4} y1={y(target)} y2={y(target)} stroke="var(--amber-ink)" strokeWidth="1.5" strokeDasharray="4 3" />}
        {values.map((v, i) => {
          const cx = padL + slot * i + slot / 2
          if (v == null) return <text key={i} x={cx} y={y(0) - 4} textAnchor="middle" fontSize="11" fill="var(--muted)">—</text>
          const ok = verified ? verified[i] !== false : true
          return (
            <g key={i}>
              <rect x={cx - bw / 2} y={y(v)} width={bw} height={Math.max(1, y(0) - y(v))} rx="3" fill={ok ? 'var(--teal)' : `url(#hatch-${id})`} stroke={ok ? 'none' : 'var(--amber-ink)'} strokeWidth={ok ? 0 : 1} />
              <text x={cx} y={y(v) - 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text)">{v}</text>
              {labels && <text x={cx} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{labels[i]}</text>}
            </g>
          )
        })}
        <text x={4} y={12} fontSize="10" fill="var(--muted)">{unit}</text>
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-4 text-base text-muted">
        <span className="inline-flex items-center gap-1"><span aria-hidden className="inline-block h-3 w-3 rounded-sm bg-teal" /> verified</span>
        {anyUnverified && <span className="inline-flex items-center gap-1"><span aria-hidden className="inline-block h-3 w-3 rounded-sm border border-amber-ink bg-[repeating-linear-gradient(45deg,var(--amber-ink)_0_1px,transparent_1px_4px)]" /> unverified (hatched)</span>}
        {target != null && <span>dashed = target {target} {unit}</span>}
      </figcaption>
    </figure>
  )
}

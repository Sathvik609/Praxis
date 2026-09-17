type Point = { x: string; y: number }

/** Line chart with axis, gridlines, value labels at each point and an optional dashed
 *  target. Strokes come from CSS variables so dark mode works. */
export function Line({ points, unit, title, target, height = 160, lowerIsBetter = true }: { points: Point[]; unit: string; title: string; target?: number; height?: number; lowerIsBetter?: boolean }) {
  const w = 320
  const padL = 40
  const padB = 24
  const plotH = height - padB - 12
  const ys = points.map((p) => p.y)
  const max = Math.max(target ?? 0, ...ys, 1)
  const min = 0
  const y = (v: number) => 12 + plotH - ((v - min) / (max - min)) * plotH
  const x = (i: number) => padL + (points.length > 1 ? ((w - padL - 12) * i) / (points.length - 1) : (w - padL) / 2)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.y)}`).join(' ')
  const tk = [0, max / 2, max].map((v) => Math.round(v * 10) / 10)
  const summary = `${title}: ${points.map((p) => `${p.x} ${p.y} ${unit}`).join(', ')}${target != null ? `, target ${target} ${unit}` : ''}`
  const trend = points.length >= 2 ? points[points.length - 1].y - points[0].y : 0
  return (
    <figure className="min-w-0">
      <svg role="img" aria-label={summary} viewBox={`0 0 ${w} ${height}`} className="h-auto w-full">
        {tk.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - 8} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{t}</text>
          </g>
        ))}
        {target != null && <line x1={padL} x2={w - 8} y1={y(target)} y2={y(target)} stroke="var(--amber-ink)" strokeWidth="1.5" strokeDasharray="4 3" />}
        <path d={d} fill="none" stroke="var(--teal)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.y)} r="4.5" fill="var(--surface)" stroke="var(--teal)" strokeWidth="2.5" />
            <text x={x(i)} y={y(p.y) - 9} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text)">{p.y}</text>
            <text x={x(i)} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">{p.x}</text>
          </g>
        ))}
        <text x={padL - 6} y={height - 2} textAnchor="end" fontSize="10" fill="var(--muted)">{unit}</text>
      </svg>
      <figcaption className="mt-1 text-base text-muted">
        {points.length >= 2 ? `${Math.abs(trend).toFixed(1)} ${unit} ${(lowerIsBetter ? trend < 0 : trend > 0) ? 'better' : 'worse'} than the first point` : 'one measurement so far'}
        {target != null ? ` · dashed = target ${target} ${unit}` : ''}
      </figcaption>
    </figure>
  )
}

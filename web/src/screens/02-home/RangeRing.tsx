/** 270° range ring: the best verified lift against the prescription's limit (designers' `AdViz`
 *  arc, 6 Oct). A camera-relative angle, not goniometry. */
export function RangeRing({ now, max }: { now: number; max: number }) {
  const R = 40
  const C = 2 * Math.PI * R
  const span = 0.75 * C
  const p = Math.max(0, Math.min(1, now / max))
  return (
    <svg className="ad-viz ad-viz-ring" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${now} of ${max} degrees`}>
      <circle cx={50} cy={50} r={R - 6} className="ad-ring-fill" />
      <circle cx={50} cy={50} r={R} className="ad-ring-track" style={{ strokeDasharray: `${span} ${C}` }} transform="rotate(135 50 50)" />
      <circle cx={50} cy={50} r={R} className="ad-ring-val" style={{ strokeDasharray: `${span * p} ${C}` }} transform="rotate(135 50 50)" />
      <text x={50} y={52} textAnchor="middle" className="ad-ring-v">
        {String(now)}
        <tspan className="ad-ring-u" dy={-5}>°</tspan>
      </text>
      <text x={50} y={63} textAnchor="middle" className="ad-ring-s">{`of ${max}°`}</text>
    </svg>
  )
}

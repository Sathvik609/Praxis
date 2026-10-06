import { dayMonth, type AreaView } from '../../lib/areaSummary'
import { fmtV, trendDelta } from '../../lib/trend'

const W = 300
const H = 100
const PL = 6
const PR = 6
const PT = 10
const PB = 8

/** Line + points + optional limit line, first and last date, and the live-only delta chip
 *  (designers' `TrendChart`, 6 Oct). Sample points are named in the chart's label. */
export function TrendChart({ t }: { t: NonNullable<AreaView['trend']> }) {
  const unit = t.better === 'up' ? '°' : ' s'
  const n = t.points.length
  const vals = [...t.points.map((p) => p.value), ...(t.ref !== undefined ? [t.ref] : [])]
  const span = Math.max(...vals) - Math.min(...vals)
  const pad = Math.max(span * 0.15, t.better === 'up' ? 4 : 2)
  const lo = Math.min(...vals) - pad
  const hi = Math.max(...vals) + pad
  const x = (i: number) => (n < 2 ? W / 2 : PL + (i * (W - PL - PR)) / (n - 1))
  const y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB)
  const pts = t.points.map((p, i) => [x(i), y(p.value)] as const)
  const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' ')
  const dl = trendDelta(t.points, t.better)
  const firstLive = t.points.find((p) => !p.sample)
  const refLabel = t.ref !== undefined ? `${t.ref}° limit` : null
  const aria = `${t.label}: ${t.points.map((p) => `${dayMonth(p.date)} ${fmtV(p.value)}${unit}${p.sample ? ' (sample)' : ''}`).join(', ')}${refLabel ? `; ${refLabel}` : ''}`
  return (
    <figure className="ad-trend">
      <figcaption className="ad-trend-l">{t.label}</figcaption>
      <div className="ad-plot" role="img" aria-label={aria}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
          <path d={`${d} L ${pts[n - 1][0]} ${H} L ${pts[0][0]} ${H} Z`} className="ad-tr-area" />
          {t.ref !== undefined && <line x1={0} x2={W} y1={y(t.ref)} y2={y(t.ref)} className="ad-tr-ref" />}
          <path d={d} className="ad-tr-line" />
        </svg>
        {pts.map((q, i) => (
          <i key={i} className={`ad-tr-pt ${i === n - 1 ? 'ad-tr-last' : ''}`} style={{ left: `${(q[0] / W) * 100}%`, top: `${(q[1] / H) * 100}%` }} />
        ))}
        {t.ref !== undefined && (
          <span className="ad-tr-reft" style={{ top: `${(y(t.ref) / H) * 100}%` }}>
            {refLabel}
          </span>
        )}
      </div>
      <div className="ad-tr-foot">
        <span>{dayMonth(t.points[0].date)}</span>
        <span>{dayMonth(t.points[n - 1].date)}</span>
      </div>
      <div className="ad-tr-cap">
        {dl ? (
          <b className={`ad-chip ${dl.tone === 'good' ? 'ad-chip-good' : dl.tone === 'bad' ? 'ad-chip-watch' : ''}`}>{`${dl.text} since ${firstLive ? dayMonth(firstLive.date) : ''}`}</b>
        ) : (
          <b className="ad-chip">Not enough sessions to compare yet.</b>
        )}
        {t.caption && <em>{t.caption}</em>}
      </div>
    </figure>
  )
}

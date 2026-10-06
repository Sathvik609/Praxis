/** Trend helpers for Home's affected-areas card (design v2, 6 Oct; designers' `fmtV` /
 *  `trendDelta`). A delta compares live points only: sample history is drawn and labelled,
 *  never mixed into "faster" or "higher". Colour follows the better direction, never
 *  "down = bad". */

export type TrendPoint = { date: string; value: number; sample: boolean }
export type Better = 'up' | 'down'
export type TrendDelta = { text: string; tone: 'good' | 'bad' | 'flat' }

/** 88 → "88", 41.25 → "41.3". */
export const fmtV = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1))

/** First → last live point. Lower-is-better trends are times ("3.8 s faster"); higher-is-better
 *  trends are angles ("12° higher"). Null when fewer than two live points exist. */
export function trendDelta(points: TrendPoint[], better: Better): TrendDelta | null {
  const live = points.filter((p) => !p.sample)
  if (live.length < 2) return null
  const d = live[live.length - 1].value - live[0].value
  if (Math.abs(d) < 0.05) return { text: 'No change', tone: 'flat' }
  const mag = fmtV(Math.round(Math.abs(d) * 10) / 10)
  const good = better === 'down' ? d < 0 : d > 0
  const text = better === 'down' ? `${mag} s ${d < 0 ? 'faster' : 'slower'}` : `${mag}° ${d > 0 ? 'higher' : 'lower'}`
  return { text, tone: good ? 'good' : 'bad' }
}

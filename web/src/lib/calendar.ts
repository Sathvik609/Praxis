/** Screen 12 · Calendar helpers (Figma `12_calendar`, 28 Sep 2026). Dates are ISO
 *  `YYYY-MM-DD` strings throughout and all arithmetic is done in UTC, so the browser's time
 *  zone never shifts a day. "Today" is the service's (`/api/calendar` → `today`), never the
 *  browser clock. */
import type { CalendarDay } from './api'

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)

export function addDays(day: string, n: number): string {
  const d = utc(day)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}

/** 0 = Monday … 6 = Sunday (the service's weekday numbering). */
export const weekday = (day: string): number => (utc(day).getUTCDay() + 6) % 7

export const mondayOf = (day: string): string => addDays(day, -weekday(day))

export type View = 'week' | 'month'
export type Range = { from: string; to: string }

/** Week view (as the Figma frame): last week and this week, Monday to Sunday. */
export function weekRange(anchor: string): Range {
  const mon = mondayOf(anchor)
  return { from: addDays(mon, -7), to: addDays(mon, 6) }
}

/** Month view: whole weeks from the Monday on or before the 1st to the Sunday on or after
 *  the last day (5 or 6 rows). */
export function monthRange(anchor: string): Range {
  const d = utc(anchor)
  const first = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)))
  const last = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))
  return { from: mondayOf(first), to: addDays(mondayOf(last), 6) }
}

export const rangeFor = (view: View, anchor: string): Range => (view === 'week' ? weekRange(anchor) : monthRange(anchor))

/** One step of ‹ ›: a week in week view, a month in month view (kept on the 1st so short
 *  months never skip). */
export function shift(view: View, anchor: string, dir: -1 | 1): string {
  if (view === 'week') return addDays(anchor, 7 * dir)
  const d = utc(anchor)
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1)))
}

/** "8 – 21 Sep 2026", "28 Sep – 11 Oct 2026", "29 Dec 2025 – 11 Jan 2026". */
export function rangeLabel({ from, to }: Range): string {
  const a = utc(from)
  const b = utc(to)
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear()
  const sameMonth = sameYear && a.getUTCMonth() === b.getUTCMonth()
  const end = `${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`
  if (sameMonth) return `${a.getUTCDate()} – ${end}`
  return `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}${sameYear ? '' : ` ${a.getUTCFullYear()}`} – ${end}`
}

export const monthLabel = (anchor: string): string => `${MONTHS_LONG[utc(anchor).getUTCMonth()]} ${utc(anchor).getUTCFullYear()}`

/** "Mon 28 Sep" */
export function shortDate(day: string): string {
  const d = utc(day)
  return `${WEEKDAYS[weekday(day)]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** "Monday 28 September" for screen readers. */
export function longDate(day: string): string {
  const d = utc(day)
  return `${WEEKDAYS_LONG[weekday(day)]} ${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]}`
}

export const sameMonth = (a: string, b: string): boolean => a.slice(0, 7) === b.slice(0, 7)

/** "Fri 2 Oct, 2:30 PM" from a local ISO date-time ("2026-10-02T14:30"): the same label the
 *  service derives for `patient.program.next_visit` (`prescription.visit_text`). */
export function visitText(at: string): string {
  const [day, time = '00:00'] = at.split('T')
  const [h, m] = time.split(':').map(Number)
  return `${shortDate(day)}, ${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** "Mon–Fri", "Mon, Wed, Fri", "Every day". */
export function daysLabel(days: number[]): string {
  const s = [...days].sort((a, b) => a - b)
  if (s.length === 7) return 'Every day'
  const run = s.length > 2 && s.every((d, i) => i === 0 || d === s[i - 1] + 1)
  return run ? `${WEEKDAYS[s[0]]}–${WEEKDAYS[s[s.length - 1]]}` : s.map((d) => WEEKDAYS[d]).join(', ')
}

const unique = (xs: string[]) => [...new Set(xs)]

/** What a day card says, line by line. The words carry the status; colour only repeats it.
 *  `compact` is the month grid (one short line per fact). */
export function dayLines(day: CalendarDay, compact = false): string[] {
  const lines: string[] = []
  const live = day.sessions.filter((s) => s.source === 'live')
  const shown = day.status === 'done' ? live : day.sessions
  const practice = shown.filter((s) => s.mode !== 'nhpt')
  const pegs = shown.filter((s) => s.mode === 'nhpt')
  const mins = practice.reduce((n, s) => n + s.minutes, 0)
  const names = unique(practice.map((s) => s.name ?? s.title ?? 'Session')).join(' + ')
  const peg = pegs.map((s) => (s.nhpt_total_s != null ? `Peg test ${s.nhpt_total_s.toFixed(1)} s` : 'Peg test')).join(' · ')
  const plan = day.exercises.filter((e) => e.id !== 'nhpt').map((e) => e.name).join(' + ')

  if (day.sample && day.status !== 'today') {
    // Illustrative seed history (on any past day, rest days too): listed with its words and
    // labelled, never counted as done.
    lines.push('Sample')
    if (!compact) {
      if (practice.length) lines.push(`${names} · ${mins} min`)
      if (pegs.length) lines.push(peg)
    }
  } else if (day.status === 'done') {
    if (compact) lines.push('Done ✓')
    else {
      if (practice.length) lines.push(`${names} ✓ · ${mins} min`)
      if (pegs.length) lines.push(`${peg} ✓`)
    }
  } else if (day.status === 'today') {
    if (compact) lines.push('Today')
    else if (day.planned) lines.push(`Today · ${plan} · ${day.minutes} min`)
    else lines.push(day.nhpt_due ? 'Today' : 'Today · Rest')
    if (day.nhpt_due) lines.push('Peg test (weekly)')
  } else if (day.status === 'planned') {
    if (day.planned) lines.push(compact ? 'Planned' : `Planned · ${day.minutes} min`)
    if (day.nhpt_due) lines.push(compact ? 'Peg test' : 'Peg test (weekly)')
  } else if (day.status === 'missed') {
    if (day.planned) lines.push(compact ? 'Not done' : 'Planned · not done')
    if (day.nhpt_due) lines.push(compact ? 'Peg test · not done' : 'Peg test · not done')
  } else if (day.status === 'rest') {
    lines.push('Rest')
  } else {
    lines.push(compact ? 'Not tracked' : 'Not tracked yet')
  }
  if (day.clinic_visit) lines.push(compact ? `Clinic ${day.clinic_visit.time}` : `Clinic · ${day.clinic_visit.with_short} ${day.clinic_visit.time}`)
  return lines
}

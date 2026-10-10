import { useEffect, useState } from 'react'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Chip } from '../../design/Chip'
import { Check, ChevronLeft, ChevronRight } from '../../design/Icon'
import { Pill } from '../../design/Pill'
import { api, type Calendar as CalendarData, type CalendarDay } from '../../lib/api'
import { WEEKDAYS, dayLines, longDate, mondayOf, monthLabel, rangeFor, rangeLabel, sameMonth, shift, shortDate, type View } from '../../lib/calendar'
import { plural } from '../../lib/plural'
import { exerciseById } from '../../lib/seed'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Card look per status (design v2, `cal-*` in designer.css). The words on the card (`dayLines`),
 *  the tick plus "done" on done days and the legend carry the meaning; the colour repeats it
 *  (WCAG 1.4.1). */
function tone(day: CalendarDay): string {
  if (day.is_today && day.status !== 'done') return 'cal-day cal-today'
  if (day.status === 'done') return `cal-day cal-done${day.is_today ? ' cal-is-today' : ''}`
  if (day.clinic_visit) return 'cal-day cal-clinic'
  if (day.sample) return 'cal-day cal-sample'
  if (day.status === 'missed') return 'cal-day cal-missed'
  if (day.status === 'planned') return 'cal-day cal-planned'
  if (day.status === 'untracked') return 'cal-day cal-untracked'
  return 'cal-day cal-rest'
}

const LEGEND: { label: string; box: string }[] = [
  { label: 'Done', box: 'cal-key cal-done' },
  { label: 'Today', box: 'cal-key cal-today' },
  { label: 'Planned', box: 'cal-key cal-planned' },
  { label: 'Planned, not done', box: 'cal-key cal-missed' },
  { label: 'Clinic visit', box: 'cal-key cal-clinic' },
  { label: 'Rest', box: 'cal-key cal-rest' },
  { label: 'Sample (not yours)', box: 'cal-key cal-sample' },
  { label: 'Not tracked yet', box: 'cal-key cal-untracked' },
]

function dateLabel(day: CalendarDay, view: View, anchor: string): string {
  const [, m, d] = day.date.split('-').map(Number)
  const withMonth = view === 'month' ? !sameMonth(day.date, anchor) : d === 1
  return withMonth ? `${d} ${MONTHS[m - 1]}` : String(d)
}

function DayCard({ day, view, anchor }: { day: CalendarDay; view: View; anchor: string }) {
  const compact = view === 'month'
  const lines = dayLines(day, compact)
  return (
    <li
      data-testid={`day-${day.date}`}
      aria-current={day.is_today ? 'date' : undefined}
      className={`flex min-w-0 flex-col gap-1 ${compact ? 'min-h-24' : 'min-h-36'} ${tone(day)}`}
    >
      <span className="cal-num">
        <span aria-hidden>{dateLabel(day, view, anchor)}</span>
        {day.status === 'done' && (
          <>
            <span className="cal-tick" aria-hidden>
              <Check strokeWidth={3} />
            </span>
            <span className="sr-only">done</span>
          </>
        )}
        <span className="sr-only">{longDate(day.date)}</span>
      </span>
      {lines.map((l, i) =>
        l === 'Sample' ? (
          <Chip key={i} tone="neutral" className="self-start">Sample</Chip>
        ) : (
          <span key={i} className={`cal-line ${/^Clinic/.test(l) ? 'cal-line-clinic' : ''}`}>{l}</span>
        ),
      )}
    </li>
  )
}

/** Screen 12 · Calendar (Figma v1.2 `12_calendar`, 28 Sep 2026). Practice days come from the
 *  prescription (the therapist sets them); a day is done only when a live camera session
 *  happened. Replays never count; sample history is labelled Sample. "Today" is the service's
 *  clock, never the browser's. Out of scope by decision: reminders, moving a day, logging
 *  practice without the camera. Design v2 (6 Oct): one-column grid with the side cards in a row
 *  below (`cal-layout`), no week card, and no "Start session" on the today card (the flow starts
 *  from Choose → Demonstration, D-FLOW). */
export function Calendar() {
  const [view, setView] = useState<View>('week')
  const [today, setToday] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<string | null>(null)
  // The loaded range with the view and anchor it was asked for, so the grid, its label and
  // the cards always agree while the next range loads.
  const [loaded, setLoaded] = useState<{ data: CalendarData; view: View; anchor: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .calendar()
      .then((c) => {
        if (!alive) return
        setToday(c.today)
        setAnchor((a) => a ?? c.today)
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!anchor) return
    let alive = true
    api
      .calendar(rangeFor(view, anchor))
      .then((c) => alive && setLoaded({ data: c, view, anchor }))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [view, anchor])

  if (error && !loaded) return <p className="p-8 text-xl text-red-ink" role="alert">Could not load your calendar: {error}. Is the session service running?</p>
  if (!loaded || !anchor || !today) return <p className="p-8 text-xl text-muted" role="status">Loading your calendar…</p>

  const { data } = loaded
  const label = loaded.view === 'week' ? rangeLabel(data) : monthLabel(loaded.anchor)
  const atToday = view === 'week' ? mondayOf(anchor) === mondayOf(today) : sameMonth(anchor, today)
  const n = data.schedule.practice_days.length
  const unit = view === 'week' ? 'week' : 'month'
  const busy = loaded.view !== view || loaded.anchor !== anchor
  const pickView = (v: View) => {
    setView(v)
    setAnchor(today)
  }

  return (
    <div className="p-8">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-4xl">Calendar</h1>
          <p className="mt-1 text-lg text-muted">Your program asks for {n} practice {plural(n, 'day')} a week. Rest days are part of the plan.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Pill ariaLabel="Calendar view" value={view} onChange={pickView} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
          <Button variant="secondary" aria-label={`Previous ${unit}`} className="w-14 px-0" icon={<ChevronLeft />} onClick={() => setAnchor(shift(view, anchor, -1))} />
          <span aria-live="polite" className="flex min-h-14 items-center whitespace-nowrap rounded-[var(--r-pill)] border-2 border-line bg-surface px-5 text-lg font-bold tabular-nums">{label}</span>
          <Button variant="secondary" aria-label={`Next ${unit}`} className="w-14 px-0" icon={<ChevronRight />} onClick={() => setAnchor(shift(view, anchor, 1))} />
          {!atToday && <Button variant="link" className="min-h-14" onClick={() => setAnchor(today)}>Back to today</Button>}
        </div>
      </div>

      <div data-testid="calendar-layout" className="cal-layout mt-6 grid grid-cols-[minmax(0,1fr)_minmax(300px,360px)] items-start gap-6">
        <section aria-label="Practice days" className="min-w-0">
          <div aria-hidden className="cal-week grid grid-cols-[repeat(7,minmax(0,1fr))] gap-2 pb-2 text-center text-lg text-muted">
            {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
          </div>
          <ol aria-label="Days" aria-busy={busy} className="cal-week grid grid-cols-[repeat(7,minmax(0,1fr))] gap-2">
            {data.days.map((d) => <DayCard key={d.date} day={d} view={loaded.view} anchor={loaded.anchor} />)}
          </ol>
          <ul aria-label="Legend" className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-base text-muted">
            {LEGEND.map((l) => (
              <li key={l.label} className="flex items-center gap-2">
                <span aria-hidden className={l.box} />
                {l.label}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-base text-muted">
            A day is done only when the camera saw you practise. Replays of recorded sessions never count
            {data.tracking_since ? '.' : ', and days before your first camera session are not tracked.'}
          </p>
        </section>

        <aside className="flex min-w-0 flex-col gap-4">
          <TodayCard day={data.days.find((d) => d.is_today) ?? null} today={today} />
          <VisitCard data={data} />
        </aside>
      </div>
    </div>
  )
}

function TodayCard({ day, today }: { day: CalendarDay | null; today: string }) {
  const plan = day?.exercises.filter((e) => e.id !== 'nhpt') ?? []
  const peg = !!day?.nhpt_due
  const title = plan.length ? plan.map((e) => e.name).join(' + ') : peg ? 'Nine-Hole Peg Test' : 'Rest day'
  const kit = [...plan, ...(peg ? [{ id: 'nhpt', name: '' }] : [])].map((e) => exerciseById(e.id)?.equipment).filter(Boolean)
  const done = day?.sessions.filter((s) => s.source === 'live') ?? []
  return (
    <Card tone="brand" as="section" aria-label="Today" className="p-6">
      <div className="text-white/80">Today · {shortDate(today)}</div>
      <h2 className="mt-1 text-3xl text-white">{title}</h2>
      <p className="mt-1 text-white/85">
        {plan.length ? `About ${day?.minutes ?? 10} min · ${kit.join(' · ')}` : peg ? `Weekly assessment · ${kit.join(' · ')}` : 'Rest days are part of the plan.'}
      </p>
      {plan.length > 0 && peg && <p className="text-white/85">Peg test (weekly) today too.</p>}
      {done.length > 0 && <p className="mt-2 font-bold text-white">Done today ✓ · {day?.minutes_done ?? 0} min with the camera</p>}
    </Card>
  )
}

function VisitCard({ data }: { data: CalendarData }) {
  const v = data.next_visit
  const upcoming = v && v.upcoming
  return (
    <Card as="section" aria-label="Clinic visit" padding="sm" className="py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl">Clinic visit</h2>
        {upcoming && (v.sample ? <Chip tone="neutral">Sample</Chip> : <Chip tone="amber">Bring your report</Chip>)}
      </div>
      {upcoming ? (
        <>
          <p className="mt-2 text-lg font-bold">{v.text}</p>
          <p className="text-lg text-muted">With {v.with}. {v.sample ? 'Sample date · your therapist books the real visit.' : 'Set by your therapist.'}</p>
        </>
      ) : (
        <p className="mt-2 text-lg text-muted">Not booked yet · your therapist sets it.</p>
      )}
    </Card>
  )
}

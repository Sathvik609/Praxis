import { sessionSource, type Calendar, type PlanItem, type PlanView, type Prescription, type SessionRecord } from '../../lib/api'
import { WEEKDAYS_LONG } from '../../lib/calendar'
import type { Day } from '../../lib/day'
import { exerciseOfSession } from '../../lib/seed'

/** The library coach (designers' `LibCoach`, 6 Oct) made honest: a rule in code, labelled
 *  "Rule-based coach · LLM agent pending". It only picks from today's plan as the service
 *  computed it (`GET /api/plan`), the day on this device (`lib/day.ts`) and the calendar's
 *  peg-test day. Every `why` part is a stored value; a part with no data is left out. */
export type CoachId = 'abduction' | 'cup' | 'nhpt'
export type Suggestion = { id: CoachId; why: string[] }
export type SuggestCtx = { plan: PlanView; day: Day; calendar: Calendar | null; skip: string[]; rx?: Prescription | null; sessions?: SessionRecord[] | null }

const IDS: CoachId[] = ['abduction', 'cup', 'nhpt']
const isCoachId = (id: string): id is CoachId => (IDS as string[]).includes(id)

/** Today's not-done exercises in plan order, then the peg test when the calendar says it is
 *  due today. Empty on a stopped or rest day. */
export function pending(ctx: Omit<SuggestCtx, 'skip'>): PlanItem[] {
  const { plan, day, calendar } = ctx
  if (day.stopped || plan.tier === 'rest') return []
  const order = [...plan.items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const today = calendar?.days.find((d) => d.is_today || d.date === calendar.today)
  const weekly = today?.nhpt_due ? plan.weekly : []
  return [...order, ...weekly].filter((it) => isCoachId(it.id) && !day.done.includes(it.id))
}

export function nextSuggestion(ctx: SuggestCtx): Suggestion | null {
  const it = pending(ctx).find((x) => !ctx.skip.includes(x.id))
  return it ? { id: it.id as CoachId, why: whyFor(it.id as CoachId, ctx) } : null
}

/** "Less time today": the pending item with the fewest movements (sets × reps from the plan). */
export function shortestPending(ctx: SuggestCtx): CoachId | null {
  const items = pending(ctx)
  if (!items.length) return null
  return items.reduce((a, b) => (b.sets * b.reps < a.sets * a.reps ? b : a)).id as CoachId
}

export type Route = 'hurt' | 'tired' | 'time' | 'explain' | 'another' | 'other'

/** Keyword routing for free text and quick replies; pain words always win. */
export function routeText(text: string): Route {
  const t = text.toLowerCase()
  if (/\b(hurt\w*|pain\w*|sore\w*|worse)\b/.test(t)) return 'hurt'
  if (/\b(tired|exhaust\w*|fatigue\w*)\b/.test(t)) return 'tired'
  if (/\b(time|quick\w*|short\w*|minutes?)\b/.test(t)) return 'time'
  if (/\b(explain\w*|how|what is|what's)\b/.test(t)) return 'explain'
  if (/\b(another|else|other|more)\b/.test(t)) return 'another'
  return 'other'
}

const live = (sessions: SessionRecord[] | null | undefined, id: CoachId) =>
  (sessions ?? []).filter((s) => sessionSource(s) === 'live' && exerciseOfSession(s)?.id === id).sort((a, b) => b.started_at.localeCompare(a.started_at))

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

function verifiedOnly(values: number[] | undefined, ok: boolean[] | undefined): number[] {
  return (values ?? []).filter((v, i) => typeof v === 'number' && (ok ? ok[i] === true : true))
}

export function whyFor(id: CoachId, ctx: Omit<SuggestCtx, 'skip'>): string[] {
  const { rx, day, plan, calendar, sessions } = ctx
  const out: string[] = []
  if (rx) out.push(`Assigned in v${rx.version}`)
  if (day.checkin) out.push(`pain ${day.checkin.pain}/10 today`)
  if (plan.tier === 'gentle') out.push('gentle dose')
  if (id === 'cup') {
    const [last, prev] = live(sessions, 'cup').map((s) => mean(verifiedOnly(s.summary.camera.reach_ms, s.summary.camera.reach_verified)))
    if (last != null && prev != null && prev > 0) {
      const pct = Math.round(((last - prev) / prev) * 100)
      out.push(pct === 0 ? 'reach time unchanged last session' : `reach time ${pct < 0 ? '−' : '+'}${Math.abs(pct)}% last session`)
    } else if (last != null) out.push(`reach time ${(last / 1000).toFixed(1)} s last session`)
  }
  if (id === 'abduction') {
    const last = live(sessions, 'abduction')[0]
    const peaks = verifiedOnly(last?.summary.camera.peak_deg, last?.summary.camera.peak_verified)
    const ceiling = Number(rx?.exercises.abduction?.ceiling_deg ?? plan.items.find((x) => x.id === 'abduction')?.ceiling_deg)
    if (peaks.length && Number.isFinite(ceiling)) out.push(`shoulder at ${Math.round(Math.max(...peaks))}° of ${Math.round(ceiling)}°`)
  }
  if (id === 'nhpt') {
    const today = calendar?.days.find((d) => d.is_today || d.date === calendar.today)
    const nhptDay = calendar?.schedule.nhpt_day ?? rx?.schedule?.nhpt_day
    if (today?.nhpt_due) out.push('weekly test due today')
    else if (nhptDay != null && WEEKDAYS_LONG[nhptDay]) out.push(`weekly test due ${WEEKDAYS_LONG[nhptDay]}`)
    const total = live(sessions, 'nhpt').map((s) => s.summary.camera.nhpt_total_s).find((v): v is number => typeof v === 'number')
    if (total != null) out.push(`last time ${total.toFixed(1)} s`)
  }
  return out
}

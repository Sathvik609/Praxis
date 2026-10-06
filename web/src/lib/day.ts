/** The exercise day (locked 28 Sep 2026): one check-in per day, then the default day in order
 *  (Arm out to the side → Waiter – cup), each exercise straight from its report to the next
 *  exercise's camera setup. The Nine-Hole Peg Test is weekly and
 *  never takes a day slot.
 *
 *  Everything here lives in the browser (`localStorage`, keyed by the local date, wrapped in
 *  try/catch). The service is the authority for the tier and the therapist flag: the check-in
 *  is posted to `POST /api/checkin`; when that fails the check-in is kept on this device with
 *  `synced: false`, tiered locally from `plan.ts`, **never** reported as told to the therapist,
 *  and posted again by `syncCheckin()` on the next load. */
import { api, type CheckinResult } from './api'
import { DAY_ORDER, WEEKLY, tierFor, type Tier } from './plan'
import { exerciseById, isHiddenExercise, type Exercise, type ExerciseId } from './seed'

export type Side = 'left' | 'right'
export type StopReason = 'rest' | 'new_symptoms' | 'session'

/** What screen 03 collects. `pain` 0–10, self-reported; feeling is never read from the face. */
export type CheckinAnswers = { pain: number; location: string; energy: string; minutes: number; new_symptoms: boolean }

export type DayCheckin = CheckinAnswers & {
  side: Side
  tier: Tier
  /** True only when the service said it wrote a therapist flag. */
  flagged: boolean
  reasons: string[]
  /** False while the service has not received this check-in. */
  synced: boolean
  at: string
}

export type Day = {
  date: string
  checkin: DayCheckin | null
  done: ExerciseId[]
  demosSeen: ExerciseId[]
  /** The exercise whose session was started last and has no report yet. */
  current: ExerciseId | null
  /** Reports that belong to today's run (so an old report opened from history is not). */
  finished: { exercise: ExerciseId; reportId: string }[]
  stopped: StopReason | null
}

const DAY_KEY = 'praxis.day'
const SIDE_KEY = 'praxis.side'
/** The key the live session (`session/useSessionFlow.ts`) and older screens read. */
const LEGACY_CHECKIN_KEY = 'praxis.checkin'
const POST_TIMEOUT_MS = 6000

/** Local calendar date, YYYY-MM-DD. */
export function todayKey(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

function fresh(): Day {
  return { date: todayKey(), checkin: null, done: [], demosSeen: [], current: null, finished: [], stopped: null }
}

export function readDay(): Day {
  try {
    const raw = localStorage.getItem(DAY_KEY)
    if (!raw) return fresh()
    const d = JSON.parse(raw) as Partial<Day>
    if (!d || d.date !== todayKey()) return fresh()
    // A day stored before the 28 Sep lock may name a now-hidden exercise: drop it.
    const shown = (ids: ExerciseId[] | undefined) => (ids ?? []).filter((id) => !isHiddenExercise(id))
    return {
      ...fresh(),
      ...d,
      done: shown(d.done),
      demosSeen: shown(d.demosSeen),
      current: d.current && !isHiddenExercise(d.current) ? d.current : null,
      finished: (d.finished ?? []).filter((f) => !isHiddenExercise(f.exercise)),
    }
  } catch {
    return fresh()
  }
}

export function writeDay(d: Day): void {
  try {
    localStorage.setItem(DAY_KEY, JSON.stringify(d))
  } catch {
    /* private mode: the day lives for this page only */
  }
  if (d.checkin) mirrorLegacy(d.checkin)
}

function update(fn: (d: Day) => Day): Day {
  const next = fn(readDay())
  writeDay(next)
  return next
}

/** Keep `sessionStorage['praxis.checkin']` in step so the live session forwards today's pain
 *  and symptoms to the service (`useSessionFlow`), even in a new tab. */
function mirrorLegacy(c: DayCheckin): void {
  try {
    sessionStorage.setItem(LEGACY_CHECKIN_KEY, JSON.stringify({ pain: c.pain, location: c.location, energy: c.energy, minutes: c.minutes, new_symptoms: c.new_symptoms }))
  } catch {
    /* private mode */
  }
}

/** Today's check-in, or null. Also refreshes the legacy session key. */
export function todayCheckin(): DayCheckin | null {
  const c = readDay().checkin
  if (c) mirrorLegacy(c)
  return c
}

// ---- practising side --------------------------------------------------------------------

export function readSide(): Side | null {
  try {
    const v = localStorage.getItem(SIDE_KEY)
    return v === 'left' || v === 'right' ? v : null
  } catch {
    return null
  }
}

export function writeSide(side: Side): void {
  try {
    localStorage.setItem(SIDE_KEY, side)
  } catch {
    /* private mode */
  }
}

/** The side to use when a URL does not say: the patient's choice, else the left side the
 *  wireframe program (Hospital GRASP L2 · Left side) prescribes. */
export function sideOr(param: string | null | undefined): Side {
  if (param === 'left' || param === 'right') return param
  return readSide() ?? 'left'
}

// ---- check-in ---------------------------------------------------------------------------

export function stopReason(c: { pain: number; new_symptoms: boolean; tier: Tier }): Exclude<StopReason, 'session'> | null {
  if (c.new_symptoms) return 'new_symptoms'
  if (c.tier === 'rest') return 'rest'
  return null
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(id)
        resolve(v)
      },
      (e) => {
        clearTimeout(id)
        reject(e)
      },
    )
  })
}

function isResult(r: unknown): r is CheckinResult {
  const o = r as Partial<CheckinResult> | null
  return !!o && (o.tier === 'full' || o.tier === 'gentle' || o.tier === 'rest') && typeof o.flagged === 'boolean'
}

async function post(c: CheckinAnswers): Promise<CheckinResult | null> {
  try {
    const notes = `where: ${c.location} · energy: ${c.energy} · time: ${c.minutes} min`
    const r = await withTimeout(api.checkin({ pain: c.pain, new_symptoms: c.new_symptoms, notes }), POST_TIMEOUT_MS)
    return isResult(r) ? r : null
  } catch {
    return null
  }
}

function applyResult(c: DayCheckin, r: CheckinResult | null): DayCheckin {
  if (!r) return c
  return { ...c, tier: r.tier, flagged: r.flagged, reasons: Array.isArray(r.reasons) ? r.reasons : [], synced: true }
}

/** Save today's check-in on this device first, then post it. Resolves with what is known:
 *  `synced: false` means the therapist has not been told. `painMax` is the prescription's stop
 *  level for the local fallback tier. `side` may be null when the day stops at check-in before
 *  the patient picked one; it is then not written to the profile. */
export async function saveCheckin(answers: CheckinAnswers, side: Side | null, painMax?: number): Promise<DayCheckin> {
  if (side) writeSide(side)
  const local: DayCheckin = { ...answers, side: side ?? readSide() ?? 'left', tier: tierFor(answers.pain, painMax), flagged: false, reasons: [], synced: false, at: new Date().toISOString() }
  const commit = (c: DayCheckin) =>
    update((d) => ({ ...d, checkin: c, stopped: stopReason(c) ?? (d.stopped === 'session' ? 'session' : null) }))
  commit(local)
  const c = applyResult(local, await post(answers))
  return commit(c).checkin!
}

let inflight: Promise<void> | null = null

/** Post a check-in the service has not received yet (called when a flow screen loads). */
export function syncCheckin(): Promise<void> {
  const c = readDay().checkin
  if (!c || c.synced) return Promise.resolve()
  inflight ??= post(c)
    .then((r) => {
      if (!r) return
      update((d) => (d.checkin && !d.checkin.synced ? { ...d, checkin: applyResult(d.checkin, r), stopped: stopReason(applyResult(d.checkin, r)) ?? d.stopped } : d))
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Plain-language line about the therapist, true to what actually happened. */
export function therapistLine(c: DayCheckin | null): string {
  if (!c) return ''
  if (!c.synced) return "Saved on this device. I couldn't reach the service, so your therapist hasn't been told yet. I'll try again next time you open Praxis."
  if (c.flagged) return 'Your therapist has been told.'
  return 'Saved with your practice record.'
}

/** Settings › Reset today's check-in: forget today's day on this device (check-in, run, demos)
 *  and the session's copy of the check-in, so the next session starts with a fresh check-in.
 *  A stopped day stays stopped: stop rules override everything (CLAUDE.md §1), so a patient
 *  stopped at pain ≥ 7 cannot reset and check in again at a lower pain. What the service
 *  received (check-in, therapist flag) is never touched. */
export function resetTodayCheckin(): { ok: true } | { ok: false; reason: 'stopped' } {
  if (readDay().stopped) return { ok: false, reason: 'stopped' }
  try {
    localStorage.removeItem(DAY_KEY)
    localStorage.removeItem(LEGACY_CHECKIN_KEY)
    sessionStorage.removeItem(LEGACY_CHECKIN_KEY)
  } catch {
    /* private mode: nothing was stored */
  }
  return { ok: true }
}

// ---- the day plan -----------------------------------------------------------------------

const isWeekly = (id: ExerciseId) => WEEKLY.includes(id)

/** Exercises in today's run. A shorter day ("Shorter · one exercise") is the one the patient
 *  picks; a stopped day has none. */
export function dayPlan(d: Day): ExerciseId[] {
  if (d.stopped) return []
  if (d.checkin && d.checkin.minutes < 14) {
    const first = [...d.done, ...(d.current ? [d.current] : [])].find((id) => !isWeekly(id))
    return first ? [first] : []
  }
  return DAY_ORDER
}

/** Where an exercise sits in today's run ("2 of 4"), or null when it is not a day slot. */
export function dayPosition(d: Day, id: ExerciseId): { index: number; total: number } | null {
  if (isWeekly(id) || d.stopped) return null
  if (d.checkin && d.checkin.minutes < 14) return { index: 1, total: 1 }
  const i = DAY_ORDER.indexOf(id)
  return i < 0 ? null : { index: i + 1, total: DAY_ORDER.length }
}

/** The next exercise of today's run, or null when the day is done or stopped. */
export function nextExercise(d: Day): ExerciseId | null {
  if (d.stopped) return null
  if (d.checkin && d.checkin.minutes < 14) {
    const plan = dayPlan(d)
    return plan.length && plan.every((id) => d.done.includes(id)) ? null : (plan[0] ?? null)
  }
  return DAY_ORDER.find((id) => !d.done.includes(id)) ?? null
}

export function startExercise(id: ExerciseId): void {
  update((d) => ({ ...d, current: id }))
}

export function markDemoSeen(id: ExerciseId): void {
  update((d) => (d.demosSeen.includes(id) ? d : { ...d, demosSeen: [...d.demosSeen, id] }))
}

/** Bind a report to today's run. Returns the day when this report belongs to it (so the
 *  report shows the day strip and the Next button), else null. Idempotent per report id.
 *  `mode` is the session's live screen (`arm` | `cup` | `nhpt`); `stopped` is true when a
 *  stop rule ended the session, which ends the day. */
export function finishReport(reportId: string, mode: string | undefined, stopped: boolean): Day | null {
  const d = readDay()
  if (!d.checkin) return null
  if (d.finished.some((f) => f.reportId === reportId)) return d
  const cur = d.current
  if (!cur || (mode && exerciseById(cur)?.session !== mode)) return null
  return update((x) => ({
    ...x,
    current: null,
    done: x.done.includes(cur) ? x.done : [...x.done, cur],
    finished: [...x.finished, { exercise: cur, reportId }],
    stopped: stopped ? 'session' : x.stopped,
  }))
}

// ---- urls -------------------------------------------------------------------------------

export function setupUrl(id: ExerciseId, side: Side): string {
  return `/details/setup?exercise=${id}&side=${side}`
}

export function demoUrl(id: ExerciseId, side: Side): string {
  return `/details/demo?exercise=${id}&side=${side}`
}

/** The live screen for an exercise: the peg test takes the hand, the rest take the side. */
export function sessionUrl(ex: Exercise, side: Side): string {
  return `/session?exercise=${ex.id}&${ex.id === 'nhpt' ? `hand=${side}` : `side=${side}`}`
}

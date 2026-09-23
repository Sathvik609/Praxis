import type { Exercise, ExerciseId } from './seed'

/** Display mirror of `services/session/praxis_session/plan.py` (locked 23 Sep 2026). The
 *  service is the authority: on check-in it computes the tier itself and tightens the running
 *  session, whatever the client asked for. This file only decides what the exercise list shows.
 *  `tests/test_plan.py::test_web_mirror_matches` keeps the numbers in step. */
export type Tier = 'full' | 'gentle' | 'rest'

export const FULL_MAX = 3
export const GENTLE_MAX = 6
export const REST_AT = 7
export const DAY_ORDER: ExerciseId[] = ['pendulum', 'arm', 'abduction', 'cup']
export const WEEKLY: ExerciseId[] = ['nhpt']
export const DAY_MINUTES = 15

/** 0–3 full, 4–6 gentle, ≥ 7 rest. `painMax` is the prescription's stop level; it can only make
 *  the rest tier stricter. */
export function tierFor(pain: number | null, painMax: number = REST_AT): Tier {
  if (pain == null) return 'full'
  const p = Math.max(0, Math.min(10, Math.round(pain)))
  if (p >= Math.min(REST_AT, painMax)) return 'rest'
  return p <= FULL_MAX ? 'full' : 'gentle'
}

export const TIER_TEXT: Record<Tier, { chip: string; line: string }> = {
  full: { chip: 'Full dose', line: 'the full day at your prescribed dose.' },
  gentle: { chip: 'Gentle day', line: 'a gentle day. Fewer reps, shorter holds, the side lift to 60° and no fast arcs, all inside what your therapist allows.' },
  rest: { chip: 'Rest day', line: 'a rest day. No exercises today, and your therapist has been told.' },
}

export function doseFor(ex: Exercise, tier: Tier): string {
  return tier === 'gentle' && ex.gentleDose ? ex.gentleDose : ex.dose
}

/** Pain from today's check-in (screen 03 stores it), or null when there is none. */
export function readCheckinPain(): number | null {
  try {
    const raw = sessionStorage.getItem('praxis.checkin')
    if (!raw) return null
    const p = (JSON.parse(raw) as { pain?: unknown }).pain
    return typeof p === 'number' ? p : null
  } catch {
    return null
  }
}

import { type GlbAction, type GlbActionMeta, type GlbClock, actionFor, advanceGlbClock } from './glbActions'

/** The demonstration script for the three exercises left after the 28 Sep lock (Arm out to the
 *  side, Waiter – cup, Nine-Hole Peg Test): the step text, which is the one source of truth for
 *  both the player caption and the Demonstration step list, and a timeline of segments that maps
 *  display time onto the GLB action's time.
 *
 *  For Arm out to the side the timeline is a phase-aware time warp: the Blender action is one
 *  2.7 s rep (lift, hold, lower, rest), which at 1× raises and lowers in well under a second. The
 *  phases come from the action's own pace curve in the sidecar (`meta.pace`, the same one the
 *  live session paces the figure with) and each is stretched to the prescription: raise 3 s, hold
 *  `holdS` (default 3 s), lower 3 s, with a short rest either side. Slower still scales on top.
 *  The cup and peg actions already play at a demonstration pace, so their timeline is 1× and only
 *  says which step each stretch of the animation shows. The GLB itself is never changed. */

export type Segment = { step: number; dur: number; from: number; to: number }
export type Script = { steps: string[]; segments: Segment[]; total: number }
export type ScriptOpts = { holdS?: number }

export const SCRIPTED: readonly GlbAction[] = ['abduction', 'waiter_cup', 'nhpt']
/** Arm out to the side: raise and lower durations (prescription: "for a count of three"), and
 *  the rest before and after each rep. */
export const RAISE_S = 3
export const LOWER_S = 3
export const REST_S = 1

const holdOf = (o: ScriptOpts) => (o.holdS && o.holdS > 0 ? o.holdS : 3)

/** The step text for an action, or null for an action without a script (it keeps the GLB
 *  sidecar's own captions). */
export function stepTexts(action: GlbAction, o: ScriptOpts = {}): string[] | null {
  switch (action) {
    case 'abduction':
      return [
        'Sit tall facing the camera, arm by your side',
        'Lift the straight arm out to the side, palm down, up to shoulder height',
        `Hold for ${holdOf(o)} s at shoulder height — shoulder down, no shrugging`,
        'Lower slowly back to your side',
      ]
    case 'waiter_cup':
      return [
        'Cup on dot 1 of the sheet, your hand resting beside it',
        'Take hold of the cup with your weaker hand',
        'Lift it, move it to the next dot and set it down, dot by dot to 5',
        'After dot 5, come back the same way to dot 1',
        'Let go and rest. Twice slowly, then twice as fast as you can',
      ]
    case 'nhpt':
      return [
        'Pick a peg from the dish with a pinch — the timer starts on this lift',
        'Carry it over the board and seat it in any hole',
        'Then the next peg, one at a time, as quickly as you comfortably can',
        'The timer stops when the ninth peg is seated',
      ]
    default:
      return null
  }
}

/** Step text for an app clip / exercise name (the Demonstration list), or null. */
export function stepTextsForClip(clip: string, o: ScriptOpts = {}): string[] | null {
  return stepTexts(actionFor(clip), o)
}

/** Identity segments (1×) between the given action-time boundaries: [t0, t1) is step 1, … */
function identity(bounds: number[]): Segment[] {
  const out: Segment[] = []
  for (let i = 0; i + 1 < bounds.length; i++) out.push({ step: i + 1, dur: bounds[i + 1] - bounds[i], from: bounds[i], to: bounds[i + 1] })
  return out
}

/** The script for an action from its sidecar entry, or null (no script, or a sidecar without
 *  what the script needs: then the panel falls back to the sidecar captions at 1×). */
export function buildScript(action: GlbAction, meta: GlbActionMeta, o: ScriptOpts = {}): Script | null {
  const steps = stepTexts(action, o)
  if (!steps) return null
  let segments: Segment[]
  if (action === 'abduction') {
    const pace = meta.pace
    if (!pace?.lift.length || !pace.lower.length) return null
    const liftFrom = pace.lift[0][1]
    const [holdFrom, holdTo] = pace.hold
    const lowerTo = Math.max(...pace.lower.map(([, t]) => t))
    segments = [
      { step: 1, dur: REST_S, from: liftFrom, to: liftFrom },
      { step: 2, dur: RAISE_S, from: liftFrom, to: holdFrom },
      { step: 3, dur: holdOf(o), from: holdFrom, to: holdTo },
      { step: 4, dur: LOWER_S, from: holdTo, to: lowerTo },
      { step: 1, dur: REST_S, from: lowerTo, to: meta.duration },
    ]
  } else {
    // Step changes where the animation changes: the sidecar's own step keys for the opening
    // (resting, taking hold / picking a peg, carrying it), then the landed targets for the rest.
    const landed = meta.targets.filter((x) => x.landed).map((x) => x.t)
    if (!landed.length || meta.steps.length < 2) return null
    const firstLanded = landed[0]
    const lastLanded = landed[landed.length - 1]
    const keys = meta.steps.map((s) => s.t)
    const bounds = action === 'waiter_cup' ? [0, keys[1], keys[2], keys[3], lastLanded, meta.duration] : [0, keys[1], firstLanded, lastLanded, meta.duration]
    if (bounds.some((b) => !Number.isFinite(b)) || bounds.some((b, i) => i > 0 && b < bounds[i - 1])) return null
    segments = identity(bounds)
  }
  return { steps, segments, total: segments.reduce((a, s) => a + s.dur, 0) }
}

/** Action time and step at display time `tau` (wrapped over the loop). */
export function scriptAt(script: Script, tau: number): { time: number; step: number } {
  const total = script.total
  let x = total > 0 ? ((tau % total) + total) % total : 0
  for (const s of script.segments) {
    if (x < s.dur || s === script.segments[script.segments.length - 1]) {
      const k = s.dur > 0 ? Math.min(1, x / s.dur) : 0
      return { time: s.from + k * (s.to - s.from), step: s.step }
    }
    x -= s.dur
  }
  return { time: 0, step: 1 }
}

/** Step shown for an action time (paced by the patient's rep progress): the first moving
 *  segment that contains it. */
export function stepAtActionTime(script: Script, t: number): number {
  for (const s of script.segments) if (s.to > s.from && t >= s.from && t <= s.to) return s.step
  return script.segments[0]?.step ?? 1
}

export function scriptCaption(script: Script, step: number): string {
  const text = script.steps[step - 1] ?? ''
  return `Step ${step} of ${script.steps.length} · ${text}`
}

/** Clock with the display time of a scripted action (`warp`, seconds into the script). */
export type ScriptClock = GlbClock & { warp?: number }

/** Advance a scripted clock by dt seconds. Free-running: the display time moves by dt × speed
 *  and wraps over the script; the action time follows the timeline. Paced by the patient (target
 *  set): exactly as `advanceGlbClock`, in action time; the display time waits. */
export function advanceScriptClock(clock: ScriptClock, dt: number, script: Script, action: { duration: number; loop: boolean }): { ended: boolean } {
  if (clock.target != null) return advanceGlbClock(clock, dt, action)
  let w = clock.warp ?? 0
  if (clock.playing) w += dt * clock.speed
  if (script.total > 0) w = ((w % script.total) + script.total) % script.total
  clock.warp = w
  clock.time = scriptAt(script, w).time
  return { ended: false }
}

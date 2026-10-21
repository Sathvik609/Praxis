/** Display preferences from Settings, kept on this browser under `praxis.prefs`. Only keys that
 *  code reads are stored:
 *  - `contrast`: `data-contrast="high"` on <html>; the stylesheet raises contrast.
 *  - `motion`: `data-motion="reduced"`; the stylesheet and `prefersReducedMotion()` stop animation.
 *  - `audio`: the coach's cues are spoken aloud by this browser (SpeechSynthesis, `useCoach`).
 *    On by default (21 Oct team review, reversing the 10 Oct caption-only decision: patients
 *    stand too far from the screen to read). Captions are still shown for every spoken cue.
 *  - `judge`: Judge view, `data-judge="1"`; shows Show trace and telemetry. The red
 *    "Live · not recording" marker and Sample chips stay visible either way. */
export type Prefs = { contrast: boolean; motion: boolean; audio: boolean; judge: boolean }

export const PREFS_KEY = 'praxis.prefs'
export const PREFS_DEFAULT: Prefs = { contrast: false, motion: false, audio: true, judge: false }

export function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Record<keyof Prefs, unknown>>
    const pick = (k: keyof Prefs) => (typeof raw[k] === 'boolean' ? (raw[k] as boolean) : PREFS_DEFAULT[k])
    return { contrast: pick('contrast'), motion: pick('motion'), audio: pick('audio'), judge: pick('judge') }
  } catch {
    return { ...PREFS_DEFAULT }
  }
}

export function writePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* private mode: kept for this page only */
  }
  applyPrefs(p)
}

export function applyPrefs(p: Prefs) {
  const d = document.documentElement.dataset
  if (p.contrast) d.contrast = 'high'
  else delete d.contrast
  if (p.motion) d.motion = 'reduced'
  else delete d.motion
  if (p.judge) d.judge = '1'
  else delete d.judge
}

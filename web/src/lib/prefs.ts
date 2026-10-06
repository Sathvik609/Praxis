/** Display preferences from Settings, kept on this browser under `praxis.prefs`. Only keys that
 *  code reads are stored:
 *  - `contrast`: `data-contrast="high"` on <html>; the stylesheet raises contrast.
 *  - `motion`: `data-motion="reduced"`; the stylesheet and `prefersReducedMotion()` stop animation.
 *  - `captionsPanel`: whether the session shows the caption panel. Captions cannot be switched
 *    off while Spoken instructions is on; this only hides the panel when speech is off.
 *  - `judge`: Judge view, `data-judge="1"`; shows Show trace and telemetry. The red
 *    "Live · not recording" marker and Sample chips stay visible either way. */
export type Prefs = { contrast: boolean; motion: boolean; captionsPanel: boolean; judge: boolean }

export const PREFS_KEY = 'praxis.prefs'
export const PREFS_DEFAULT: Prefs = { contrast: false, motion: false, captionsPanel: true, judge: false }

export function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Record<keyof Prefs, unknown>>
    const pick = (k: keyof Prefs) => (typeof raw[k] === 'boolean' ? (raw[k] as boolean) : PREFS_DEFAULT[k])
    return { contrast: pick('contrast'), motion: pick('motion'), captionsPanel: pick('captionsPanel'), judge: pick('judge') }
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

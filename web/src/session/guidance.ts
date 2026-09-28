/** Guidance preferences from Settings, kept on this browser. Each one is read by the code it
 *  names, so no toggle is decorative:
 *  - `spoken`: the live screens pass it to `useCoach` as `voice`, which mutes SpeechSynthesis.
 *  - `larger`: `applyGuidance` sets `data-text="large"` on <html>; tokens.css raises the root
 *    font size, so every rem-sized cue, label and control grows together.
 *  Captions are not a preference: every spoken cue is always shown as text (CLAUDE.md §1). */
export type Guidance = { spoken: boolean; larger: boolean }

export const GUIDANCE_KEY = 'praxis.guidance'
export const GUIDANCE_DEFAULT: Guidance = { spoken: false, larger: false }

export function readGuidance(): Guidance {
  try {
    const raw = localStorage.getItem(GUIDANCE_KEY)
    if (!raw) return GUIDANCE_DEFAULT
    const g = JSON.parse(raw) as Partial<Guidance>
    return { spoken: typeof g.spoken === 'boolean' ? g.spoken : GUIDANCE_DEFAULT.spoken, larger: typeof g.larger === 'boolean' ? g.larger : GUIDANCE_DEFAULT.larger }
  } catch {
    return GUIDANCE_DEFAULT
  }
}

export function writeGuidance(g: Guidance) {
  try {
    localStorage.setItem(GUIDANCE_KEY, JSON.stringify(g))
  } catch {
    /* private mode: kept for this page only */
  }
  applyGuidance(g)
}

export function applyGuidance(g: Guidance = readGuidance()) {
  if (g.larger) document.documentElement.dataset.text = 'large'
  else delete document.documentElement.dataset.text
}

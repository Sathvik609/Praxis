/** Guidance preferences from Settings, kept on this browser. Each one is read by the code it
 *  names, so no toggle is decorative:
 *  - `larger`: `applyGuidance` sets `data-text="large"` on <html>; tokens.css raises the root
 *    font size, so every rem-sized cue, label and control grows together.
 *  There is no `spoken`: the coach is caption-only since 10 Oct (product-owner decision), so an
 *  older build's stored `spoken` value is ignored.
 *  Display preferences (contrast, motion, caption panel, Judge view) live in `lib/prefs.ts`. */
export type Guidance = { larger: boolean }

export const GUIDANCE_KEY = 'praxis.guidance'
// Larger text is on by default: the designers' artifact renders at the 18 px root (ruling R10).
export const GUIDANCE_DEFAULT: Guidance = { larger: true }

export function readGuidance(): Guidance {
  try {
    const raw = localStorage.getItem(GUIDANCE_KEY)
    if (!raw) return GUIDANCE_DEFAULT
    const g = JSON.parse(raw) as Partial<Guidance>
    return { larger: typeof g.larger === 'boolean' ? g.larger : GUIDANCE_DEFAULT.larger }
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

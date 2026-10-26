/** Guidance preferences from Settings, kept on this browser. Each one is read by the code it
 *  names, so no toggle is decorative:
 *  - `larger`: `applyGuidance` sets `data-text="large"` on <html>; tokens.css raises the root
 *    font size, so every rem-sized cue, label and control grows together.
 *  An older build's stored `spoken` value is ignored: spoken cues (back since 21 Oct) follow
 *  `prefs.audio` instead.
 *  Display and audio preferences (contrast, motion, audio, Judge view) live in `lib/prefs.ts`. */
export type Guidance = { larger: boolean }

export const GUIDANCE_KEY = 'praxis.guidance'
// Larger text is off by default since 10 Oct (pages looked zoomed in on a
// 1336 x 759 laptop window). The 16 px root lets every screen fit by layout; patients who want the
// designers' 18 px root turn it on in Settings, and a stored explicit value always wins.
export const GUIDANCE_DEFAULT: Guidance = { larger: false }

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

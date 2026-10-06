/** True when the patient asked for reduced motion in Settings (`data-motion="reduced"`) or the
 *  system asks for it. Tweens and session animations jump straight to their end value. */
export function prefersReducedMotion(): boolean {
  if (document.documentElement.dataset.motion === 'reduced') return true
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

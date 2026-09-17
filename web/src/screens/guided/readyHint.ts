import type { Check } from '../05-camera-setup/Checklist'

/** One thing at a time. The guided path never shows the setup table; it shows the single most
 *  important thing that is not right yet, in the coach's words. Order: can I see anything at
 *  all → can I see you → are you turned the right way for this exercise → can I see you well
 *  enough. The service's own hint wins when it sends one. */
const ORDER = ['camera', 'person', 'view', 'side_view', 'front_view', 'pose', 'lighting']

const FALLBACK: Record<string, string> = {
  camera: 'I cannot see anything yet. Allow the camera in the address bar.',
  person: 'Step back a little so I can see your shoulder and your hip.',
  pose: 'Step back a little so I can see your shoulder and your hip.',
  lighting: 'A little more light would help me see you clearly.',
}

export type ReadyHint = { id: string; text: string } | null

export function readyHint(checks: Check[], view: 'side' | 'front'): ReadyHint {
  const pending = checks.filter((c) => c.status !== 'pass')
  if (!pending.length) return null
  const rank = (c: Check) => {
    const i = ORDER.indexOf(c.id)
    return i === -1 ? ORDER.length : i
  }
  const worst = [...pending].sort((a, b) => rank(a) - rank(b))[0]
  const turn = view === 'side' ? 'Turn your practising side to the camera, so I see you from the side.' : 'Face the camera, with both shoulders in view.'
  const text = worst.hint ?? FALLBACK[worst.id] ?? (worst.id.includes('view') ? turn : worst.label)
  return { id: worst.id, text }
}

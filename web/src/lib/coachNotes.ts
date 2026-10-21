/** Report coach notes as plain sentences (10 Oct walkthrough). Since 10 Oct the service writes
 *  each note as a sentence (`session.note_text`); sessions stored before that carry the raw
 *  "action: reason" form ("progress: patient accepted progression"), which reads like code to a
 *  clinician. This rewrites only that legacy form; a sentence passes through unchanged. */
const LEAD: Record<string, string> = {
  progress: 'Progression offered',
  regress: 'Made easier',
  rest: 'Rest suggested',
  stop: 'Session stopped',
  correct: 'Correction',
  instruct: 'Observation',
}

export function noteText(text: string): string {
  const m = /^(progress|regress|rest|stop|correct|instruct): (.+)$/s.exec(text.trim())
  if (!m) return text
  const body = m[2].trim()
  if (m[1] === 'progress' && body === 'patient accepted progression') return 'Patient accepted the faster arcs.'
  return `${LEAD[m[1]]}: ${body}${/[.!?]$/.test(body) ? '' : '.'}`
}

/** Longest coach note the report shows (team design review, 21 Oct: 2–3 sentences). The full
 *  note stays in the stored session and in Download. */
export const NOTE_SENTENCES = 3

// A full stop after one of these words does not end a sentence ("Dr. Rao").
const ABBREV = /(?:^|\s)(?:Dr|Mr|Mrs|Ms|Prof|St|vs|e\.g|i\.e|approx)\.$/i

/** The first `max` sentences of `text`, cut only after ".", "!" or "?" followed by a space, so
 *  "1.2 s" and "Dr. Rao" stay whole. Shorter text comes back trimmed and otherwise unchanged. */
export function capSentences(text: string, max = NOTE_SENTENCES): string {
  const t = text.trim()
  let count = 0
  for (const m of t.matchAll(/[.!?]+(?=\s+\S)/g)) {
    const end = m.index + m[0].length
    if (ABBREV.test(t.slice(0, end))) continue
    if (++count === max) return t.slice(0, end)
  }
  return t
}

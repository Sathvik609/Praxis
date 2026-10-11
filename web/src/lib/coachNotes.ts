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

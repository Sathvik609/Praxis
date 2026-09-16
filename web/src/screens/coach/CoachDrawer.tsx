import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../design/Button'
import { Chip } from '../../design/Chip'
import { api, useApi } from '../../lib/api'

const QUESTIONS = ['What is my program today?', 'Can I do more?', 'Why did the coach say to slow down?', 'How did my last session go?']

/** Coach drawer: answers from the prescription and the last session, rule-based and labeled.
 *  The LLM agent (W6) replaces the answer function behind the same questions. */
export function CoachDrawer() {
  const nav = useNavigate()
  const { data: rx } = useApi(() => api.prescription())
  const { data: sessions } = useApi(() => api.sessions())
  const [log, setLog] = useState<{ q: string; a: string }[]>([])
  const answer = (q: string): string => {
    const cup = rx?.exercises.cup ?? {}
    const arm = rx?.exercises.arm ?? {}
    const last = sessions?.[0]
    if (q.startsWith('What is my program')) return `Today: Waiter – cup (${String(cup.slow_arcs ?? 2)} slow arcs then ${String(cup.fast_arcs ?? 2)} fast arcs) and Arm to the front (${String(arm.sets ?? 2)} sets of ${String(arm.reps ?? 8)}, hold ${String(arm.hold_s ?? 3)} s, no higher than the shoulder). The peg test is weekly.`
    if (q.startsWith('Can I do more')) return `Your program (Hospital GRASP, Level ${rx?.level ?? 2}) allows fast arcs and a shorter hold, and nothing else. Difficulty never goes above Level ${rx?.level ?? 2}; a level change needs ${rx?.clinician?.split(',')[0] ?? 'your therapist'}.`
    if (q.startsWith('Why did the coach')) return 'The coach slows you down when the camera sees trunk lean or shoulder hiking, or when the behavioural exertion index is high. Those are rules written by your therapist, checked before the coach speaks.'
    if (last) return `${last.date}: ${last.title} — ${String(last.summary.camera.verified ?? 0)} verified, ${String(last.summary.camera.unverified ?? 0)} unverified; ${last.summary.coach.notes[0]?.text ?? 'no coach notes'}.`
    return 'No sessions yet.'
  }
  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="flex items-center gap-3"><h1 className="text-4xl">Ask the coach</h1><Chip tone="neutral">Rule-based coach · LLM agent pending</Chip></div>
      <p className="text-muted">Answers come from your prescription and your last session. The coach only suggests within what your therapist prescribed.</p>
      <div className="mt-5 flex flex-wrap gap-3">{QUESTIONS.map((q) => <Button key={q} variant="secondary" className="min-h-12 text-base" onClick={() => setLog((l) => [...l, { q, a: answer(q) }])}>{q}</Button>)}</div>
      <div className="mt-6 space-y-4">
        {log.map((x, i) => <div key={i} className="rounded-2xl border border-line bg-surface p-5"><div className="text-muted">You: {x.q}</div><p className="mt-1 text-xl">{x.a}</p></div>)}
      </div>
      <div className="mt-8"><Button variant="secondary" onClick={() => nav(-1)}>Back</Button></div>
    </div>
  )
}

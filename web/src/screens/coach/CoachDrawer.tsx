import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Chip } from '../../design/Chip'
import { X } from '../../design/Icon'
import { api, useApi } from '../../lib/api'

const QUESTIONS = ['What is my program today?', 'Can I do more?', 'Why did the coach say to slow down?', 'How did my last session go?']

/** Questions and answers from the prescription and the last session. Rule-based and labeled;
 *  the LLM agent (W6) replaces `answer` behind the same questions. Shared by the page and the
 *  drawer. */
export function CoachPanel() {
  const { data: rx } = useApi(() => api.prescription())
  const { data: sessions } = useApi(() => api.sessions())
  const [log, setLog] = useState<{ q: string; a: string }[]>([])
  const answer = (q: string): string => {
    const cup = rx?.exercises.cup ?? {}
    const side = rx?.exercises.abduction ?? {}
    const last = sessions?.[0]
    if (q.startsWith('What is my program')) return `Today: Arm out to the side (${String(side.sets ?? 2)} sets of ${String(side.reps ?? 8)}, hold ${String(side.hold_s ?? 3)} s, no higher than the shoulder), then Waiter – cup (${String(cup.slow_arcs ?? 2)} slow arcs then ${String(cup.fast_arcs ?? 2)} fast arcs). The peg test is weekly.`
    if (q.startsWith('Can I do more')) return `Your program (Hospital GRASP, Level ${rx?.level ?? 2}) allows fast arcs and a shorter hold, and nothing else. Difficulty never goes above Level ${rx?.level ?? 2}; a level change needs ${rx?.clinician?.split(',')[0] ?? 'your therapist'}.`
    if (q.startsWith('Why did the coach')) return 'The coach slows you down when the camera sees trunk lean or shoulder hiking, or when the behavioural exertion index is high. Those are rules written by your therapist, checked before the coach speaks.'
    if (last) return `${last.date}: ${last.title} — ${String(last.summary.camera.verified ?? 0)} verified, ${String(last.summary.camera.unverified ?? 0)} unverified; ${last.summary.coach.notes[0]?.text ?? 'no coach notes'}.`
    return 'No sessions yet.'
  }
  return (
    <>
      <p className="text-muted">Answers come from your prescription and your last session. The coach only suggests within what your therapist prescribed.</p>
      <div className="mt-5 flex flex-wrap gap-3">
        {QUESTIONS.map((q) => (
          <Button key={q} variant="secondary" onClick={() => setLog((l) => [...l, { q, a: answer(q) }])}>{q}</Button>
        ))}
      </div>
      <div className="mt-6 space-y-4" aria-live="polite">
        {log.map((x, i) => (
          <Card key={i} tone="coach">
            <div className="text-muted">You: {x.q}</div>
            <p className="mt-1 text-xl">{x.a}</p>
          </Card>
        ))}
      </div>
    </>
  )
}

/** Deep-link page for `/coach` (Demonstration links here). */
export function CoachDrawer() {
  const nav = useNavigate()
  return (
    <div className="mx-auto w-full max-w-3xl p-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl">Ask the coach</h1>
        <Chip tone="neutral">Rule-based coach · LLM agent pending</Chip>
      </div>
      <CoachPanel />
      <div className="mt-8"><Button variant="secondary" onClick={() => nav(-1)}>Back</Button></div>
    </div>
  )
}

/** Right-side drawer version, opened from Home. Escape and the overlay close it. */
export function CoachSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-scrim fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="ui-dialog fixed inset-y-0 right-0 z-50 flex w-[min(560px,92vw)] flex-col overflow-auto bg-bg p-8 text-ink shadow-[var(--shadow-2)]">
          <div className="flex items-start gap-3">
            <div>
              <Dialog.Title className="text-3xl">Ask the coach</Dialog.Title>
              <Chip tone="neutral" className="mt-2">Rule-based coach · LLM agent pending</Chip>
            </div>
            <Dialog.Close asChild>
              <Button variant="link" className="ml-auto min-h-14 w-14 px-0" aria-label="Close" icon={<X />} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Questions answered from your prescription and your last session.</Dialog.Description>
          <div className="mt-4">
            <CoachPanel />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

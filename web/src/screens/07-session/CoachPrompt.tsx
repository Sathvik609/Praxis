import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Chip } from '../../design/Chip'
import { Check, Sparkles } from '../../design/Icon'
import { describeProposal, isWhy, promptKind, type Prompt, type PromptKind } from '../../session/agent'

const DEFAULT_TITLE: Record<PromptKind, string> = {
  progression: 'Coach suggests a next step',
  adjustment: 'Coach suggests a change',
  resume: 'Setup looks good — resume?',
}

/** Wireframe 07b, generalised (agent spec §7): any coach prompt — a progression, a dose
 *  adjustment already clamped to the prescription, or a request to resume after a setup fix.
 *  Nothing changes until the patient taps; option 0 accepts (primary), option 1 declines,
 *  "Why?" opens the coach's reason inline and keeps the prompt open. The card is not modal:
 *  the session keeps counting while it is shown. */
export function CoachPrompt({
  prompt,
  proposalContext = {},
  onChoose,
  whyOpen,
  whyText,
}: {
  prompt: Prompt
  /** Running value and the prescription's allowed range for the proposal's field. */
  proposalContext?: { from?: number | string | null; range?: [number, number] | null }
  onChoose: (choice: string, index: number) => void
  whyOpen: boolean
  /** The coach's reason; null while it has been asked and not yet answered. */
  whyText?: string | null
}) {
  const kind = promptKind(prompt)
  const Icon = kind === 'resume' ? Check : Sparkles
  return (
    <Card
      tone="highlight"
      title={
        <span className="inline-flex items-center gap-2">
          <Icon aria-hidden className="h-6 w-6 shrink-0 text-teal-ink" />
          {prompt.title || DEFAULT_TITLE[kind]}
        </span>
      }
      action={prompt.within_prescription ? <Chip tone="amber">Within your prescription</Chip> : undefined}
    >
      {prompt.text && <p className="text-muted">{prompt.text}</p>}
      {prompt.proposal && <p className="mt-2 text-xl font-bold">{describeProposal(prompt.proposal, proposalContext)}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        {prompt.options.map((o, i) =>
          isWhy(o) ? (
            <Button key={o} variant="secondary" aria-expanded={whyOpen} onClick={() => onChoose(o, i)}>{o}</Button>
          ) : (
            <Button key={o} variant={i === 0 ? 'primary' : 'secondary'} onClick={() => onChoose(o, i)}>{o}</Button>
          ),
        )}
      </div>
      {whyOpen &&
        (whyText ? (
          <p className="mt-3 rounded-[var(--r-control)] bg-tint-mint p-3 text-lg">{whyText}</p>
        ) : (
          <p role="status" className="mt-3 rounded-[var(--r-control)] bg-tint-mint p-3 text-lg text-muted">Asking the coach why…</p>
        ))}
    </Card>
  )
}

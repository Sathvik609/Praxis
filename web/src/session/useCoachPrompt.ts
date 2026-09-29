import { useState } from 'react'
import type { PraxisEvent } from '../lib/events'
import { isWhy, type Prompt } from './agent'

type Send = (msg: Record<string, unknown>) => void
type Asked = { eventId: number; after: number; open: boolean }

/** Answers the open coach prompt over the session socket (agent spec §7):
 *  `{cmd: "answer", prompt: id, choice: option text}`. Accept / decline close the prompt; "Why?"
 *  is sent once, keeps the prompt open and shows the next coach cue (the service answers a Why
 *  with an `instruct`) as the reason. Later taps on Why only show / hide it. */
export function useCoachPrompt(events: PraxisEvent[], prompt: (Prompt & { eventId: number }) | null, dismiss: () => void, send: Send) {
  const [asked, setAsked] = useState<Asked | null>(null)
  const current = asked && prompt && asked.eventId === prompt.eventId ? asked : null

  const reply = current ? events.find((e) => e.type === 'coach' && e.id > current.after && !(e.ui as { prompt?: unknown } | undefined)?.prompt) : undefined
  const whyText = reply ? String(reply.text ?? '') : null

  const choose = (choice: string, _index: number) => {
    if (!prompt) return
    if (isWhy(choice)) {
      if (current) {
        setAsked({ ...current, open: !current.open })
        return
      }
      send({ cmd: 'answer', prompt: prompt.id, choice })
      setAsked({ eventId: prompt.eventId, after: events.reduce((m, e) => Math.max(m, e.id), prompt.eventId), open: true })
      return
    }
    send({ cmd: 'answer', prompt: prompt.id, choice })
    dismiss()
  }

  return { prompt, choose, whyOpen: !!current?.open, whyText }
}

import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic } from '../../design/Icon'
import { api, useApi } from '../../lib/api'
import { readDay, therapistLine, type Day } from '../../lib/day'
import { FULL_MAX, GENTLE_MAX, readCheckinPain } from '../../lib/plan'
import { exerciseById } from '../../lib/seed'
import { COACH_LABEL } from '../../session/agent'
import { nextSuggestion, pending, routeText, shortestPending, whyFor, type CoachId, type SuggestCtx } from './coachSuggest'

type Msg = { from: 'me' | 'coach'; text: string; suggest?: CoachId; alert?: boolean }
type Props = { open: boolean; onOpenChange: (v: boolean) => void; side: 'left' | 'right'; onBegin: (id: string) => void }

const QUICK = ["I'm tired", 'Something hurts', 'Less time today', 'Explain this exercise']
const OUT_OF_SCOPE = "I can only suggest from your assigned exercises and today's check-in."

type SR = { lang: string; interimResults: boolean; onresult: ((e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void }
function speechRecognition(): (new () => SR) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** The designers' library coach (6 Oct, `LibCoach`): same panel, bubbles, suggestion card and
 *  quick replies, answered by rules in code from today's plan (`GET /api/plan`), the day on this
 *  device, the calendar, the prescription and live sessions. Labelled rule-based in every
 *  bubble. New or worse pain is never answered here: it goes to the check-in, which is what
 *  writes a therapist flag. Free text is keyword-routed; the mic only fills the input. */
export function CoachChat({ open, onOpenChange, onBegin }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="lc-scrim" />
        <Dialog.Content className="lc-panel">
          <ChatBody onBegin={onBegin} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ChatBody({ onBegin }: { onBegin: (id: string) => void }) {
  const nav = useNavigate()
  const [day] = useState<Day>(readDay)
  const pain = day.checkin?.pain ?? readCheckinPain()
  const plan = useApi(() => api.plan(pain ?? 0))
  const calendar = useApi(() => api.calendar())
  const rx = useApi(() => api.prescription())
  const sessions = useApi(() => api.sessions())
  const settled = [plan, calendar, rx, sessions].every((r) => r.data != null || r.error != null)
  const ctx: Omit<SuggestCtx, 'skip'> | null = plan.data ? { plan: plan.data, day, calendar: calendar.data, rx: rx.data, sessions: sessions.data } : null

  const [msgs, setMsgs] = useState<Msg[]>([])
  const [skip, setSkip] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [listening, setListening] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const Recognition = speechRecognition()

  const current = [...msgs].reverse().find((m) => m.suggest)?.suggest ?? null
  const name = (id: CoachId) => exerciseById(id)?.name ?? id
  const itemOf = (id: CoachId) => [...(ctx?.plan.items ?? []), ...(ctx?.plan.weekly ?? [])].find((x) => x.id === id)
  const pitch = (id: CoachId, first: boolean) => (id === 'nhpt' ? 'Your weekly Nine-Hole Peg Test is due today.' : first ? `${name(id)} is next in today's plan.` : `${name(id)} is also in today's plan.`)
  const isFirst = (id: CoachId) => (ctx ? pending(ctx)[0]?.id === id : false)

  const opening = (): Msg => {
    if (!ctx) return { from: 'coach', text: "I couldn't reach the service, so I can't read today's plan right now. Try again in a moment." }
    if (day.stopped === 'new_symptoms') return { from: 'coach', text: `You told the check-in something is new or worse, so there are no exercises today until your therapist has looked at it. ${therapistLine(day.checkin)}`.trim() }
    if (day.stopped === 'session') return { from: 'coach', text: "A stop rule ended today's practice. Rest the arm today." }
    if (day.stopped === 'rest' || ctx.plan.tier === 'rest') return { from: 'coach', text: `Today is a rest day: no exercises. ${therapistLine(day.checkin)}`.trim() }
    const s = nextSuggestion({ ...ctx, skip: [] })
    if (!s) return { from: 'coach', text: "Good to see you. Today's plan is done." }
    const dose = pain == null ? ' No check-in yet today, so this is your prescribed dose.' : ctx.plan.tier === 'gentle' ? ` ${ctx.plan.reason}` : ''
    return { from: 'coach', text: `Good to see you. ${pitch(s.id, true)}${dose}`, suggest: s.id }
  }

  useEffect(() => {
    if (settled && msgs.length === 0) setMsgs([opening()])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled])
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' })
  }, [msgs])

  const push = (user: string | null, reply: Msg) => setMsgs((m) => [...m, ...(user ? [{ from: 'me' as const, text: user }] : []), reply])

  const suggestMore = (user: string) => {
    if (!ctx) return push(user, { from: 'coach', text: OUT_OF_SCOPE })
    let nextSkip = current ? [...skip, current] : skip
    let s = nextSuggestion({ ...ctx, skip: nextSkip })
    if (!s && current) {
      nextSkip = [current]
      s = nextSuggestion({ ...ctx, skip: nextSkip })
    }
    if (!s) return push(user, { from: 'coach', text: current ? "That's the only exercise left in today's plan." : "Nothing else is in today's plan." })
    setSkip(nextSkip)
    push(user, { from: 'coach', text: pitch(s.id, isFirst(s.id)), suggest: s.id })
  }

  const answer = (q: string) => {
    const route = routeText(q)
    if (route === 'hurt') {
      const who = rx.data?.clinician?.split(',')[0] || 'your therapist'
      push(q, { from: 'coach', alert: true, text: `I'm sorry it hurts. I don't suggest exercises for new or worse pain. Opening today's check-in, where you can tell us, so ${who} can be told. If it's severe or sudden, contact your care team.` })
      nav('/details/checkin')
      return
    }
    if (route === 'another') return suggestMore(q)
    if (route === 'other' || !ctx) return push(q, { from: 'coach', text: OUT_OF_SCOPE })
    const rest = day.stopped != null || ctx.plan.tier === 'rest'
    if (route === 'tired') {
      if (rest) return push(q, { from: 'coach', text: 'Today is a rest day: no exercises. Rest the arm.' })
      const s = nextSuggestion({ ...ctx, skip: [] })
      if (ctx.plan.tier === 'gentle') return push(q, { from: 'coach', text: `Let's keep it light. ${ctx.plan.reason}`, suggest: s?.id })
      const gentle = s ? exerciseById(s.id)?.gentleDose : undefined
      return push(q, { from: 'coach', text: `Let's keep it light. Today's plan is at your full dose, and I can't lower it myself: the check-in sets a gentle day${gentle ? ` (${gentle})` : ''} when pain is ${FULL_MAX + 1}–${GENTLE_MAX}, all inside what your therapist allows. Resting is always fine.`, suggest: s?.id })
    }
    if (route === 'time') {
      const id = shortestPending({ ...ctx, skip: [] })
      if (!id) return push(q, { from: 'coach', text: rest ? 'Today is a rest day: no exercises.' : "Nothing is left in today's plan." })
      return push(q, { from: 'coach', text: `Short on time? ${name(id)} has the fewest movements left today: ${itemOf(id)?.dose ?? ''}. Your full day is about ${ctx.plan.minutes} min.`, suggest: id })
    }
    const ex = exerciseById(current)
    return push(q, { from: 'coach', text: ex ? `${ex.name}: ${ex.steps.join('. ')}.` : 'Ask me for a suggestion first, then I can explain it.' })
  }

  const send = () => {
    const q = draft.trim()
    if (!q) return
    setDraft('')
    answer(q)
  }
  const mic = () => {
    if (!Recognition) return
    const r = new Recognition()
    r.lang = 'en-US'
    r.interimResults = false
    r.onresult = (e) => setDraft(e.results[0][0].transcript)
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    setListening(true)
    r.start()
  }

  const card = (id: CoachId) => {
    const ex = exerciseById(id)
    const why = ctx ? whyFor(id, ctx) : []
    const dose = itemOf(id)?.dose
    return (
      <div className="lc-sug">
        <div className="lc-sug-h">
          <b>{name(id)}</b>
          {ex && <span className="lc-tag">{ex.category.split(' · ')[0]}</span>}
        </div>
        {ex && <p className="lc-sug-d">{[ex.equipment, dose].filter(Boolean).join(' · ')}</p>}
        {why.length > 0 && (
          <p className="lc-why">
            <span>Why: </span>
            {why.join(' · ')}
          </p>
        )}
        <div className="lc-sug-a">
          <button type="button" className="lib-cta lib-cta-1" onClick={() => onBegin(id)}>Begin setup</button>
          <button type="button" className="lib-cta lib-cta-2" onClick={() => suggestMore('Suggest another')}>Suggest more</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <header className="lc-head">
        <Dialog.Title className="lc-title">Praxis coach</Dialog.Title>
        <Dialog.Close asChild>
          <button type="button" className="lib-cta lib-cta-2 lc-close">Close</button>
        </Dialog.Close>
      </header>
      <Dialog.Description className="lc-scope">
        {`Suggests only from your assigned${rx.data ? ` Level ${rx.data.level}` : ''} exercises and today's check-in. Cannot change your level or diagnose.`}
      </Dialog.Description>
      <div className="lc-log" role="log" aria-live="polite">
        {msgs.length === 0 && (
          <div className="lc-bubble">
            <span className="lc-who">{COACH_LABEL}</span>
            <p>Reading today's plan…</p>
          </div>
        )}
        {msgs.map((m, i) =>
          m.from === 'me' ? (
            <div key={i} className="lc-me">{m.text}</div>
          ) : (
            <div key={i} className="lc-turn">
              <div className={`lc-bubble${m.alert ? ' lc-alert' : ''}`}>
                <span className="lc-who">{COACH_LABEL}</span>
                <p>{m.text}</p>
              </div>
              {m.suggest && card(m.suggest)}
            </div>
          ),
        )}
        <div className="lc-chips" role="group" aria-label="Quick replies">
          {QUICK.map((c) => (
            <button key={c} type="button" className="lc-chip" onClick={() => answer(c)}>{c}</button>
          ))}
        </div>
        <div ref={endRef} />
      </div>
      <footer className="lc-foot">
        <p className="lc-note">New or worse symptoms go to the check-in, not answered here.</p>
        <form
          className="lc-input"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={listening ? 'Listening…' : 'Type or tap the mic…'} aria-label="Message the coach" />
          <button
            type="button"
            className={`lc-mic${listening ? ' is-on' : ''}`}
            aria-label={listening ? 'Stop listening' : 'Talk to the coach'}
            aria-pressed={listening}
            disabled={!Recognition}
            title={Recognition ? undefined : 'Voice input is not available in this browser. Type instead.'}
            onClick={mic}
          >
            <Mic aria-hidden />
          </button>
        </form>
      </footer>
    </>
  )
}

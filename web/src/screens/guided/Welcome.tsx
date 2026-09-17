import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Field } from '../../design/Field'
import { NumberScale } from '../../design/NumberScale'
import { api, type TodayPlan } from '../../lib/api'
import { Bubble, Conversation, type Line } from './Conversation'

type Step = 'side' | 'goal' | 'pain' | 'done'

const GOAL_EXAMPLES = ['Playing badminton', 'Reaching the top shelf', 'Carrying the shopping']
const GOAL_MAX = 120

const QUESTION: Record<Step, string> = {
  side: 'Which arm are we practising with?',
  goal: 'What would you like to get back to?',
  pain: 'How is your shoulder right now, from 0 to 10?',
  done: '',
}

/** Guided path · Welcome. Three questions, one at a time, in a plain conversation: which arm,
 *  what you want to get back to, how the shoulder feels today. Nothing else — no injury
 *  question, no therapist or program code, no figure (decisions, 17 Sep). The answers become
 *  the profile the whole guided path plans from. */
export function Welcome() {
  const nav = useNavigate()
  const [step, setStep] = useState<Step>('side')
  const [lines, setLines] = useState<Line[]>([
    { from: 'coach', text: 'Hello. I am your practice coach. Three short questions and we can start.' },
    { from: 'coach', text: QUESTION.side },
  ])
  const [side, setSide] = useState<'left' | 'right' | null>(null)
  const [goal, setGoal] = useState('')
  const [pain, setPain] = useState<number | null>(null)
  const [plan, setPlan] = useState<TodayPlan | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const answerRef = useRef<HTMLDivElement>(null)

  // Each new question takes focus so the flow works from the keyboard alone.
  useEffect(() => {
    answerRef.current?.focus()
  }, [step])

  const say = (you: string, nextQuestion: string) =>
    setLines((ls) => [...ls, { from: 'you', text: you }, ...(nextQuestion ? [{ from: 'coach' as const, text: nextQuestion }] : [])])

  const chooseSide = (v: 'left' | 'right') => {
    setSide(v)
    say(v === 'left' ? 'Left arm' : 'Right arm', QUESTION.goal)
    setStep('goal')
  }

  const submitGoal = () => {
    const g = goal.trim()
    if (!g) return
    say(g, QUESTION.pain)
    setStep('pain')
  }

  const submitPain = async (p: number, chosenSide: 'left' | 'right', chosenGoal: string) => {
    setSaving(true)
    setError(null)
    try {
      await api.saveProfile({ side: chosenSide, goal: chosenGoal, pain: p })
      const today = await api.planToday(p)
      setPlan(today)
      setLines((ls) => [...ls, { from: 'coach', text: today.tier_reason }, { from: 'coach', text: today.goal_line }])
      setStep('done')
    } catch {
      setError('I could not save your answers. The coach service may not be running.')
    } finally {
      setSaving(false)
    }
  }

  const startPain = () => {
    if (pain === null || !side) return
    setLines((ls) => [...ls, { from: 'you', text: `Pain ${pain} out of 10` }])
    void submitPain(pain, side, goal.trim())
  }

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="flex h-16 items-center px-6">
        <span className="font-heading text-2xl font-semibold text-teal-ink">Praxis</span>
      </header>
      <main className="mx-auto w-full max-w-[46rem] px-6 pb-16">
        <h1 className="sr-only">Welcome — three questions before your first practice</h1>
        <Conversation lines={lines} />

        <div ref={answerRef} tabIndex={-1} className="mt-6 focus:outline-none">
          {step === 'side' && (
            <div className="flex flex-wrap justify-end gap-3">
              <Button variant="secondary" onClick={() => chooseSide('left')}>Left arm</Button>
              <Button variant="secondary" onClick={() => chooseSide('right')}>Right arm</Button>
            </div>
          )}

          {step === 'goal' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap justify-end gap-3">
                {GOAL_EXAMPLES.map((g) => (
                  <Button key={g} variant="secondary" onClick={() => setGoal(g)}>{g}</Button>
                ))}
              </div>
              <Field
                label="In your own words"
                hint="One line is plenty. You can change it later."
                value={goal}
                maxLength={GOAL_MAX}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitGoal()}
              />
              <Button full disabled={!goal.trim()} onClick={submitGoal}>Next</Button>
            </div>
          )}

          {step === 'pain' && (
            <div className="flex flex-col gap-4">
              <Card padding="md">
                <NumberScale label="Pain right now" value={pain} onChange={setPain} leftAnchor="No pain" rightAnchor="Worst imaginable" />
                <p className="mt-3 text-base text-muted">This sets today&apos;s plan only. I ask again each day, and you can stop at any point.</p>
              </Card>
              <Button full disabled={pain === null || saving} onClick={startPain}>{saving ? 'Saving…' : 'Next'}</Button>
            </div>
          )}

          {error && (
            <div role="alert" className="mt-4">
              <Card tone="watch">
                <p className="text-xl">{error}</p>
                <div className="mt-4"><Button onClick={startPain}>Try again</Button></div>
              </Card>
            </div>
          )}

          {step === 'done' && plan && (
            <div className="mt-2 flex flex-col gap-4">
              <Bubble from="coach">
                {plan.tier === 'rest'
                  ? 'Today is a rest day. I will keep your plan ready for tomorrow.'
                  : `I have ${plan.items.length} ${plan.items.length === 1 ? 'exercise' : 'exercises'} ready for you.`}
              </Bubble>
              <Button full onClick={() => nav('/')}>Start today</Button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

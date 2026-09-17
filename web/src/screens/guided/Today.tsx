import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AvatarPanel } from '../../avatar/AvatarPanel'
import { guidedAvatarProps } from '../../avatar/guidedClip'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Chip } from '../../design/Chip'
import { Check } from '../../design/Icon'
import { NumberScale } from '../../design/NumberScale'
import { api, useApi, type PlanItem, type Profile, type Tier, type TodayPlan } from '../../lib/api'
import { getSession } from '../../lib/auth'
import { DetailsLink } from './DetailsLink'

const TIER_CHIP: Record<Tier, { tone: 'mint' | 'amber' | 'red'; word: string }> = {
  full: { tone: 'mint', word: 'Full program' },
  gentle: { tone: 'amber', word: 'Gentle today' },
  rest: { tone: 'red', word: 'Rest today' },
}

/** True when this timestamp falls on the calendar day the patient is looking at. */
export function isToday(iso: string): boolean {
  const d = new Date(iso)
  return !Number.isNaN(d.getTime()) && d.toDateString() === new Date().toDateString()
}

function Row({ item }: { item: PlanItem }) {
  return (
    <li className="flex min-h-14 items-center gap-3 border-b border-line py-2 last:border-0">
      <span
        aria-hidden
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${item.done_today ? 'bg-teal-fill text-white' : 'border-2 border-line'}`}
      >
        {item.done_today && <Check className="h-4 w-4" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xl">{item.name}</span>
        <span className="block text-base text-muted">{item.dose}</span>
      </span>
      {item.done_today && <Chip tone="mint" icon={<Check />}>Done</Chip>}
    </li>
  )
}

/** The daily check: two questions, asked once a day, before anything else on the screen. */
function DailyCheck({ onSubmit }: { onSubmit: (pain: number, newOrWorse: boolean) => void }) {
  const [pain, setPain] = useState<number | null>(null)
  const [worse, setWorse] = useState<boolean | null>(null)
  return (
    <Card>
      <h2 className="text-2xl">How is your shoulder today?</h2>
      <div className="mt-4">
        <NumberScale label="Pain right now" value={pain} onChange={setPain} leftAnchor="No pain" rightAnchor="Worst imaginable" />
      </div>
      <div className="mt-5">
        <div className="mb-2 font-bold">Anything new or worse since last time?</div>
        <div className="flex gap-3">
          <Button variant={worse === false ? 'primary' : 'secondary'} aria-pressed={worse === false} onClick={() => setWorse(false)}>No</Button>
          <Button variant={worse === true ? 'primary' : 'secondary'} aria-pressed={worse === true} onClick={() => setWorse(true)}>Yes</Button>
        </div>
      </div>
      <Button full className="mt-6" disabled={pain === null || worse === null} onClick={() => pain !== null && worse !== null && onSubmit(pain, worse)}>
        See today&apos;s plan
      </Button>
    </Card>
  )
}

/** Guided path · Today. The figure on the left, the day on the right: the goal it serves, the
 *  exercises, and one Start. No nav bar, no numbers to read — everything else lives behind the
 *  quiet Details link. Fits 1280 × 800 without scrolling. */
export function Today() {
  const nav = useNavigate()
  const { data: envelope } = useApi(() => api.profile())
  const profile: Profile | null = envelope?.profile ?? null
  const [plan, setPlan] = useState<TodayPlan | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [answered, setAnswered] = useState(false)
  const [newOrWorse, setNewOrWorse] = useState(false)

  const load = useCallback((pain?: number) => {
    api.planToday(pain)
      .then((p) => {
        setPlan(p)
        setPlanError(null)
      })
      .catch(() => setPlanError('I could not load today’s plan. The coach service may not be running.'))
  }, [])
  useEffect(() => load(), [load])

  const checkDue = !!profile && !isToday(profile.updated_at) && !answered
  const submitCheck = async (pain: number, worse: boolean) => {
    setNewOrWorse(worse)
    setAnswered(true)
    if (profile) await api.saveProfile({ side: profile.side, goal: profile.goal, pain }).catch(() => undefined)
    load(pain)
  }

  const items = plan?.items ?? []
  const next = items.find((i) => !i.done_today) ?? null
  const allDone = items.length > 0 && !next
  const name = getSession()?.user.name
  const tier = plan ? TIER_CHIP[plan.tier] : null

  return (
    <div className="grid h-screen grid-rows-[4rem_minmax(0,1fr)] overflow-hidden bg-bg text-ink">
      <header className="flex h-16 shrink-0 items-center gap-4 px-8">
        <span className="font-heading text-2xl font-semibold text-teal-ink">Praxis</span>
        <span className="text-base text-muted">{name ? `Good to see you, ${name}.` : 'Good to see you.'}</span>
      </header>

      <main className="grid min-h-0 grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-center gap-10 px-8 pb-6">
        <div className="mx-auto w-full max-w-[420px]">
          <AvatarPanel
            {...guidedAvatarProps(next?.id ?? items[0]?.id, next?.clip ?? items[0]?.clip, {
              camera: (next ?? items[0])?.view === 'front' ? 'front' : 'side',
              side: profile?.side ?? 'left',
              compact: true,
              aspect: '3/4',
            })}
          />
        </div>

        <div className="flex min-h-0 w-full max-w-[620px] flex-col gap-4 overflow-auto">
          <div>
            <h1 className="text-4xl">Today</h1>
            {plan && <p className="mt-1 text-xl text-muted">{plan.goal_line}</p>}
          </div>

          {planError && !plan && (
            <div role="alert">
              <Card tone="watch">
                <p className="text-xl">{planError}</p>
                <div className="mt-4"><Button onClick={() => load()}>Try again</Button></div>
              </Card>
            </div>
          )}

          {checkDue ? (
            <DailyCheck onSubmit={submitCheck} />
          ) : (
            plan && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  {tier && <Chip tone={tier.tone}>{tier.word}</Chip>}
                  <span className="text-base text-muted">{plan.tier_reason}</span>
                </div>

                {newOrWorse && (
                  <Card tone="watch">
                    <p className="text-lg">
                      You said something is new or worse. Keep today easy, stop if it hurts, and tell your therapist at your next visit.
                    </p>
                  </Card>
                )}

                {plan.tier === 'rest' ? (
                  <Card tone="watch">
                    <h2 className="text-2xl">No exercises today</h2>
                    <p className="mt-2 text-lg">{plan.rest_advice ?? 'Rest today. We will try again tomorrow.'}</p>
                  </Card>
                ) : (
                  <>
                    <Card padding="sm">
                      <ul>{items.map((i) => <Row key={i.id} item={i} />)}</ul>
                    </Card>
                    {allDone ? (
                      <Card tone="coach">
                        <p className="text-2xl">That is everything for today. Well done.</p>
                        <div className="mt-4">
                          <Button variant="secondary" onClick={() => nav(`/ready?exercise=${items[0].id}`)}>Practise again anyway</Button>
                        </div>
                      </Card>
                    ) : (
                      next && (
                        <Button full onClick={() => nav(`/ready?exercise=${next.id}`)}>
                          Start · {next.name}
                        </Button>
                      )
                    )}
                  </>
                )}
              </>
            )
          )}

          <div className="mt-auto pt-2"><DetailsLink /></div>
        </div>
      </main>
    </div>
  )
}

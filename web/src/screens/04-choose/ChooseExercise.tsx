import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { FlowBar } from '../../app/FlowBar'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Checkbox } from '../../design/Checkbox'
import { Chip, type ChipTone } from '../../design/Chip'
import { X } from '../../design/Icon'
import { Pill } from '../../design/Pill'
import { nextExercise, readDay, sideOr, syncCheckin, therapistLine, type Day } from '../../lib/day'
import { DAY_ORDER, TIER_TEXT, WEEKLY, doseFor, readCheckinPain, tierFor, type Tier } from '../../lib/plan'
import { DEFAULT_EQUIPMENT, EQUIPMENT, EXERCISES, type EquipmentId, type Exercise, type ExerciseId } from '../../lib/seed'
import { DayStrip } from './DayStrip'

/** Badge text always carries the meaning; the tone only repeats it. */
function badge(e: Exercise): { tone: ChipTone; text: string } {
  if (e.mode === 'demo') return { tone: 'neutral', text: 'Demo only · you tick it' }
  if (e.weekly) return { tone: 'neutral', text: 'Assessment' }
  return { tone: 'mint', text: 'Camera coached' }
}
const TIER_TONE: Record<Tier, ChipTone> = { full: 'mint', gentle: 'amber', rest: 'red' }

type Filter = 'today' | 'all' | 'equipment'
const EQUIPMENT_KEY = 'praxis.equipment'

function readEquipment(): EquipmentId[] {
  try {
    const raw = localStorage.getItem(EQUIPMENT_KEY)
    return raw ? (JSON.parse(raw) as EquipmentId[]) : DEFAULT_EQUIPMENT
  } catch {
    return DEFAULT_EQUIPMENT
  }
}

/** Centered sheet on the Radix Dialog: closes on Escape and on the overlay, always has a
 *  title and a description for assistive tech. */
function Sheet({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-scrim fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="ui-dialog fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(880px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[var(--r-card)] bg-surface p-8 text-ink shadow-[var(--shadow-2)]">
          <div className="flex items-start gap-3">
            <Dialog.Title className="text-3xl">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="link" className="ml-auto min-h-14 w-14 shrink-0 px-0" aria-label="Close" icon={<X />} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-muted">{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

type Time = '5' | '10'
type Pain = 'none' | 'some' | 'high'
type HasKit = 'yes' | 'no'

/** Rule-based pick from three answers, inside today's plan. Pain 7 or more is a rest day. */
function suggest(time: Time | null, pain: Pain | null, kit: HasKit | null): { pick: ExerciseId | null; why: string } {
  if (pain === 'high') return { pick: null, why: 'Pain at 7 or more is a rest day in your program. No exercises today. Tell the check-in, so your therapist can be told.' }
  if (!time || !pain || !kit) return { pick: null, why: 'Answer all three and Praxis will suggest one exercise from today’s plan.' }
  const care = pain === 'some' ? ' Pain 4–6 makes it a gentle day: fewer reps, shorter holds, no fast arcs.' : ''
  if (time === '10') return { pick: 'abduction', why: `Arm out to the side, then Waiter – cup: today’s order.${care}` }
  const pick: ExerciseId = kit === 'yes' ? 'cup' : 'abduction'
  const name = EXERCISES.find((e) => e.id === pick)?.name ?? pick
  return { pick, why: `${name}.${care}` }
}

/** Screen 04 · Choose exercise. The three exercises of the 28 Sep lock (`EXERCISES` holds only
 *  the visible ones) as one row of three cards at 1280 × 800 (review 28 Sep: the Exercises /
 *  Activities headings left half the screen empty), wrapping to two and one column on narrower
 *  screens. "Today's plan" is the day in order, then the weekly peg test, at the tier the check-in
 *  pain gives (0–3 full, 4–6 gentle, ≥ 7 rest). The service enforces the same tier when the
 *  session starts; this screen only shows it. Cards select on tap; the one primary action lives
 *  in the flow bar. Demo-only cards open the demonstration to watch and tick, never the camera.
 *
 *  Day flow (`lib/day.ts`): the tier and any stop come from today's check-in as the service
 *  answered it; the rest card says the therapist was told only when the service flagged it.
 *  Mid-day the next undone exercise is preselected and the day strip shows progress. */
export function ChooseExercise() {
  const nav = useNavigate()
  const [day, setDay] = useState<Day>(readDay)
  useEffect(() => {
    let alive = true
    void syncCheckin().then(() => alive && setDay(readDay()))
    return () => {
      alive = false
    }
  }, [])
  const pain = day.checkin?.pain ?? readCheckinPain()
  const tier = day.checkin?.tier ?? tierFor(pain)
  const [filter, setFilter] = useState<Filter>('today')
  const [selected, setSelected] = useState<ExerciseId>(() => nextExercise(readDay()) ?? DAY_ORDER[0])
  const [owned, setOwned] = useState<EquipmentId[]>(() => readEquipment())
  const [kitOpen, setKitOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [time, setTime] = useState<Time | null>(null)
  const [painAnswer, setPainAnswer] = useState<Pain | null>(null)
  const [kit, setKit] = useState<HasKit | null>(null)
  const side = day.checkin?.side ?? sideOr(null)

  // Today's plan is the day in order, then the weekly assessment (badged Weekly, never Today · n).
  const list = filter === 'today' ? [...DAY_ORDER, ...WEEKLY].map((id) => EXERCISES.find((e) => e.id === id)!) : filter === 'equipment' ? EXERCISES.filter((e) => e.needs.every((n) => owned.includes(n))) : EXERCISES
  const current = EXERCISES.find((e) => e.id === selected) ?? EXERCISES[0]
  const currentVisible = list.some((e) => e.id === selected)
  const rest = tier === 'rest' || day.stopped != null

  const saveOwned = (next: EquipmentId[]) => {
    setOwned(next)
    try {
      localStorage.setItem(EQUIPMENT_KEY, JSON.stringify(next))
    } catch {
      /* private mode */
    }
  }
  const begin = () => nav(current.mode === 'demo' ? `/details/demo?exercise=${current.id}&side=${side}` : `/details/setup?exercise=${current.id}&side=${side}`)
  const advice = suggest(time, painAnswer, kit)
  const usePick = () => {
    if (!advice.pick) return
    setSelected(advice.pick)
    if (!list.some((e) => e.id === advice.pick)) setFilter('all')
    setHelpOpen(false)
  }
  const openHelp = (o: boolean) => {
    setHelpOpen(o)
    if (o) {
      setTime(null)
      setPainAnswer(null)
      setKit(null)
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 p-6">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-4xl">Choose your exercise</h1>
            <p className="flex flex-wrap items-center gap-2 text-muted">
              <Chip tone={TIER_TONE[tier]}>{TIER_TEXT[tier].chip}</Chip>
              <span>{pain == null ? 'No check-in yet: showing your prescribed dose.' : `Pain ${pain} today: ${TIER_TEXT[tier].line}`}</span>
            </p>
            <DayStrip day={day} active={rest ? null : selected} className="mt-2" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill ariaLabel="Show" value={filter} onChange={setFilter} options={[{ value: 'today', label: "Today's plan" }, { value: 'all', label: 'All' }, { value: 'equipment', label: 'Equipment I have' }]} />
            {filter === 'equipment' && <Button variant="secondary" onClick={() => setKitOpen(true)}>What I have</Button>}
            <Button variant="secondary" onClick={() => openHelp(true)}>Help me choose</Button>
          </div>
        </div>

        {rest && (
          <Card tone="watch" as="div" className="mt-5">
            <p className="text-xl">
              {day.stopped === 'new_symptoms'
                ? "You told us something is new or worse. No exercises today, until your therapist has looked at it."
                : day.stopped === 'session'
                  ? "A stop rule ended today's practice. Rest the arm today."
                  : 'Rest the arm today. Nothing here will start until your pain is below 7.'}
              {day.checkin && day.stopped !== 'session' ? ` ${therapistLine(day.checkin)}` : ''}
            </p>
          </Card>
        )}
        {list.length === 0 && (
          <Card as="div" className="mt-5">
            <p className="text-xl">Nothing matches the equipment you have yet.</p>
            <Button variant="secondary" className="mt-3" onClick={() => setKitOpen(true)}>What I have</Button>
          </Card>
        )}
        {list.length > 0 && (
          <section aria-label="Your exercises" className="mt-5">
            <p className="text-lg text-muted">Camera coached: a rep counts only when the camera verifies it. The peg test is a weekly assessment.</p>
            {/* One row of three at 1280 × 800 (review 28 Sep); two, then one, as the screen narrows. */}
            <div data-testid="choose-cards" className="mt-3 grid auto-rows-fr grid-cols-3 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1">
              {list.map((e) => {
                const on = e.id === selected
                const order = DAY_ORDER.indexOf(e.id)
                const b = badge(e)
                const dose = rest ? e.dose : doseFor(e, tier)
                return (
                  <Card key={e.id} as="article" tone={on ? 'highlight' : 'default'} padding="none" className="flex flex-col">
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={`Select ${e.name}`}
                      aria-describedby={`choose-${e.id}-details`}
                      onClick={() => setSelected(e.id)}
                      className="flex min-h-14 flex-1 flex-col rounded-t-[var(--r-card)] p-5 text-left transition-colors hover:bg-tint-mint focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--focus)]/40"
                    >
                      <div className="flex w-full flex-wrap items-start justify-between gap-2">
                        <span className="text-base text-muted">{e.category}</span>
                        <span className="flex flex-wrap gap-2">
                          {order >= 0 && !rest && <Chip tone="focus">{`Today · ${order + 1}`}</Chip>}
                          {e.weekly && <Chip tone="focus">Weekly</Chip>}
                          <Chip tone={b.tone}>{b.text}</Chip>
                        </span>
                      </div>
                      <h3 className="mt-2 text-2xl">{e.name}</h3>
                      <div id={`choose-${e.id}-details`}>
                        <p className="mt-1">{e.equipment}</p>
                        <p>{dose}</p>
                        <p className="mt-1 text-muted">{e.note}</p>
                      </div>
                    </button>
                    <div className="px-5 pb-5">
                      <span className={`text-base font-bold ${on ? 'text-teal-ink' : 'text-muted'}`}>{on ? 'Selected' : 'Tap to select'}</span>
                    </div>
                  </Card>
                )
              })}
            </div>
          </section>
        )}
      </div>

      <FlowBar
        step={1}
        label="Choose"
        left={
          <>
            <span className="hidden self-center text-muted lg:inline">Level changes need your clinician.</span>
            <Button variant="secondary" onClick={() => nav('/details/checkin')}>Back</Button>
          </>
        }
        right={
          rest ? (
            <Button onClick={() => nav('/details')}>Back to Home</Button>
          ) : current.mode === 'demo' ? (
            <Button onClick={begin} disabled={!currentVisible}>Watch the demo</Button>
          ) : (
            <Button onClick={begin} disabled={!currentVisible}>Begin setup</Button>
          )
        }
      />

      <Sheet open={kitOpen} onOpenChange={setKitOpen} title="What I have" description="Tick what is within reach today. The list is kept on this device and drives the Equipment I have filter.">
        <div className="mt-4 grid grid-cols-2 gap-x-6">
          {EQUIPMENT.map((k) => (
            <Checkbox key={k.id} label={k.label} checked={owned.includes(k.id)} onChange={(v) => saveOwned(v ? [...owned, k.id] : owned.filter((o) => o !== k.id))} />
          ))}
        </div>
        <div className="mt-6 flex justify-end"><Button onClick={() => setKitOpen(false)}>Done</Button></div>
      </Sheet>

      <Sheet open={helpOpen} onOpenChange={openHelp} title="Help me choose" description="Three quick questions. The suggestion is rule-based and stays inside your assigned program.">
        <div className="mt-5 space-y-5">
          <div>
            <div className="mb-2 font-bold">How much time do you have?</div>
            <Pill ariaLabel="Time" value={time ?? ''} onChange={(v) => setTime(v as Time)} options={[{ value: '5', label: 'About 5 minutes' }, { value: '10', label: 'About 10 minutes' }]} />
          </div>
          <div>
            <div className="mb-2 font-bold">Any pain right now?</div>
            <Pill ariaLabel="Pain" value={painAnswer ?? ''} onChange={(v) => setPainAnswer(v as Pain)} options={[{ value: 'none', label: 'None (0–3)' }, { value: 'some', label: 'Some (4–6)' }, { value: 'high', label: '7 or more' }]} />
          </div>
          <div>
            <div className="mb-2 font-bold">Is the cup and the printed target sheet within reach?</div>
            <Pill ariaLabel="Equipment" value={kit ?? ''} onChange={(v) => setKit(v as HasKit)} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
          </div>
          <Card as="div" tone={advice.pick ? 'coach' : painAnswer === 'high' ? 'watch' : 'default'} padding="sm">
            <p className="text-xl">{advice.why}</p>
          </Card>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => openHelp(false)}>Cancel</Button>
          <Button onClick={usePick} disabled={!advice.pick}>Use this pick</Button>
        </div>
      </Sheet>
    </div>
  )
}

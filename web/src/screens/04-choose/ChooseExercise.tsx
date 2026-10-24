import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FlowBar } from '../../app/FlowBar'
import { arrowSelect } from '../../design/arrowKeys'
import { useReturnFocus } from '../../design/Overlay'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Checkbox } from '../../design/Checkbox'
import { X } from '../../design/Icon'
import { demoUrl, nextExercise, readDay, sideOr, syncCheckin, therapistLine, type Day } from '../../lib/day'
import { DAY_ORDER, WEEKLY, doseFor, readCheckinPain, tierFor } from '../../lib/plan'
import { DEFAULT_EQUIPMENT, EQUIPMENT, EXERCISES, exerciseById, libTags, type EquipmentId, type ExerciseId } from '../../lib/seed'
import { CoachChat } from '../coach/CoachChat'

type Filter = 'today' | 'all' | 'equipment'
const EQUIPMENT_KEY = 'praxis.equipment'
/** The artifact's labels. "All GRASP L2" stays verbatim (ruling R5: the seeded program is GRASP Level 2). */
const FILTERS: [Filter, string][] = [['today', 'Assigned'], ['all', 'All GRASP L2'], ['equipment', 'Equipment I have']]

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
  const returnFocus = useReturnFocus()
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-scrim fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content {...returnFocus} className="ui-dialog fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(880px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[var(--r-card)] bg-surface p-8 text-ink shadow-[var(--shadow-2)]">
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

/** Screen 04 · Exercise library (design v2, 6 Oct; artifact `ChooseExercise`). The three
 *  exercises of the 28 Sep lock as one row of cards, each with the artifact's eyebrow + tag and its
 *  own "Start session", which opens the demonstration first (D-FLOW: Choose → Demonstration →
 *  Check-in → Camera setup). The artifact's instructions-only cards (Block towers, Grip power,
 *  Box and Block Test) are dropped tasks and are not ported, nor is its unreachable "Help me choose".
 *
 *  The dose on each card is today's tier (check-in pain: 0–3 full, 4–6 gentle, ≥ 7 rest); the
 *  service enforces the same tier when the session starts. On a rest or stopped day every card
 *  says "Resting today" and the rest card says the therapist was told only when the service
 *  flagged it. `?next=<id>` (Home's "Run the peg test") preselects that card; otherwise the day's
 *  next undone exercise is selected. */
export function ChooseExercise() {
  const nav = useNavigate()
  const [sp] = useSearchParams()
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
  const [selected, setSelected] = useState<ExerciseId>(() => exerciseById(sp.get('next'))?.id ?? nextExercise(readDay()) ?? DAY_ORDER[0])
  const [owned, setOwned] = useState<EquipmentId[]>(() => readEquipment())
  const [kitOpen, setKitOpen] = useState(false)
  const [coachOpen, setCoachOpen] = useState(false)
  const side = day.checkin?.side ?? sideOr(null)

  // Assigned is the day in order, then the weekly assessment.
  const list = filter === 'today' ? [...DAY_ORDER, ...WEEKLY].map((id) => EXERCISES.find((e) => e.id === id)!) : filter === 'equipment' ? EXERCISES.filter((e) => e.needs.every((n) => owned.includes(n))) : EXERCISES
  const rest = tier === 'rest' || day.stopped != null

  const saveOwned = (next: EquipmentId[]) => {
    setOwned(next)
    try {
      localStorage.setItem(EQUIPMENT_KEY, JSON.stringify(next))
    } catch {
      /* private mode */
    }
  }
  const start = (id: ExerciseId) => {
    setSelected(id)
    nav(demoUrl(id, side))
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 p-6">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-4xl">Choose your exercise</h1>
            {/* The artifact's second clause ("the rest open reviewed instructions") named the
                instructions-only cards, which are not ported. */}
            <p className="lib-sub text-muted">Pick an exercise. The camera checks each rep.</p>
          </div>
          <div className="lib-head-right">
            <div role="radiogroup" aria-label="Show exercises" className="lib-filters" onKeyDown={arrowSelect}>
              {FILTERS.map(([v, t]) => (
                <button key={v} type="button" role="radio" aria-checked={filter === v} className="lib-filter" onClick={() => setFilter(v)}>
                  {t}
                </button>
              ))}
            </div>
            <Button variant="secondary" className="lib-coach" onClick={() => setCoachOpen(true)}>Ask the coach</Button>
          </div>
        </div>

        {rest && (
          <Card tone="watch" as="div" className="mt-5">
            <p className="text-xl">
              {day.stopped === 'new_symptoms'
                ? 'You told us something is new or worse. No exercises today, until your therapist has looked at it.'
                : day.stopped === 'session'
                  ? "A stop rule ended today's practice. Rest the arm today."
                  : 'Rest the arm today. Nothing here will start until your pain is below 7.'}
              {day.checkin && day.stopped !== 'session' ? ` ${therapistLine(day.checkin)}` : ''}
              <span className="lib-rest-more"> You can still watch the demos.</span>
              {day.stopped !== 'session' && (
                <>
                  <span className="lib-rest-more">{day.stopped === 'new_symptoms' ? ' Ticked that by mistake? ' : ' If your pain has eased, '}</span>
                  <button type="button" className="lib-rest-link" onClick={() => nav('/details/checkin')}>
                    {day.stopped === 'new_symptoms' ? 'Check in again' : 'check in again'}
                  </button>
                  .
                </>
              )}
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
            {/* One row of three at 1280 × 800 (review 28 Sep); two, then one, as the screen narrows. */}
            <div data-testid="choose-cards" className="mt-3 grid auto-rows-fr grid-cols-3 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1">
              {list.map((e) => {
                const on = e.id === selected
                const [eyebrow, tag] = libTags(e)
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
                      {/* No wrap (as the artifact's lib-body cards): the tag stays top-right without the fit engine's zoom. */}
                      <div className="flex w-full items-start justify-between gap-2">
                        <span className="lib-eyebrow">{eyebrow}</span>
                        <span className="lib-tag">{tag}</span>
                      </div>
                      <h2 className="mt-2 text-2xl">{e.name}</h2>
                      <div id={`choose-${e.id}-details`}>
                        <p className="mt-1">{e.equipment}</p>
                        <p>{dose}</p>
                        <p className="mt-1 text-muted">{e.note}</p>
                      </div>
                    </button>
                    <div className="lib-ctas">
                      {rest ? (
                        <span className="lib-rest">Resting today</span>
                      ) : (
                        <button type="button" className="lib-cta lib-cta-1" aria-label={`Start session: ${e.name}`} onClick={() => start(e.id)}>
                          Start session
                        </button>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          </section>
        )}
      </div>

      <FlowBar
        step={0}
        label="Exercise library"
        left={<span className="hidden self-center text-muted lg:inline">Level changes need your clinician.</span>}
        right={rest ? <Button onClick={() => nav('/details')}>Back to Home</Button> : null}
      />

      <Sheet open={kitOpen} onOpenChange={setKitOpen} title="What I have" description="Tick what is within reach today. The list is kept on this device and drives the Equipment I have filter.">
        <div className="mt-4 grid grid-cols-2 gap-x-6">
          {EQUIPMENT.map((k) => (
            <Checkbox key={k.id} label={k.label} checked={owned.includes(k.id)} onChange={(v) => saveOwned(v ? [...owned, k.id] : owned.filter((o) => o !== k.id))} />
          ))}
        </div>
        <div className="mt-6 flex justify-end"><Button onClick={() => setKitOpen(false)}>Done</Button></div>
      </Sheet>
      {/* Library coach (Task 7); kept by the v2 rewrite (ruling R1). */}
      <CoachChat
        open={coachOpen}
        onOpenChange={setCoachOpen}
        side={side}
        onBegin={(id) => {
          setCoachOpen(false)
          start(id as ExerciseId)
        }}
      />
    </div>
  )
}

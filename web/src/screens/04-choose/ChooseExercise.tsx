import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FlowBar } from '../../app/FlowBar'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { demoUrl, nextExercise, readDay, sideOr, syncCheckin, therapistLine, type Day } from '../../lib/day'
import { DAY_ORDER, WEEKLY, doseFor, readCheckinPain, tierFor } from '../../lib/plan'
import { EXERCISES, exerciseById, libTags, type ExerciseId } from '../../lib/seed'
import { CoachChat } from '../coach/CoachChat'

/** Screen 04 · Exercise library (design v2, 6 Oct; artifact `ChooseExercise`). The three
 *  exercises of the 28 Sep lock as one row of cards, each with the artifact's eyebrow + tag and its
 *  own "Start session", which opens the demonstration first (Choose → Demonstration →
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
  const [selected, setSelected] = useState<ExerciseId>(() => exerciseById(sp.get('next'))?.id ?? nextExercise(readDay()) ?? DAY_ORDER[0])
  const [coachOpen, setCoachOpen] = useState(false)
  const side = day.checkin?.side ?? sideOr(null)

  // 24 Oct: the three assigned exercises, the day in order then the weekly test. The All / Equipment
  // filters went: with only three exercises they showed the same cards and looked broken.
  const list = [...DAY_ORDER, ...WEEKLY].map((id) => EXERCISES.find((e) => e.id === id)!)
  const rest = tier === 'rest' || day.stopped != null

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
            <Button variant="secondary" className="lib-coach coach-btn" aria-haspopup="dialog" aria-expanded={coachOpen} onClick={() => setCoachOpen(true)}>Ask the coach</Button>
          </div>
        </div>

        {rest && (
          <Card tone="watch" as="div" className="mt-5">
            <p className="text-xl">
              {day.stopped === 'new_symptoms'
                ? 'You told us something is new or worse. No exercises today, until your therapist has looked at it.'
                : day.stopped === 'session'
                  ? "A stop rule ended today's practice. Rest the arm today."
                  : 'Rest the arm today; sessions stay closed.'}
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
                        <p className="mt-1">You need {e.equipment.charAt(0).toLowerCase() + e.equipment.slice(1)}.</p>
                        <p>{dose}</p>
                        <p className="mt-1 text-muted">{e.note}</p>
                      </div>
                    </button>
                    <div className="lib-ctas">
                      {/* 25 Oct team test: a rest day kept only the sheet link, so the demos the
                          banner offers could not be opened. The demo screen itself never starts a
                          session on a stopped day. */}
                      {rest ? (
                        <>
                          <button type="button" className="lib-cta lib-cta-1" aria-label={`Watch the demo: ${e.name}`} onClick={() => start(e.id)}>
                            Watch the demo
                          </button>
                          <span className="lib-rest">Resting today</span>
                        </>
                      ) : (
                        <button type="button" className="lib-cta lib-cta-1" aria-label={`Start session: ${e.name}`} onClick={() => start(e.id)}>
                          Start session
                        </button>
                      )}
                      {/* Shown on a rest day too, beside Watch the demo: Settings › Equipment and sheets opens this page. */}
                      {e.sheetPdf && (
                        <a className="lib-cta lib-cta-2 inline-flex items-center justify-center" href={e.sheetPdf} target="_blank" rel="noopener" aria-label={`Get the sheet (PDF): ${e.name}`}>
                          Get the sheet (PDF)
                        </a>
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
        right={rest ? <Button onClick={() => nav('/details')}>Back to Home</Button> : null}
      />

      {/* Library coach, kept by the design v2 rewrite. */}
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

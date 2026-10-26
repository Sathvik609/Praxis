import { Chip } from '../../design/Chip'
import { Check } from '../../design/Icon'
import { dayPlan, dayPosition, type Day } from '../../lib/day'
import { exerciseById, type ExerciseId } from '../../lib/seed'

/** "Today · 1 of 2 · Arm out to the side" plus one chip per exercise of today's run. Each chip
 *  says in words whether it is done or current (colour only repeats it). Extends the FlowBar
 *  step dots of screens 03–06 (no frame in wireframes v1.1). */
export function DayStrip({ day, active, className = '' }: { day: Day; active?: ExerciseId | null; className?: string }) {
  const plan = dayPlan(day)
  if (!day.checkin || day.stopped) return null
  const doneCount = plan.filter((id) => day.done.includes(id)).length
  const pos = active ? dayPosition(day, active) : null
  const activeName = active ? (exerciseById(active)?.name ?? active) : null
  const title = pos
    ? `Today · ${pos.index} of ${pos.total} · ${activeName}`
    : active
      ? `Weekly · ${activeName} · today ${doneCount} of ${plan.length || 4} done`
      : `Today · ${doneCount} of ${plan.length} done`
  return (
    <nav aria-label="Today's plan" className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${className}`}>
      <span className="text-lg font-bold" data-testid="day-title">{title}</span>
      {plan.length > 1 && (
        <ol className="flex flex-wrap gap-2">
          {plan.map((id) => {
            const name = exerciseById(id)?.name ?? id
            const done = day.done.includes(id)
            const now = id === active
            return (
              <li key={id}>
                <Chip tone={done ? 'mint' : now ? 'focus' : 'neutral'} icon={done ? <Check /> : undefined}>
                  {done ? `${name} · done` : now ? `${name} · now` : name}
                </Chip>
              </li>
            )
          })}
        </ol>
      )}
    </nav>
  )
}

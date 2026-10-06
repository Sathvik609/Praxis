import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { demoUrl, finishReport, nextExercise, type Day } from '../../lib/day'
import { exerciseById } from '../../lib/seed'
import { DayStrip } from '../04-choose/DayStrip'

/** Binds a report to today's run (`lib/day.ts` finishReport). Returns the day when this report
 *  is the one the day just produced, else null (an old report from history). Call it before any
 *  early return; pass undefined while the report is loading. */
export function useDayRun(reportId: string | undefined, mode: string | undefined, stopped: boolean | undefined): Day | null {
  // finishReport is idempotent per report id, so running it while rendering is safe (and
  // avoids a second render with the wrong primary button).
  return useMemo(() => (reportId ? finishReport(reportId, mode, !!stopped) : null), [reportId, mode, stopped])
}

/** Day block: progress strip and the one full-width primary — "Next: <exercise>" to that
 *  exercise's demonstration (today's check-in carries over), or "Done for today". A stop rule in
 *  the session ends the day here. The design v2 report (6 Oct) no longer renders it: its own
 *  `rp-day` card and Next practice "Start session" replace it (SessionReport.tsx). */
export function DayNext({ day }: { day: Day }) {
  const nav = useNavigate()
  const side = day.checkin?.side ?? 'left'
  const next = nextExercise(day)
  const nextName = next ? (exerciseById(next)?.name ?? next) : null
  return (
    <Card as="div" className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1">
        {day.stopped === 'session' ? (
          <p className="text-xl">A stop rule ended this session, so today's practice stops here. Rest the arm.</p>
        ) : (
          <>
            <DayStrip day={day} />
            <p className="mt-1 text-lg text-muted">{next ? "Demonstration next, then camera setup. Today's check-in carries over." : "That's everything for today."}</p>
          </>
        )}
      </div>
      <div className="w-full max-w-md">
        {next && nextName ? (
          <Button full onClick={() => nav(demoUrl(next, side))}>Next: {nextName}</Button>
        ) : (
          <Button full onClick={() => nav('/details')}>Done for today</Button>
        )}
      </div>
    </Card>
  )
}

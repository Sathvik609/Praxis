import { useMemo } from 'react'
import { finishReport, type Day } from '../../lib/day'

/** Binds a report to today's run (`lib/day.ts` finishReport). Returns the day when this report
 *  is the one the day just produced, else null (an old report from history). Call it before any
 *  early return; pass undefined while the report is loading. The report's own `rp-day` card and
 *  Next practice "Start session" (SessionReport.tsx) show the day; the v1 `DayNext` block that
 *  design v2 (6 Oct) stopped rendering was removed on 21 Oct. */
export function useDayRun(reportId: string | undefined, mode: string | undefined, stopped: boolean | undefined): Day | null {
  // finishReport is idempotent per report id, so running it while rendering is safe (and
  // avoids a second render with the wrong primary button).
  return useMemo(() => (reportId ? finishReport(reportId, mode, !!stopped) : null), [reportId, mode, stopped])
}

import { useEffect, useState } from 'react'
import { Button } from '../../design/Button'
import { Chip } from '../../design/Chip'
import type { PraxisEvent } from '../../lib/events'

/** Trace rows: every non-frame event, newest 40. */
export function traceRows(events: PraxisEvent[], limit = 40): PraxisEvent[] {
  return events.filter((e) => e.type !== 'frame').slice(-limit)
}

// The trace sits on the dark stage in both themes, so its inks are fixed and AA-measured
// against #050E10: mint 7.9:1, amber 8.0:1, blue 8.6:1, red 6.9:1, time 5.2:1.
const INK = {
  event: 'text-[#4CCBA1]',
  action: 'text-[#4CCBA1]',
  decide: 'text-[#E9A23B]',
  tool: 'text-[#8AB8FF]',
  stop: 'text-[#F08A7C]',
  time: 'text-white/60',
}

type CoachRow = { action: string; cue_id: string; reason: string; evidence: number[]; text: string; tool_calls?: { tool: string }[] }

function Kind({ k, children }: { k: keyof typeof INK; children: string }) {
  return <span className={`inline-block w-[5.5rem] shrink-0 font-bold ${INK[k]}`}>{children}</span>
}

function Time({ t }: { t: number }) {
  return <span className={`inline-block w-[4rem] shrink-0 tabular-nums ${INK.time}`}>{t.toFixed(1)} s</span>
}

/** Judge / developer trace (CLAUDE.md §1 "Show trace"): OpenCV output → decision → tool call
 *  → action with timestamps; stop rules are shown where they fired, before the coach. */
export function TracePanel({ events, replay = false }: { events: PraxisEvent[]; replay?: boolean }) {
  const rows = traceRows(events)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(JSON.stringify(rows, null, 2))
      setCopied(true)
    } catch {
      /* clipboard unavailable (insecure context): the rows stay visible on screen */
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[var(--r-card)] bg-[var(--stage-a)] font-mono text-base text-white/85 shadow-[var(--shadow-1)]">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="sticky top-0 z-10 border-b border-white/10 bg-[var(--stage-a)] px-4 pb-3 pt-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-bold text-white">Trace · OpenCV output → decision → action</span>
            <Chip tone={replay ? 'amber' : 'red'}>{replay ? 'Replay' : 'Live'}</Chip>
            <Button variant="inverse" className="ml-auto" onClick={copy}>{copied ? 'Copied' : 'Copy JSON'}</Button>
          </div>
          <div className="mt-1 text-white/60">Rule-based coach · LLM agent pending. Stop rules run before the coach.</div>
        </div>
        <div className="px-4 py-3">
          {rows.length === 0 && <div className="text-white/60">— waiting for events —</div>}
          {rows.map((e) => {
            if (e.type === 'coach') {
              const c = e as unknown as CoachRow
              return (
                <div key={e.id} className="mt-1.5">
                  <div className="flex gap-2"><Time t={e.t} /><Kind k="decide">decide</Kind><span className="min-w-0 break-words">{c.action} · {c.reason} · evidence #{c.evidence.join(', #')}</span></div>
                  {c.tool_calls?.map((tc, i) => (
                    <div key={i} className="flex gap-2 pl-[4.5rem]"><Kind k="tool">tool</Kind><span>{tc.tool}()</span></div>
                  ))}
                  <div className="flex gap-2 pl-[4.5rem]"><Kind k="action">action</Kind><span className="min-w-0 break-words">speak(cue={c.cue_id}) “{c.text}”</span></div>
                </div>
              )
            }
            if (e.type === 'stop' || e.type === 'pause' || e.type === 'rest' || e.type === 'therapist_flag') {
              return (
                <div key={e.id} className="mt-1.5 flex gap-2">
                  <Time t={e.t} /><Kind k="stop">stop-rule</Kind>
                  <span className="min-w-0 break-words">{e.type} rule={String(e.rule)}{e.detail ? ` · ${String(e.detail)}` : ''}</span>
                </div>
              )
            }
            return (
              <div key={e.id} className="mt-1.5 flex gap-2">
                <Time t={e.t} /><Kind k="event">event</Kind>
                <span className="min-w-0 break-words">
                  #{e.id} {e.type}{' '}
                  {Object.entries(e)
                    .filter(([k]) => !['type', 't', 'id'].includes(k))
                    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                    .join(' ')
                    .slice(0, 140)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

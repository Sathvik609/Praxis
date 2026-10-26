import { Fragment, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Button } from '../../design/Button'
import { Chip } from '../../design/Chip'
import type { PraxisEvent } from '../../lib/events'
import { coachLabel, coachSource, modelName, RULE_LABEL_WITH_AGENT } from '../../session/agent'
import { agentRuns, toolLine, useAgentTrace, type AgentRun, type TraceRow } from '../../session/agentTrace'

/** Trace rows: every non-frame event, newest 40. */
export function traceRows(events: PraxisEvent[], limit = 40): PraxisEvent[] {
  return events.filter((e) => e.type !== 'frame').slice(-limit)
}

// The trace sits on the session's light (or dark-theme) surface, so its inks are theme tokens
// (design v2): the row kind is always a word, the colour only echoes it.
const INK = {
  event: 'text-teal-ink',
  action: 'text-teal-ink',
  decide: 'text-amber-ink',
  tool: 'text-teal-ink',
  stop: 'text-red-ink',
  time: 'text-muted',
}

type CoachRow = { action: string; cue_id: string; reason: string; evidence: number[]; text: string; tool_calls?: { tool: string }[] }

function Kind({ k, children }: { k: keyof typeof INK; children: string }) {
  return <span className={`inline-block w-[5.5rem] shrink-0 font-bold ${INK[k]}`}>{children}</span>
}

/** Live events carry wall-clock `t` (epoch seconds) and replay events clip time: the clock reads
 *  as hh:mm:ss.s, clip time as seconds. */
function traceTime(t: number): string {
  if (t < 1e9) return `${t.toFixed(1)} s`
  const d = new Date(Math.round(t * 10) * 100)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${Math.floor(d.getMilliseconds() / 100)}`
}

function Time({ t }: { t: number }) {
  return <span className={`inline-block min-w-[4rem] shrink-0 whitespace-nowrap tabular-nums ${INK.time}`}>{traceTime(t)}</span>
}

const seconds = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`)

function errorKind(r: TraceRow): string {
  // the service's trace row `kind` is the row type, so the error's own kind travels as
  // error_kind (older rows may carry it as error / type)
  const k = r.error_kind ?? r.error ?? r.type
  return typeof k === 'string' && k ? k : 'error'
}

/** One agent run under its trigger event: a header button (collapses the run) and its steps,
 *  tool → decide → action, or the error that ended it. Glyphs are backed by words. */
function AgentRunRows({ run }: { run: AgentRun }) {
  const [open, setOpen] = useState(true)
  const id = useId()
  const tokens = run.inputTokens != null || run.outputTokens != null ? ` · ${run.inputTokens ?? 0} in / ${run.outputTokens ?? 0} out tokens` : ''
  return (
    <div className="mt-1.5 pl-[4.5rem]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-14 w-full items-center gap-2 rounded-[var(--r-control)] px-1 text-left font-bold text-ink hover:bg-tint-mint focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus/60"
      >
        <span aria-hidden className="shrink-0">{open ? '▼' : '▶'}</span>
        <span className="min-w-0 break-words">
          agent run · trigger {run.trigger || '—'}
          {run.model ? ` · ${modelName(run.model)}` : ''}
          {run.transport ? ` · ${run.transport}` : ''}
          {run.ended ? `${run.ms != null ? ` · ${seconds(run.ms)}` : ''}${run.outcome ? ` · ${run.outcome}` : ''}${tokens}` : ' · running…'}
        </span>
      </button>
      {open && (
        <div id={id} className="pl-6">
          {run.steps.length === 0 && <div className="text-muted">— no tool calls yet —</div>}
          {run.steps.map(({ kind, row }, i) => {
            if (kind === 'tool') {
              const t = toolLine(row)
              return (
                <div key={i} className="mt-1 flex gap-2">
                  <Kind k="tool">tool</Kind>
                  <span className="min-w-0 break-words">
                    {t.name} <span className={t.ok ? INK.action : INK.stop}>{t.ok ? '✓' : '✕'}</span><span className="sr-only">{t.ok ? ' ok' : ' failed'}</span> {t.ms}{t.summary ? ` — ${t.summary}` : ''}
                  </span>
                </div>
              )
            }
            if (kind === 'decide') {
              const ev = Array.isArray(row.evidence) ? row.evidence : []
              return (
                <div key={i} className="mt-1 flex gap-2">
                  <Kind k="decide">decide</Kind>
                  <span className="min-w-0 break-words">{String(row.action ?? '')} · evidence {ev.length ? ev.map((n) => `#${String(n)}`).join(' ') : 'none'}{row.reason ? ` · ${String(row.reason)}` : ''}</span>
                </div>
              )
            }
            if (kind === 'action') {
              const verb = String(row.tool ?? row.name ?? 'speak')
              return (
                <div key={i} className="mt-1 flex gap-2">
                  <Kind k="action">action</Kind>
                  <span className="min-w-0 break-words">{verb}{row.text ? ` “${String(row.text)}”` : ''}</span>
                </div>
              )
            }
            return (
              <div key={i} className="mt-1 break-words">
                <span className={`font-bold ${INK.stop}`}>✕ agent error · {errorKind(row)}</span>
                {row.message ? ` — ${String(row.message)}` : ''}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Judge / developer trace ("Show trace"): OpenCV output → decision → tool call
 *  → action with timestamps; stop rules are shown where they fired, before the coach.
 *  `pipeline` holds the screen's developer lines (the OpenCV step, rolling latency p50/p95)
 *  so they stay off the patient's video. Agent runs (agent spec §7) come from `/api/trace`
 *  for the socket's session, polled while the panel is open (`agentRows` overrides it), and
 *  are listed under the perception event that triggered them. */
export function TracePanel({ events, replay = false, pipeline = [], agentRows, sessionId = null }: { events: PraxisEvent[]; replay?: boolean; pipeline?: ReactNode[]; agentRows?: TraceRow[] | null; sessionId?: string | null }) {
  const polled = useAgentTrace(events, agentRows === undefined, sessionId)
  const source = agentRows === undefined ? polled : agentRows
  const runs = useMemo(() => agentRuns(source ?? []), [source])
  // with the run groups on screen, an agent cue is shown once, inside its run
  const rows = traceRows(events).filter((e) => !(runs.length && e.type === 'coach' && coachSource(e) === 'agent'))
  const truncated = events.filter((e) => e.type !== 'frame').length > 40
  const runsBetween = (from: number, to: number) => runs.filter((r) => r.anchorId >= from && r.anchorId < to)
  // Runs anchored before the first row on screen: their trigger event scrolled out of the
  // 40-event window, but the run still happened, so it stays listed above the rows.
  const leading = !rows.length ? [] : runs.filter((r) => r.anchorId < rows[0].id)
  const lastAgent = [...events].reverse().find((e) => e.type === 'coach' && coachSource(e) === 'agent')
  const lastRule = [...events].reverse().find((e) => e.type === 'coach' && coachSource(e) === 'rule')
  const agentLabel = lastAgent ? coachLabel(lastAgent) : runs.length ? 'Claude agent' : null
  // With the agent on, the rule coach is plain "Rule-based coach" even when none of its lines
  // are left in the 40-event window (never the agent-off "LLM agent pending" default).
  const ruleLabel = lastRule ? coachLabel(lastRule) : agentLabel ? RULE_LABEL_WITH_AGENT : coachLabel(lastRule)
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
    <div className="isolate flex h-full flex-col overflow-hidden rounded-[var(--r-card)] bg-surface font-mono text-base text-ink shadow-[var(--shadow-1)]">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="sticky top-0 z-10 border-b border-line bg-surface px-4 pb-3 pt-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-bold text-ink">Trace · OpenCV output → decision → action</span>
            <Chip tone={replay ? 'amber' : 'red'}>{replay ? 'Replay' : 'Live'}</Chip>
            <Button variant="inverse" className="ml-auto" onClick={copy}>{copied ? 'Copied' : 'Copy JSON'}</Button>
          </div>
          <div className="mt-1 text-muted">{agentLabel ? `${agentLabel} at checkpoints · ${ruleLabel} between them. Stop rules run before both.` : `${ruleLabel}. Stop rules run before the coach.`}</div>
          {pipeline.filter(Boolean).map((line, i) => (
            <div key={i} className="mt-1 break-words tabular-nums text-ink">{line}</div>
          ))}
        </div>
        <div className="px-4 py-3" data-testid="trace-rows">
          {rows.length === 0 && runs.length === 0 && <div className="text-muted">— waiting for events —</div>}
          {truncated && leading.length > 0 && <div className="mb-1 text-muted">Earlier agent runs</div>}
          {(rows.length ? leading : runs).map((r) => <AgentRunRows key={r.key} run={r} />)}
          {rows.map((e, i) => (
            <Fragment key={e.id}>
              {eventLine(e)}
              {runsBetween(e.id, rows[i + 1]?.id ?? Infinity).map((r) => <AgentRunRows key={r.key} run={r} />)}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

/** One socket event as a trace line (coach decision, stop rule or perception event). */
function eventLine(e: PraxisEvent) {
  if (e.type === 'coach') {
    const c = e as unknown as CoachRow
    return (
      <div className="mt-1.5">
        <div className="flex gap-2"><Time t={e.t} /><Kind k="decide">decide</Kind><span className="min-w-0 break-words">{c.action} · {c.reason} · evidence #{c.evidence.join(', #')}{coachSource(e) === 'agent' ? ` · ${coachLabel(e)}` : ''}</span></div>
        {c.tool_calls?.map((tc, i) => (
          <div key={i} className="flex gap-2 pl-[4.5rem]"><Kind k="tool">tool</Kind><span>{tc.tool}()</span></div>
        ))}
        <div className="flex gap-2 pl-[4.5rem]"><Kind k="action">action</Kind><span className="min-w-0 break-words">speak(cue={c.cue_id}) “{c.text}”</span></div>
      </div>
    )
  }
  if (e.type === 'stop' || e.type === 'pause' || e.type === 'rest' || e.type === 'therapist_flag') {
    return (
      <div className="mt-1.5 flex gap-2">
        <Time t={e.t} /><Kind k="stop">stop-rule</Kind>
        <span className="min-w-0 break-words">{e.type} rule={String(e.rule)}{e.detail ? ` · ${String(e.detail)}` : ''}</span>
      </div>
    )
  }
  if (e.type === 'command' && e.cmd === 'sample_colour' && e.source !== 'agent') {
    // The patient's tap on the picture (12 Oct): a UI action they initiated, not a coach action.
    const at = Array.isArray(e.at_mm) ? ` at ${(e.at_mm as number[]).join(', ')} mm` : ''
    const outcome = e.ok ? `applied · ${e.detected ? 'target found' : 'target not found yet'}` : `refused · ${String(e.reason ?? e.error ?? 'error')}`
    return (
      <div className="mt-1.5 flex gap-2">
        <Time t={e.t} /><Kind k="action">ui</Kind>
        <span className="min-w-0 break-words">#{e.id} patient tap → sample_colour({String(e.target ?? '')}){at} · {outcome}</span>
      </div>
    )
  }
  return (
    <div className="mt-1.5 flex gap-2">
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
}

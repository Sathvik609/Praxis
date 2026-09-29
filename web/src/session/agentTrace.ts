import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { PraxisEvent } from '../lib/events'

/** Agent rows of the decision trace (`/api/trace`, agent spec §7): `agent_run` start / end,
 *  the agent's `tool` calls, its `decide` / `action` rows and `agent_error`. Grouped per run
 *  and anchored to the perception event that triggered it, so the Show-trace panel can list
 *  each run under that event. */

export type TraceRow = Record<string, unknown>
export type RunStep = { kind: 'tool' | 'decide' | 'action' | 'agent_error'; row: TraceRow }
export type AgentRun = {
  key: string
  anchorId: number
  trigger: string
  model: string
  transport: string
  ended: boolean
  ms?: number
  inputTokens?: number
  outputTokens?: number
  outcome?: string
  steps: RunStep[]
}

export function isAgentRow(r: TraceRow): boolean {
  if (r.source === 'agent') return true
  if (typeof r.label === 'string' && r.label.startsWith('Claude agent')) return true
  // the rule coach's tool rows carry `tool`; the agent's carry `server` + `name`
  return r.kind === 'tool' && typeof r.server === 'string'
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

export function agentRuns(rows: TraceRow[]): AgentRun[] {
  const sorted = [...rows].sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
  const runs: AgentRun[] = []
  let open: AgentRun | null = null
  let lastEvent = 0
  const lastOfType = new Map<string, number>()
  for (const r of sorted) {
    const kind = String(r.kind)
    if (kind === 'event') {
      const id = Number(r.id)
      if (Number.isFinite(id)) {
        lastEvent = id
        lastOfType.set(String(r.type), id)
      }
      continue
    }
    if (kind === 'agent_run') {
      if (r.phase === 'start') {
        const trigger = String(r.trigger ?? '')
        const anchorId = lastOfType.get(trigger) ?? lastOfType.get(trigger.split(':')[0]) ?? lastEvent
        open = { key: `run-${String(r.seq)}`, anchorId, trigger, model: String(r.model ?? ''), transport: String(r.transport ?? ''), ended: false, steps: [] }
        runs.push(open)
      } else {
        const run = open ?? runs[runs.length - 1]
        if (run) Object.assign(run, { ended: true, ms: num(r.ms), inputTokens: num(r.input_tokens), outputTokens: num(r.output_tokens), outcome: r.outcome as string | undefined, transport: String(r.transport ?? run.transport) })
        open = null
      }
      continue
    }
    const step = kind === 'agent_error' ? 'agent_error' : (kind === 'tool' || kind === 'decide' || kind === 'action') && isAgentRow(r) ? kind : null
    if (!step) continue
    const run = open ?? runs[runs.length - 1]
    if (run) run.steps.push({ kind: step, row: r })
    else runs.push({ key: `err-${String(r.seq)}`, anchorId: lastEvent, trigger: '', model: '', transport: '', ended: true, steps: [{ kind: step, row: r }] })
  }
  return runs
}

export function toolLine(r: TraceRow): { name: string; ok: boolean; ms: string; summary: string } {
  const name = [r.server, r.name].filter((x) => typeof x === 'string' && x).join('.')
  return { name, ok: r.ok !== false, ms: typeof r.ms === 'number' ? `${Math.round(r.ms)} ms` : '', summary: typeof r.result_summary === 'string' ? r.result_summary : '' }
}

/** The session the socket is feeding (replay_start / command events carry it). */
export function sessionIdOf(events: PraxisEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const sid = events[i].session_id
    if (typeof sid === 'string' && sid) return sid
  }
  return null
}

export const TRACE_POLL_MS = 2000

/** Polls `/api/trace` for this session while the trace panel is open. No session id yet → no
 *  request (the service's default would be whichever session ran last). */
export function useAgentTrace(events: PraxisEvent[], enabled = true): TraceRow[] | null {
  // The socket window only holds the latest events, so the one that named the session
  // (replay_start / session_start) scrolls out: remember the id once seen.
  const [known, setKnown] = useState<string | null>(null)
  const found = sessionIdOf(events)
  if (found && found !== known) setKnown(found)
  const sid = found ?? known
  const [rows, setRows] = useState<TraceRow[] | null>(null)
  useEffect(() => {
    if (!enabled || !sid) return
    let alive = true
    const load = () =>
      api
        .trace(sid)
        .then((r) => alive && setRows(r.rows))
        .catch(() => {
          /* service unreachable: the panel keeps the socket's rows */
        })
    void load()
    const id = window.setInterval(load, TRACE_POLL_MS)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [sid, enabled])
  return enabled && sid ? rows : null
}

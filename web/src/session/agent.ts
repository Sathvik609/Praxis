import type { PraxisEvent } from '../lib/events'

/** Agent coach contract on the web side (see docs/AGENT.md). Pure helpers
 *  shared by the live screens, the trace panel and Settings; no React here. */

/** Label of the rule coach while no agent is configured; also what a legacy coach event with
 *  no label reads as. */
export const COACH_LABEL = 'Rule-based coach · LLM agent pending'

export type CoachSource = 'rule' | 'agent'
export type PromptKind = 'progression' | 'adjustment' | 'resume'
/** A proposal the service already clamped to the prescription's allowed adaptations. */
export type Proposal = { exercise: string; field: string; value: number | string; requested: number | string; clamped: boolean; unit: string }
export type Prompt = { id: string; kind?: PromptKind; title: string; text: string; options: string[]; within_prescription?: boolean; proposal?: Proposal }
export type AgentState = 'thinking' | 'idle' | 'offline'
export type AgentStatus = { state: AgentState; trigger?: string; reason?: string; label: string }
export type AgentMode = 'off' | 'anthropic' | 'scripted'
/** `/health` → `agent`. */
export type AgentHealth = { mode: AgentMode; model: string; mcp: boolean; ready: boolean; reason?: string }

type WithCoach = { source?: unknown; label?: unknown; [k: string]: unknown } | null | undefined

/** Legacy events (before the agent) carry no `source`: they are the rule coach. */
export function coachSource(e: WithCoach): CoachSource {
  return e?.source === 'agent' ? 'agent' : 'rule'
}

/** The rule coach's label while an agent is configured (service `RULE_LABEL_WITH_AGENT`). */
export const RULE_LABEL_WITH_AGENT = 'Rule-based coach'

/** Label for something the rule coach answers on its own (e.g. the "Ask the coach" chat), by the
 *  service's rule: "· LLM agent pending" only while `/health` says the agent is off (or the
 *  service cannot be asked); with an agent configured it is plain "Rule-based coach", which
 *  never claims the agent answered. */
export function ruleCoachLabel(h: AgentHealth | null | undefined): string {
  return h && h.mode !== 'off' ? RULE_LABEL_WITH_AGENT : COACH_LABEL
}

export function coachLabel(e: WithCoach): string {
  return typeof e?.label === 'string' && e.label ? e.label : COACH_LABEL
}

export function latestAgentStatus(events: PraxisEvent[]): AgentStatus | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type !== 'agent_status') continue
    const state = e.state === 'thinking' || e.state === 'offline' ? e.state : 'idle'
    return { state, trigger: e.trigger as string | undefined, reason: e.reason as string | undefined, label: String(e.label ?? '') }
  }
  return null
}

/** "claude-sonnet-5" → "Sonnet 5", "claude-haiku-5-5" → "Haiku 5.5"; dated ids read the same way. */
export function modelName(id: string | undefined | null): string {
  if (!id) return ''
  const m = /(opus|sonnet|haiku|fable)-(\d+(?:[-.]\d+)?)/i.exec(id)
  if (!m) return id
  const version = m[2].replace('-', '.')
  // "4-5-20251001": the second group is a date, not a minor version
  const clean = /^\d+\.\d{3,}$/.test(version) ? version.split('.')[0] : version
  return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${clean}`
}

/** The "Why?" option keeps a prompt open and asks the coach for its reason. */
export const isWhy = (option: string) => /^why\b/i.test(option.trim())

/** The progression prompt predates `kind`; anything else unnamed is an adjustment. */
export function promptKind(p: Prompt): PromptKind {
  if (p.kind) return p.kind
  return p.id === 'progression' ? 'progression' : 'adjustment'
}

const FIELD_NAME: Record<string, string> = { target_deg: 'Target', hold_s: 'Hold', reps: 'Reps per set', phase: 'Pace' }

function withUnit(v: number | string, unit: string): string {
  if (!unit) return String(v)
  return unit === '°' ? `${v}°` : `${v} ${unit}`
}

/** "Target 90° → 75° (your program allows 60–90°)". `from` is the running value and `range`
 *  the prescription's allowed adaptation; either may be unknown. */
export function describeProposal(p: Proposal, ctx: { from?: number | string | null; range?: [number, number] | null }): string {
  const name = FIELD_NAME[p.field] ?? p.field.replace(/_/g, ' ')
  const arrow = ctx.from != null && ctx.from !== '' ? `${withUnit(ctx.from, p.unit)} → ` : '→ '
  const range = ctx.range ? ` (your program allows ${ctx.range[0]}–${withUnit(ctx.range[1], p.unit)})` : ''
  return `${name} ${arrow}${withUnit(p.value, p.unit)}${range}${p.clamped ? ' · adjusted to your program’s limit' : ''}`
}

type ProgramLike = { exercises?: Record<string, Record<string, unknown>>; allowed_adaptations?: Record<string, Record<string, unknown>> } | null | undefined

/** Where "from" and the allowed range come from: the running value the screen knows (e.g. the
 *  arm frame's target), else the prescribed value; the range is the prescription's allowed
 *  adaptation when it is a numeric pair. */
export function proposalContext(p: Proposal, program: ProgramLike, running: Record<string, number | string | null | undefined> = {}): { from: number | string | null; range: [number, number] | null } {
  const prescribed = program?.exercises?.[p.exercise]?.[p.field]
  const run = running[p.field]
  const from = run != null ? run : typeof prescribed === 'number' || typeof prescribed === 'string' ? prescribed : null
  const allowed = program?.allowed_adaptations?.[p.exercise]?.[p.field]
  const range = Array.isArray(allowed) && allowed.length === 2 && allowed.every((v) => typeof v === 'number') ? ([allowed[0], allowed[1]] as [number, number]) : null
  return { from, range }
}

/** Settings > Coach. */
export function healthLines(h: AgentHealth | null | undefined): { title: string; details: string[] } {
  if (!h || h.mode === 'off') return { title: 'Rule-based coach (AI agent off)', details: [] }
  const model = modelName(h.model) || h.model
  const title =
    h.mode === 'scripted' ? 'Scripted agent (test) — no model calls' : `Claude ${model} via Anthropic API`
  const details = [h.mcp ? 'MCP tools connected' : 'Tools called directly (MCP not connected)']
  if (!h.ready) details.push(`Not ready${h.reason ? `: ${h.reason}` : ''} · the rule-based coach runs`)
  return { title, details }
}

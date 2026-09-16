import type { PraxisEvent } from '../../lib/events'

/** Judge / developer trace: raw perception events for now; decision → action lines join in
 *  Phase 7 when the coach lands. */
export function TracePanel({ events }: { events: PraxisEvent[] }) {
  const rows = events.filter((e) => e.type !== 'frame').slice(-40)
  return (
    <div className="h-full overflow-auto rounded-2xl bg-[var(--stage-a)] p-4 font-mono text-sm text-white/85">
      <div className="mb-2 font-bold text-mint">Judge / developer trace · perception → decision → action</div>
      <div className="mb-2 text-white/50">Rule-based coach · LLM agent pending. Stop rules run before the coach.</div>
      {rows.length === 0 && <div className="text-white/50">— waiting for events —</div>}
      {rows.map((e) => {
        if (e.type === 'coach') {
          const c = e as unknown as { action: string; cue_id: string; reason: string; evidence: number[]; text: string; tool_calls?: { tool: string }[] }
          return (
            <div key={e.id} className="mt-1">
              <div><span className="text-white/50">{e.t.toFixed(1)}</span> <span className="text-amber">decide</span> {c.action} · {c.reason} · evidence #{c.evidence.join(',#')}</div>
              {c.tool_calls?.map((tc, i) => <div key={i} className="pl-12"><span className="text-[#7FB4FF]">tool</span> {tc.tool}()</div>)}
              <div className="pl-12"><span className="text-mint">action</span> speak(cue={c.cue_id}) “{c.text}”</div>
            </div>
          )
        }
        if (e.type === 'stop' || e.type === 'pause' || e.type === 'rest' || e.type === 'therapist_flag') {
          return <div key={e.id}><span className="text-white/50">{e.t.toFixed(1)}</span> <span className="text-red">stop-rule</span> {e.type} rule={String(e.rule)} {e.detail ? String(e.detail) : ''}</div>
        }
        return (
          <div key={e.id}>
            <span className="text-white/50">{e.t.toFixed(1)}</span>{' '}
            <span className="text-mint">event</span> #{e.id} {e.type}{' '}
            {Object.entries(e)
              .filter(([k]) => !['type', 't', 'id'].includes(k))
              .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
              .join(' ')
              .slice(0, 140)}
          </div>
        )
      })}
    </div>
  )
}

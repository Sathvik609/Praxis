import type { PraxisEvent } from '../../lib/events'

/** Judge / developer trace: raw perception events for now; decision → action lines join in
 *  Phase 7 when the coach lands. */
export function TracePanel({ events }: { events: PraxisEvent[] }) {
  const rows = events.filter((e) => e.type !== 'frame').slice(-40)
  return (
    <div className="h-full overflow-auto rounded-2xl bg-[var(--stage-a)] p-4 font-mono text-sm text-white/85">
      <div className="mb-2 font-bold text-mint">Judge / developer trace · perception → decision → action</div>
      <div className="mb-2 text-white/50">Coach decisions appear here from Phase 7. Rule-based coach · LLM agent pending.</div>
      {rows.length === 0 && <div className="text-white/50">— waiting for events —</div>}
      {rows.map((e) => (
        <div key={e.id}>
          <span className="text-white/50">{e.t.toFixed(1)}</span>{' '}
          <span className="text-mint">event</span> {e.type}{' '}
          {Object.entries(e)
            .filter(([k]) => !['type', 't', 'id'].includes(k))
            .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
            .join(' ')
            .slice(0, 160)}
        </div>
      ))}
    </div>
  )
}

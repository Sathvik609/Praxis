import type { AreaEmpty, AreaKey, AreaView } from '../../lib/areaSummary'
import { RangeRing } from './RangeRing'

const ACCENT: Record<AreaKey, string> = { lShoulder: 'sh', lElbow: 'el', lWrist: 'ha' }

/** Over the stage: the area's headline measure (left) and two quality tiles (right rail)
 *  (designers' `StageMinis`, 6 Oct; their leader-line loop drew to a ref that was never
 *  attached, so it is not ported). Values come from `areaSummary`. */
export function StageMinis({ k, name, view }: { k: AreaKey; name: string; view: AreaView | AreaEmpty }) {
  const v = 'name' in view ? view : null
  const now = v?.now
  return (
    <div className={`mn mn-${ACCENT[k]}`} aria-label={`${name} at a glance`}>
      <div className="mn-l">
        <span className="mn-k">
          <i aria-hidden />
          {name}
        </span>
        {now && <span className="mn-cl">{now.label}</span>}
        {!now?.ring && (
          <b className="mn-v">
            {now ? `${now.value}${now.unit === '°' ? '°' : ''}` : '—'}
            {now?.unit && now.unit !== '°' && <small>{` ${now.unit}`}</small>}
          </b>
        )}
        <span className="mn-c">{now ? now.caption : v ? v.empty : view.empty}</span>
        {now?.ring && (
          <div className="mn-ring">
            <RangeRing now={now.ring.now} max={now.ring.max} />
          </div>
        )}
      </div>
      {v && (
        <div className="mn-r">
          {v.quality.slice(0, 2).map((q) => (
            <div key={q.k} className="mn-q">
              <span className="mn-ql">{q.k}</span>
              <b className={`mn-qv${/^\d/.test(q.v) ? '' : ' mn-qv-word'}`}>
                {q.v}
                {q.u && <small>{` ${q.u}`}</small>}
              </b>
              <span className="mn-c">{q.c}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

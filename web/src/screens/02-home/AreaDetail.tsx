import type { AreaEmpty, AreaKey, AreaView } from '../../lib/areaSummary'
import { countOf } from '../../lib/plural'
import { AREA_ICON } from './areaIcons'
import { RangeRing } from './RangeRing'
import { TrendChart } from './TrendChart'

type Head = { name: string; word: string; headline: string }

/** The focused area's card (designers' `AreaDetail2`, 6 Oct): header with the status word, the
 *  "now" number + ring, trend, everyday goal, two tiles, program. Every value is from
 *  `areaSummary`; an area nothing measures says so instead. The goal is the patient's single
 *  goal and attempts count (no therapist ladder exists to draw). */
export function AreaDetail({ k, head, view, goal, onGo }: { k: AreaKey; head: Head; view: AreaView | AreaEmpty; goal: { text: string | null; attempts: number }; onGo: (to: string) => void }) {
  const v = 'name' in view ? view : null
  return (
    // the panel of Home's "Affected areas" tabs; not a live region (a tab change would read the
    // whole card), the selected tab says which area it shows
    <section key={k} id="area-panel" role="tabpanel" className={`ad-card ad2 ad-${k}`} aria-label={`${head.name} details`}>
      <header className="ad-head">
        <span className="ad-ico" aria-hidden>
          <svg viewBox="0 0 24 24">
            <path d={AREA_ICON[k]} />
          </svg>
        </span>
        <div className="ad-titles">
          <span className="ad-name">{head.name}</span>
          <h2 className="ad-title">{head.headline}</h2>
        </div>
        <span className="ad-status">{head.word}</span>
      </header>
      <div className="ad-now">
        <div className="ad-now-t">
          <b>
            {v?.now ? `${v.now.value}${v.now.unit === '°' ? '°' : ''}` : '—'}
            {v?.now && v.now.unit && v.now.unit !== '°' && <small>{` ${v.now.unit}`}</small>}
          </b>
          <span>{v ? (v.now?.detail ?? v.empty) : view.empty}</span>
        </div>
        {v?.now?.ring && (
          <div className="ad-now-g">
            <RangeRing now={v.now.ring.now} max={v.now.ring.max} />
          </div>
        )}
      </div>
      {v?.trend && <TrendChart t={v.trend} />}
      {v && (
        <div className="ad-steps">
          <span className="ad-lbl">Everyday goal</span>
          <p className="text-sm font-semibold">{goal.text ?? 'No goal set yet · set one with your therapist.'}</p>
          <p className="text-xs text-muted">{countOf(goal.attempts, 'attempt')} logged this week</p>
        </div>
      )}
      {v && (
        <div className="ad-tiles">
          {v.tiles.map((t) => (
            <div key={t.k} className="ad-tile">
              <span className="ad-lbl">{t.k}</span>
              <b>
                {t.v}
                {t.u && <small>{` ${t.u}`}</small>}
              </b>
            </div>
          ))}
        </div>
      )}
      {v && v.program.length > 0 && (
        <div className="ad-prog">
          <span className="ad-lbl">In your program</span>
          <ul>
            {v.program.map((p) => (
              <li key={p.id}>
                <button type="button" className="ad-item" onClick={() => onGo(p.to)}>
                  <span>{p.name}</span>
                  <span className="ad-tag">{p.tag}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

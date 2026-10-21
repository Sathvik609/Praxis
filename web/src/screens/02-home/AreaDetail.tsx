import type { AreaEmpty, AreaKey, AreaView } from '../../lib/areaSummary'
import { AREA_ICON } from './areaIcons'
import { RangeRing } from './RangeRing'

type Head = { name: string; word: string; headline: string }

/** The focused area's card (designers' `AreaDetail2`, 6 Oct): header with the status word, the
 *  "now" number + ring and two tiles. Every value is from `areaSummary`; an area nothing
 *  measures says so instead. Design review 21 Oct removed the trend line, the everyday goal
 *  (the camera only sees in-session activity) and the "In your program" list (the stage's
 *  primary action already opens the area's exercise); the tiles take the freed height. */
export function AreaDetail({ k, head, view }: { k: AreaKey; head: Head; view: AreaView | AreaEmpty }) {
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
      {v && (
        <div className="ad-tiles flex-1 auto-rows-fr grid-cols-1!">
          {v.tiles.map((t) => (
            <div key={t.k} className="ad-tile justify-center">
              <span className="ad-lbl">{t.k}</span>
              <b>
                {t.v}
                {t.u && <small>{` ${t.u}`}</small>}
              </b>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

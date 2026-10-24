import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AvatarPanel, type Hotspot } from '../../avatar/AvatarPanel'
import { Button } from '../../design/Button'
import { arrowSelect } from '../../design/arrowKeys'
import { Card } from '../../design/Card'
import { Chip } from '../../design/Chip'
import { Check, ZoomIn, ZoomOut } from '../../design/Icon'
import { api, isReplaySession, useApi } from '../../lib/api'
import { STATUS_WORD, areaSummary, type AreaKey } from '../../lib/areaSummary'
import { WEEKDAYS } from '../../lib/calendar'
import { DAY_MINUTES, DAY_ORDER } from '../../lib/plan'
import { prefersReducedMotion } from '../../lib/motion'
import { plural } from '../../lib/plural'
import { REGIONS, exerciseById, type ExerciseId } from '../../lib/seed'
import { demoUrl, readSide } from '../../lib/day'
import { CoachChat } from '../coach/CoachChat'
import { AreaDetail } from './AreaDetail'
import { StageMinis } from './StageMinis'

const ZOOMS = [1, 1.25, 1.5]
const AR_ORDER: AreaKey[] = ['lShoulder', 'lElbow', 'lWrist']

/** Screen 02 · Home (design v2, designers' 6 Oct artifact). Next practice, this week from
 *  `/api/calendar`, and the affected-areas card: tabs + body-map hotspots pick an area; the
 *  stage tiles and the area card are derived from stored sessions, progress, the prescription
 *  and the calendar (`lib/areaSummary.ts`). Nothing is a composite score; sample values carry
 *  a visible "Sample" chip; an area nothing measures says so. */
export function Home() {
  const nav = useNavigate()
  const [zoomIdx, setZoomIdx] = useState(1)
  const [focus, setFocus] = useState<AreaKey>('lShoulder')
  const [reducedMotion] = useState(prefersReducedMotion) // the idle figure stays still
  const [coachOpen, setCoachOpen] = useState(false)
  const region = REGIONS[focus]
  const { data: me } = useApi(() => api.me())
  const { data: sessions } = useApi(() => api.sessions())
  const { data: progress } = useApi(() => api.progress())
  const { data: rx } = useApi(() => api.prescription())
  const { data: calendar } = useApi(() => api.calendar())
  const view = areaSummary(focus, { sessions, progress, rx, calendar, me })
  const area = 'name' in view ? view : null
  const headline = area?.headline ?? 'Nothing measured here'
  const hotspots: Hotspot[] = AR_ORDER.map((k) => ({ key: k, joint: k, status: REGIONS[k].status, label: REGIONS[k].title, word: STATUS_WORD[REGIONS[k].status] }))
  const week = calendar ? calendar.days.filter((d) => d.date >= calendar.week.from && d.date <= calendar.week.to) : []
  const openReport = () => nav(sessions?.[0] ? `/report/${sessions[0].id}` : '/details/progress')
  const pickArea = (k: string) => {
    if (k === 'lShoulder' || k === 'lElbow' || k === 'lWrist') setFocus(k)
  }

  return (
    <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1.1fr)] gap-5 p-5">
      <div className="flex flex-col gap-4">
        <Card tone="brand" className="p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-white/80">Your practice</div>
            {/* 24 Oct: where a first-time visitor starts. Said in words; the ring on the button only repeats it. */}
            <span className="start-here-tag"><span className="start-here-arrow" aria-hidden="true">↓</span>Start here</span>
          </div>
          <h1 className="text-3xl text-white">{DAY_ORDER.map((id) => exerciseById(id)?.name ?? id).join(' + ')}</h1>
          <p className="mt-1 text-white/80">About {DAY_MINUTES} min · you need a cup and the printed target sheet</p>
          <Button full variant="inverse" className="mt-5 start-here" onClick={() => nav('/details/choose')}>Start session</Button>
          <Button full variant="secondary" className="mt-3 hero-coach" onClick={() => setCoachOpen(true)}>Ask the coach</Button>
          <p className="start-here-hint mt-3">Each step tells you what to do next. You can also explore the platform from the menu on the left.</p>
        </Card>

        <Card className="wk-card" title="This week" action={week.some((d) => d.sample) ? <Chip tone="neutral">Sample history</Chip> : undefined}>
          <div className="text-muted">{calendar ? `${calendar.week.done_days} ${plural(calendar.week.done_days, 'day')} · ${calendar.week.minutes_done} min` : '—'}</div>
          <div className="mt-3 grid grid-cols-7 gap-1.5">
            {week.map((d) => {
              const done = d.status === 'done'
              const today = d.is_today
              const letter = WEEKDAYS[d.weekday][0]
              return (
                <div key={d.date} className="flex min-w-0 flex-col items-center gap-1">
                  <span className="text-base text-muted">{letter}</span>
                  <span role="img" aria-label={done ? `${letter}: done` : today ? `${letter}: today` : `${letter}: not yet`} className={`wk-day ${done ? 'wk-done' : today ? 'wk-today' : 'wk-todo'}`}>
                    {done ? <Check aria-hidden className="h-5 w-5" strokeWidth={3} /> : today ? 'now' : '·'}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
            <span className="text-muted">{sessions?.[0] ? `Last session · ${sessions[0].summary.camera.verified ?? 0} verified · ${sessions[0].title}${isReplaySession(sessions[0]) ? ' · replay' : ''}` : 'No sessions yet'}</span>
            {/* 24 Oct: no report to open before the first session */}
            {sessions?.[0] && <Button variant="secondary" className="shrink-0" onClick={openReport}>Open report</Button>}
          </div>
        </Card>
      </div>

      <Card className="hp-card">
        <div className="hp-head">
          <div className="min-w-0">
            <h2 className="text-2xl">Your affected areas</h2>
            <p className="text-muted">Tap an area to see what the camera has measured.</p>
          </div>
          {/* Visible to patients, not only in Judge view: a sample value is never shown unlabelled. */}
          {area?.sample && <span className="hp-sample">Sample</span>}
          <div className="hp-zoom flex shrink-0 gap-2">
            <Button variant="inverse" className="w-12 px-0!" aria-label="Zoom in" disabled={zoomIdx === ZOOMS.length - 1} icon={<ZoomIn />} onClick={() => setZoomIdx((i) => Math.min(ZOOMS.length - 1, i + 1))} />
            <Button variant="inverse" className="w-12 px-0!" aria-label="Zoom out" disabled={zoomIdx === 0} icon={<ZoomOut />} onClick={() => setZoomIdx((i) => Math.max(0, i - 1))} />
          </div>
        </div>
        <div className="hp-tabs" role="tablist" aria-label="Affected areas" onKeyDown={arrowSelect}>
          {AR_ORDER.map((k) => {
            const r = REGIONS[k]
            const on = k === focus
            return (
              <button key={k} type="button" role="tab" aria-selected={on} aria-controls="area-panel" className={`hp-tab ${on ? 'hp-tab-on' : ''}`} onClick={() => setFocus(k)}>
                <span className={`hp-dot hp-dot-${r.status}`} aria-hidden />
                <span>{r.title}</span>
                <span className={`hp-st hp-st-${r.status}`}>{STATUS_WORD[r.status]}</span>
              </button>
            )
          })}
        </div>
        <div className="hp-stage relative">
          <AvatarPanel clip="idle" autoplay={!reducedMotion} camera="front" markers={[]} hotspots={hotspots} hotActive={focus} onHot={pickArea} compact showCues zoom={ZOOMS[zoomIdx]} overlayTop={64} />
          <StageMinis k={focus} name={region.title} view={view} />
        </div>
        <div className="hp-actions">
          <button type="button" className="lib-cta lib-cta-2" onClick={() => nav('/details/progress')}>See all progress</button>
          <button type="button" className="lib-cta lib-cta-1" onClick={() => nav(region.primary.to)}>{region.primary.label}</button>
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        <AreaDetail k={focus} head={{ name: region.title, word: STATUS_WORD[region.status], headline }} view={view} />
      </div>
      <CoachChat
        open={coachOpen}
        onOpenChange={setCoachOpen}
        side={readSide() ?? 'left'}
        onBegin={(id) => {
          setCoachOpen(false)
          nav(demoUrl(id as ExerciseId, readSide() ?? 'left'))
        }}
      />
    </div>
  )
}

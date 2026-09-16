import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AvatarPanel } from '../../avatar/AvatarPanel'
import { Button } from '../../design/Button'
import { Chip, type ChipTone } from '../../design/Chip'
import { HOME_MARKERS, PATIENT, PROGRAM, REGIONS, WEEK } from '../../lib/seed'

const tone: Record<string, ChipTone> = { focus: 'focus', watch: 'amber', stable: 'mint' }
const word: Record<string, string> = { focus: 'Focus', watch: 'Watch', stable: 'Stable' }

/** Screen 02 · Home. The avatar body map sets the hierarchy; markers come from the
 *  prescription and camera metrics. No diagnosis, no composite score. Data is illustrative
 *  (lib/seed.ts) until the store lands in Phase 8. */
export function Home() {
  const nav = useNavigate()
  const [view, setView] = useState<'front' | 'side' | 'both'>('side')
  const [focus, setFocus] = useState<string>('lWrist')
  const region = REGIONS[focus]

  return (
    <div className="grid grid-cols-[1fr_2fr_1fr] gap-6 p-6">
      <div className="flex flex-col gap-4">
        <div className="rounded-3xl bg-teal p-6 text-white">
          <div className="text-white/80">Next practice · today</div>
          <h1 className="text-3xl text-white">Waiter – cup, then Arm to the front</h1>
          <p className="mt-1 text-white/80">About 14 min · cup + target sheet · wrist weight</p>
          <Button full variant="inverse" className="mt-5" onClick={() => nav('/checkin')}>Start session</Button>
          <button type="button" className="mt-3 min-h-14 w-full rounded-2xl border-2 border-white/60 text-xl font-bold text-white" onClick={() => nav('/coach')}>Ask the coach</button>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-baseline justify-between"><h2 className="text-2xl">This week</h2><span className="text-muted">{WEEK.sessions} days · {WEEK.minutes} min</span></div>
          <div className="mt-3 flex gap-2">
            {WEEK.days.map((d, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <span className="text-xs text-muted">{d}</span>
                <span className={`flex h-10 w-10 items-center justify-center rounded-lg font-bold ${WEEK.done[i] ? 'bg-mint text-white' : i === WEEK.todayIndex ? 'bg-mint/15 text-teal' : 'bg-bg text-muted'}`}>{WEEK.done[i] ? '✓' : i === WEEK.todayIndex ? 'now' : '·'}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-muted">
            <span>Last session · {WEEK.lastSession}</span>
            <button type="button" className="min-h-9 font-bold text-teal" onClick={() => nav('/progress')}>Open report</button>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-2xl">Your everyday goal</h2>
          <p className="text-lg">{PATIENT.goal}</p>
          <p className="text-muted">{PATIENT.goalAttempts} attempts logged this week</p>
          <div className="mt-3 flex gap-3">
            <Button variant="secondary" className="min-h-12 text-base">Log an attempt</Button>
            <Button variant="secondary" className="min-h-12 text-base">Edit goal</Button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-start gap-4">
          <div>
            <h2 className="text-2xl">Your arm and hand</h2>
            <p className="text-muted">Tap a marker for what your program covers there · <span className="text-[#1F4E9E]">● Focus</span> <span className="text-amber">● Watch</span> <span className="text-teal">● Stable</span></p>
          </div>
          <div className="ml-auto flex gap-1 rounded-full border border-line p-1">
            {(['front', 'side', 'both'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`h-11 rounded-full px-4 font-bold ${view === v ? 'bg-teal text-white' : ''}`}>
                {v === 'front' ? 'Front' : v === 'side' ? 'Left side' : 'Both'}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <AvatarPanel clip="idle" camera={view === 'front' ? 'front' : 'side'} markers={HOME_MARKERS} onMarkerTap={(m) => setFocus(m.joint)} compact showCues={false} />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border-2 border-teal bg-surface p-5">
          <div className="flex items-start justify-between">
            <div><h2 className="text-2xl">{region.title}</h2><p className="text-muted">{region.setBy}</p></div>
            <Chip tone={tone[region.status]}>{word[region.status]}</Chip>
          </div>
          <div className="mt-4 space-y-3">
            {region.metrics.map((m) => (
              <div key={m.label} className="flex items-baseline gap-3">
                <span className="text-3xl font-bold">{m.value}</span>
                <span className="text-muted">{m.label}</span>
                {m.delta && <Chip tone="mint">{m.delta}</Chip>}
              </div>
            ))}
          </div>
          {region.program.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="text-muted">In your program for this area</div>
              {region.program.map((p) => (
                <div key={p.name} className="flex items-center justify-between py-2"><span>{p.name}</span><Chip tone={p.tag === 'camera' ? 'mint' : p.tag === 'weekly' ? 'neutral' : 'neutral'}>{p.tag}</Chip></div>
              ))}
            </div>
          )}
          <Button full variant="secondary" className="mt-4" onClick={() => nav(region.primary.to)}>{region.primary.label}</Button>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-start justify-between"><div><h2 className="text-xl">Assigned program</h2><p className="text-muted">{PROGRAM.short}</p></div><Chip tone="neutral">Read-only</Chip></div>
          <div className="mt-3 border-t border-line pt-3"><div className="font-bold">Next visit</div><div className="text-muted">{PROGRAM.nextVisit}</div></div>
        </div>
        <p className="text-sm text-muted">Illustrative data until the local store lands (Phase 8).</p>
      </div>
    </div>
  )
}

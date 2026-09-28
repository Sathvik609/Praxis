import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AvatarPanel } from '../../avatar/AvatarPanel'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Chip, type ChipTone } from '../../design/Chip'
import { Field } from '../../design/Field'
import { AlertTriangle, Check, RotateCcw, Sparkles, ZoomIn, ZoomOut } from '../../design/Icon'
import { Pill } from '../../design/Pill'
import { Stat } from '../../design/Stat'
import { api, isReplaySession, useApi } from '../../lib/api'
import { countOf } from '../../lib/plural'
import { DAY_MINUTES, DAY_ORDER, WEEKLY } from '../../lib/plan'
import { HOME_MARKERS, PATIENT, PROGRAM, REGIONS, WEEK, exerciseById, upcomingVisit } from '../../lib/seed'
import { CoachSheet } from '../coach/CoachDrawer'

const tone: Record<string, ChipTone> = { focus: 'focus', watch: 'amber', stable: 'mint' }
const word: Record<string, string> = { focus: 'Focus', watch: 'Watch', stable: 'Stable' }
const GOAL_KEY = 'praxis.goal'
const ZOOMS = [1, 1.25, 1.5]
/** Which part of the body each body-map marker stands for, to mark today's exercises there. */
const AREA: Record<string, 'hand' | 'shoulder' | null> = { lWrist: 'hand', lShoulder: 'shoulder', lElbow: null }

function readGoal(): string | null {
  try {
    return localStorage.getItem(GOAL_KEY)
  } catch {
    return null
  }
}

/** Screen 02 · Home. The avatar body map sets the hierarchy; markers come from the
 *  prescription and camera metrics. No diagnosis, no composite score. The week strip and
 *  body-map markers are sample history (chip on the card) until real sessions accumulate;
 *  goal, sessions and reports come from the local store. */
export function Home() {
  const nav = useNavigate()
  const [view, setView] = useState<'front' | 'side' | 'both'>('side')
  const [alt, setAlt] = useState<'front' | 'side'>('side')
  const [zoomIdx, setZoomIdx] = useState(0)
  const [focus, setFocus] = useState<string>('lWrist')
  const [coachOpen, setCoachOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [savedGoal, setSavedGoal] = useState<string | null>(() => readGoal())
  const [draft, setDraft] = useState('')
  const [attempts, setAttempts] = useState<number | null>(null)
  const [goalNote, setGoalNote] = useState<string | null>(null)
  const region = REGIONS[focus]
  const { data: me } = useApi(() => api.me())
  const { data: sessions } = useApi(() => api.sessions())
  const goal = savedGoal ?? me?.goal ?? PATIENT.goal
  const attemptCount = attempts ?? me?.goal_attempts ?? PATIENT.goalAttempts
  const camera = view === 'both' ? alt : view
  const area = AREA[focus] ?? null
  const nextVisit = upcomingVisit(me?.program?.next_visit ?? PROGRAM.nextVisit)

  // "Both" alternates the reference camera every 4 s; the avatar never mirrors the patient.
  useEffect(() => {
    if (view !== 'both') return
    const id = setInterval(() => setAlt((c) => (c === 'front' ? 'side' : 'front')), 4000)
    return () => clearInterval(id)
  }, [view])

  const pickView = (v: 'front' | 'side' | 'both') => {
    if (v === 'both') setAlt(camera)
    setView(v)
  }
  const rotate = () => setView(camera === 'front' ? 'side' : 'front')
  const saveGoal = () => {
    const g = draft.trim()
    if (!g) return
    try {
      localStorage.setItem(GOAL_KEY, g)
    } catch {
      /* private mode: kept for this page only */
    }
    setSavedGoal(g)
    setEditing(false)
  }
  const logAttempt = () =>
    api
      .logGoal('attempt')
      .then((r) => {
        setAttempts(r.goal_attempts)
        setGoalNote('Logged.')
      })
      .catch(() => setGoalNote('Could not log — the session service is not reachable.'))
  const openReport = () => nav(sessions?.[0] ? `/report/${sessions[0].id}` : '/details/progress')

  return (
    <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1.1fr)] gap-5 p-5">
      <div className="flex flex-col gap-4">
        <Card tone="brand" className="p-6">
          <div className="text-white/80">Next practice · today</div>
          <h1 className="text-3xl text-white">{DAY_ORDER.map((id) => exerciseById(id)?.name ?? id).join(' → ')}</h1>
          <p className="mt-1 text-white/80">About {DAY_MINUTES} min · cup + target sheet</p>
          <Button full variant="inverse" className="mt-5" onClick={() => nav('/details/checkin')}>Start session</Button>
          <Button full variant="secondary" className="mt-3 whitespace-normal! border-white/70! bg-transparent! text-white! hover:bg-white/10!" onClick={() => nav('/details/settings')}>Replay a recorded session · no webcam</Button>
          <Button full variant="link" className="mt-2 text-white/90! hover:bg-white/10!" onClick={() => setCoachOpen(true)}>Ask the coach</Button>
        </Card>

        <Card title="This week" action={<Chip tone="neutral">Sample history</Chip>}>
          <div className="text-muted">{WEEK.sessions} days · {WEEK.minutes} min</div>
          {/* Seven equal columns: fixed 40 px tiles overflowed the card at 1280 × 800 (review 28 Sep). */}
          <div className="mt-3 grid grid-cols-7 gap-1.5">
            {WEEK.days.map((d, i) => {
              const done = WEEK.done[i]
              const today = i === WEEK.todayIndex
              return (
                <div key={i} className="flex min-w-0 flex-col items-center gap-1">
                  <span className="text-base text-muted">{d}</span>
                  <span aria-label={done ? `${d}: done` : today ? `${d}: today` : `${d}: not yet`} className={`flex h-10 w-full max-w-10 items-center justify-center rounded-[var(--r-control)] font-bold ${done ? 'bg-teal-fill text-white' : today ? 'bg-tint-mint text-teal-ink' : 'bg-bg text-muted'}`}>
                    {done ? <Check aria-hidden className="h-5 w-5" strokeWidth={3} /> : today ? 'now' : '·'}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
            <span className="text-muted">Last session · {sessions?.[0] ? `${sessions[0].summary.camera.verified ?? 0} verified · ${sessions[0].title}${isReplaySession(sessions[0]) ? ' · replay' : ''}` : WEEK.lastSession}</span>
            <Button variant="secondary" className="shrink-0" onClick={openReport}>Open report</Button>
          </div>
        </Card>

        <Card title="Your everyday goal">
          {editing ? (
            <>
              <Field label="Your everyday goal" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveGoal()} />
              <div className="mt-3 flex gap-3">
                <Button onClick={saveGoal}>Save goal</Button>
                <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xl">{goal}</p>
              <p className="text-muted">{countOf(attemptCount, 'attempt')} logged this week{goalNote ? ` · ${goalNote}` : ''}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button variant="secondary" onClick={logAttempt}>Log an attempt</Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDraft(goal)
                    setEditing(true)
                  }}
                >
                  Edit goal
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl">Your arm and hand</h2>
            <p className="text-muted">Tap a marker for what your program covers there.</p>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-base">
              <li className="inline-flex items-center gap-1 text-focus"><Sparkles aria-hidden className="h-4 w-4" /> Focus</li>
              <li className="inline-flex items-center gap-1 text-amber-ink"><AlertTriangle aria-hidden className="h-4 w-4" /> Watch</li>
              <li className="inline-flex items-center gap-1 text-mint-ink"><Check aria-hidden className="h-4 w-4" /> Stable</li>
            </ul>
          </div>
          <Pill ariaLabel="Avatar view" size="sm" className="ml-auto shrink-0" value={view} onChange={pickView} options={[{ value: 'front', label: 'Front' }, { value: 'side', label: 'Left side' }, { value: 'both', label: 'Both' }]} />
        </div>
        <div className="relative mx-auto mt-3 w-full max-w-[420px]">
          <div className="absolute right-2 top-2 z-10 flex gap-1">
            <Button variant="inverse" className="w-14 px-0!" aria-label="Zoom in" disabled={zoomIdx === ZOOMS.length - 1} icon={<ZoomIn />} onClick={() => setZoomIdx((i) => Math.min(ZOOMS.length - 1, i + 1))} />
            <Button variant="inverse" className="w-14 px-0!" aria-label="Zoom out" disabled={zoomIdx === 0} icon={<ZoomOut />} onClick={() => setZoomIdx((i) => Math.max(0, i - 1))} />
            <Button variant="inverse" className="w-14 px-0!" aria-label="Rotate view" icon={<RotateCcw />} onClick={rotate} />
          </div>
          <div className="overflow-hidden rounded-[var(--r-card)]">
            <div style={{ transform: `scale(${ZOOMS[zoomIdx]})`, transformOrigin: '50% 30%' }} className="transition-transform duration-300">
              <AvatarPanel clip="idle" camera={camera} markers={HOME_MARKERS} onMarkerTap={(m) => setFocus(m.joint)} compact showCues={false} />
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        {/* Region metrics are seeded sample history until real sessions fill them: say so. */}
        <Card tone="highlight" title={region.title} action={<span className="flex flex-wrap justify-end gap-2"><Chip tone="neutral">Sample</Chip><Chip tone={tone[region.status]}>{word[region.status]}</Chip></span>}>
          <p className="-mt-3 text-muted">{region.setBy}</p>
          <div className="mt-4 space-y-3">
            {region.metrics.map((m) => (
              <Stat key={m.label} value={m.value} unit={m.unit} label={m.label} extra={m.delta ? <Chip tone="mint">{m.delta}</Chip> : undefined} />
            ))}
          </div>
          {region.program.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="text-muted">In your program for this area</div>
              {region.program.map((p) => (
                <div key={p.name} className="flex items-center justify-between gap-2 py-2">
                  <span>{p.name}</span>
                  <Chip tone={p.tag === 'camera' ? 'mint' : 'neutral'}>{p.tag}</Chip>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 border-t border-line pt-3">
            <div className="text-muted">Today, in order</div>
            <ol className="mt-1">
              {[...DAY_ORDER, ...WEEKLY].map((id, i) => {
                const ex = exerciseById(id)
                if (!ex) return null
                return (
                  <li key={id} className="flex items-center justify-between gap-2 py-1">
                    <span>{ex.weekly ? ex.name : `${i + 1}. ${ex.name}`}</span>
                    <span className="flex gap-1">
                      {ex.weekly && <Chip tone="neutral">weekly</Chip>}
                      {area && ex.region === area && <Chip tone="focus">this area</Chip>}
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>
          <Button full variant="secondary" className="mt-4" onClick={() => (region.primary.label === 'Ask the coach' ? setCoachOpen(true) : nav(region.primary.to))}>{region.primary.label}</Button>
        </Card>
        <Card title="Assigned program" action={<Chip tone="neutral">Read-only</Chip>}>
          <p className="-mt-3 text-muted">{me?.program?.short ?? PROGRAM.short}</p>
          <div className="mt-3 border-t border-line pt-3">
            <div className="font-bold">Next visit</div>
            <div className="text-muted">{nextVisit ?? 'Not booked yet · your therapist sets it'}</div>
          </div>
        </Card>
      </div>
      <CoachSheet open={coachOpen} onOpenChange={setCoachOpen} />
    </div>
  )
}

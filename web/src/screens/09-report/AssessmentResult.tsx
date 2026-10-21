import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Bars } from '../../design/charts/Bars'
import { Chip } from '../../design/Chip'
import { Stat } from '../../design/Stat'
import { plural } from '../../lib/plural'

type NhptResult = {
  kind: 'nhpt'
  hand: string
  total_s: number | null
  splits_s: number[]
  pegs: { peg: number; hole: number }[]
  pegs_done?: number
  ended_early: boolean
}
type Reach = { rep: number; from_dot: number; to_dot: number; reach_ms: number; verified: boolean; reason: string | null; arc: number; phase: string }
type CupResult = { kind: 'cup'; side: string; arcs: number; reaches: Reach[]; ended_early: boolean }
type ArmRep = { set: number; rep: number; peak_deg: number; hold_s: number; verified: boolean; reason: string | null; lean: boolean; hike: boolean }
type ArmResult = { kind: 'arm'; name?: string; side: string; sets: number; reps: ArmRep[]; ended_early: boolean; lean_count: number; hike_count: number; above_ceiling?: number; ceiling_deg: number }
type Result = NhptResult | CupResult | ArmResult

const tenth = (v: number) => Math.round(v * 10) / 10

/** Shared frame: title with the status chip, a one-line caveat, the body, and the Done primary. */
function Frame({ title, endedEarly, caveat, children, onDone }: { title: string; endedEarly: boolean; caveat: string; children: ReactNode; onDone: () => void }) {
  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-4xl">{title}</h1>
        <Chip tone={endedEarly ? 'amber' : 'mint'}>{endedEarly ? 'Ended early' : 'Complete'}</Chip>
      </div>
      <p className="mt-1 text-muted">{caveat}</p>
      <div className="mt-5 space-y-5">{children}</div>
      <div className="mt-6 flex justify-end">
        <Button onClick={onDone}>Done — back to Home</Button>
      </div>
    </div>
  )
}

function ArmReport({ r, onDone }: { r: ArmResult; onDone: () => void }) {
  const verified = r.reps.filter((x) => x.verified).length
  const unverified = r.reps.length - verified
  const best = r.reps.filter((x) => x.verified).reduce((m, x) => Math.max(m, x.peak_deg), 0)
  return (
    <Frame title={`${r.name ?? 'Arm out to the side'} · ${r.side} side`} endedEarly={r.ended_early} caveat={`Camera-relative angles, not goniometry. Ceiling ${r.ceiling_deg}° enforced in code.`} onDone={onDone}>
      <Card>
        <div className={`grid ${r.above_ceiling !== undefined ? 'grid-cols-5' : 'grid-cols-4'} gap-4`}>
          <Stat value={r.sets} label={plural(r.sets, 'set')} />
          <Stat value={verified} label={`verified ${plural(verified, 'lift')}`} />
          <Stat value={unverified} label="unverified · missed target or short hold" tone="amber" />
          <Stat value={r.lean_count} label={`${plural(r.lean_count, 'lean event')} · ${r.hike_count} ${plural(r.hike_count, 'shoulder-hike event')}`} tone={r.lean_count > 0 ? 'amber' : 'default'} />
          {r.above_ceiling !== undefined && <Stat value={r.above_ceiling} label={`${plural(r.above_ceiling, 'lift')} above ${r.ceiling_deg}°`} tone={r.above_ceiling > 0 ? 'amber' : 'default'} />}
        </div>
      </Card>
      {r.reps.length > 0 && (
        <Card title={`Peak angle per lift · best verified ${Math.round(best)}°`}>
          <Bars
            title="Peak angle per lift"
            unit="°"
            values={r.reps.map((x) => Math.round(x.peak_deg))}
            verified={r.reps.map((x) => x.verified)}
            labels={r.reps.map((x) => `${x.set}.${x.rep}`)}
            target={r.ceiling_deg}
            height={180}
          />
          <p className="mt-2 text-base text-muted">Labels are set.lift.</p>
        </Card>
      )}
    </Frame>
  )
}

function CupReport({ r, onDone }: { r: CupResult; onDone: () => void }) {
  const verified = r.reaches.filter((x) => x.verified).length
  const unverified = r.reaches.length - verified
  const mean = (phase: string) => {
    const xs = r.reaches.filter((x) => x.verified && x.phase === phase).map((x) => x.reach_ms)
    return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length / 1000).toFixed(2) : '—'
  }
  return (
    <Frame title={`Waiter – cup · ${r.side} side`} endedEarly={r.ended_early} caveat="What the camera measured. Unverified reaches are counted, never scored." onDone={onDone}>
      <Card>
        <div className="grid grid-cols-4 gap-4">
          <Stat value={r.arcs} label={plural(r.arcs, 'arc')} />
          <Stat value={verified} label={`verified ${plural(verified, 'reach')}`} />
          <Stat value={unverified} label="unverified · hand covered cup or markers lost" tone="amber" />
          <Stat value={`${mean('slow')} / ${mean('fast')}`} unit="s" label="mean reach · slow / fast" />
        </div>
      </Card>
      {r.reaches.length > 0 && (
        <Card title="Reach time per reach">
          <Bars
            title="Reach time"
            unit="s"
            values={r.reaches.map((x) => tenth(x.reach_ms / 1000))}
            verified={r.reaches.map((x) => x.verified)}
            labels={r.reaches.map((x) => String(x.rep))}
            height={180}
          />
          <p className="mt-2 text-base text-muted">
            {r.reaches.map((x) => `${x.rep}: ${x.phase} · dot ${x.from_dot + 1}→${x.to_dot + 1}${x.verified ? '' : ' · unverified'}`).join(' · ')}
          </p>
        </Card>
      )}
    </Frame>
  )
}

function NhptReport({ r, onDone }: { r: NhptResult; onDone: () => void }) {
  return (
    <Frame title={`Nine-Hole Peg Test · ${r.hand} hand`} endedEarly={r.ended_early} caveat="Insertion-only · timing aid, not a clinical instrument." onDone={onDone}>
      <Card>
        <Stat size="xl" value={r.total_s != null ? r.total_s.toFixed(1) : '—'} unit="s" label={r.total_s != null ? 'total time · first lift to ninth peg seated' : `Timer did not complete (${r.pegs_done ?? 0} of 9 seated).`} />
      </Card>
      {r.splits_s.length > 0 && (
        <Card title="Per-peg splits">
          <Bars
            title="Per-peg splits"
            unit="s"
            values={r.splits_s.map(tenth)}
            labels={r.splits_s.map((_, i) => `Peg ${i + 1}`)}
            height={180}
          />
          {r.pegs.length > 0 && (
            <p className="mt-2 text-base text-muted">Holes: {r.pegs.map((p, i) => `peg ${i + 1} → hole ${p.hole + 1}`).join(' · ')}</p>
          )}
        </Card>
      )}
    </Frame>
  )
}

/** Screen 09 variant · Assessment result for the Nine-Hole Peg Test, plus the cup and arm
 *  summaries the live screens hand over in router state. */
export function AssessmentResult() {
  const { state } = useLocation() as { state: Result | null }
  const nav = useNavigate()
  const done = () => nav('/details')
  if (state?.kind === 'cup') return <CupReport r={state} onDone={done} />
  if (state?.kind === 'arm') return <ArmReport r={state} onDone={done} />
  if (state?.kind === 'nhpt') return <NhptReport r={state} onDone={done} />
  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <h1 className="text-4xl">Assessment result</h1>
      <Card className="mt-5">
        <p className="text-lg">No result to show yet. The peg test takes about a minute with the printed sheet and a pegboard.</p>
        <Button full className="mt-5" onClick={() => nav('/details/choose?next=nhpt')}>Run the peg test</Button>
        <Button variant="link" className="mt-2" onClick={done}>Back to Home</Button>
      </Card>
    </div>
  )
}

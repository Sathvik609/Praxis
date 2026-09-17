import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Chip } from '../../design/Chip'
import { Check } from '../../design/Icon'
import { Stat } from '../../design/Stat'
import { api, useApi } from '../../lib/api'
import { COACH_LABEL } from '../07-session/LiveShell'
import { DetailsLink } from './DetailsLink'

/** Guided path · Done. What the camera actually saw, the goal it serves, and one way on.
 *  Unverified is never counted as a failure, and there is no composite score anywhere. */
export function Done() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { data: session, error } = useApi(() => api.session(id), [id])
  const { data: envelope } = useApi(() => api.profile())
  const goal = envelope?.profile?.goal ?? null

  const cam = session?.summary?.camera ?? {}
  const verified = Number(cam.verified ?? 0)
  const unverified = Number(cam.unverified ?? 0)
  const total = Number(cam.reps_total ?? verified + unverified)
  const peaks = (cam.peak_deg ?? []).filter((n) => typeof n === 'number')
  const best = peaks.length ? Math.round(Math.max(...peaks)) : null
  const note = session?.summary?.coach?.notes?.[0] ?? null

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="flex h-16 items-center px-8">
        <span className="font-heading text-2xl font-semibold text-teal-ink">Praxis</span>
      </header>
      <main className="mx-auto w-full max-w-[46rem] px-6 pb-12">
        <h1 className="text-4xl">Practice done</h1>

        {error && (
          <div role="alert" className="mt-6">
            <Card tone="watch">
              <p className="text-xl">I could not load this practice. It may not have been saved.</p>
            </Card>
          </div>
        )}

        {session && (
          <>
            <p className="mt-2 text-2xl">
              {verified} of {total} {total === 1 ? 'rep' : 'reps'} verified{goal ? ` toward ${goal}` : ''}.
            </p>

            <Card className="mt-6">
              <div className="grid grid-cols-3 gap-4">
                <Stat value={verified} label="verified by the camera" size="lg" extra={<Chip tone="mint" icon={<Check />}>seen</Chip>} />
                <Stat value={unverified} label="unverified" size="lg" tone={unverified ? 'amber' : 'default'} />
                <Stat value={best != null ? `${best}°` : '—'} unit={best != null ? undefined : ''} label="best angle this practice" size="lg" />
              </div>
              <p className="mt-4 text-base text-muted">
                Unverified means I could not see that rep clearly. It is not a failed rep, and angles are relative progress, not a
                clinical measurement.
              </p>
            </Card>

            {note && (
              <Card tone="coach" className="mt-4">
                <div className="text-base text-muted">Coach</div>
                <p className="text-2xl">{note.text}</p>
                <div className="mt-2 text-base text-muted">{session.summary.coach.label ?? COACH_LABEL}</div>
              </Card>
            )}
          </>
        )}

        <Button full className="mt-8" onClick={() => nav('/')}>Finish</Button>
        <div className="mt-2"><DetailsLink /></div>
      </main>
    </div>
  )
}

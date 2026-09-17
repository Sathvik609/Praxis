import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Bars } from '../../design/charts/Bars'
import { Chip } from '../../design/Chip'
import { Download, Flag, Share2 } from '../../design/Icon'
import { Overlay, OverlayActions } from '../../design/Overlay'
import { Stat } from '../../design/Stat'
import { api, useApi, type SessionRecord } from '../../lib/api'

const conf = { high: 'mint', medium: 'amber', low: 'neutral' } as const

function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/** `summary.latency` from the service (Sprint D, D-LAT): percentiles over the whole session,
 *  null when the browser sent no capture time (replay) or nothing happened. */
type LatencyBlock = {
  capture_to_event_p50: number | null
  capture_to_event_p95: number | null
  proc_p50: number | null
  proc_p95: number | null
  event_to_cue_p50: number | null
  event_to_cue_p95: number | null
  frames: number
  dropped: number
  cues: number
}

const pp = (a: number | null, b: number | null) => (a != null && b != null ? `${Math.round(a)} / ${Math.round(b)} ms` : '—')

function latencyText(l: LatencyBlock): string {
  const first = l.capture_to_event_p50 != null ? `capture→event ${pp(l.capture_to_event_p50, l.capture_to_event_p95)}` : `processing ${pp(l.proc_p50, l.proc_p95)}`
  return `Latency p50 / p95 · ${first} · event→cue ${pp(l.event_to_cue_p50, l.event_to_cue_p95)} · ${l.frames} frames, ${l.dropped} dropped`
}

/** Side comes from the summary when the service recorded one; never assumed. */
function sideOf(s: SessionRecord): string | null {
  const cands = [s.summary.camera.side, s.summary.told_us?.side, s.checkin?.side]
  const v = cands.find((x) => typeof x === 'string' && x)
  return typeof v === 'string' ? v : null
}

/** Screen 09 · Session report. Camera measurements are separated from what the patient
 *  reported; coach notes carry confidence; next-session changes are proposals; delivery to
 *  the clinician is shown as queued until confirmed. Download builds a JSON blob of the
 *  record; Sharing explains who sees the report (the therapist's queue, nothing else). */
export function SessionReport() {
  const { id } = useParams()
  const nav = useNavigate()
  const { data, error } = useApi(() => api.session(id ?? ''), [id])
  const { data: me } = useApi(() => api.me())
  const [sharing, setSharing] = useState(false)
  const clinician = me?.program?.clinician?.split(',')[0] ?? 'your therapist'
  // The service answers unknown ids with 200 and `{ error }`, so a body without a summary is
  // an error too, not a record.
  const bodyError = data && !(data as Partial<SessionRecord>).summary ? String((data as { error?: string }).error ?? 'no session data') : null
  const problem = error ?? bodyError

  if (problem) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6">
        <Card tone="watch" title="Could not load this report">
          <p className="text-lg">The report could not be fetched ({problem}). Reports stay on this device until they are delivered.</p>
          <div className="mt-4">
            <Button variant="secondary" onClick={() => nav('/')}>Back to Home</Button>
          </div>
        </Card>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6">
        <Card>
          <p role="status" className="text-lg text-muted">Loading report…</p>
        </Card>
      </div>
    )
  }
  const s = data
  const cam = s.summary.camera
  const told = s.feedback ?? {}
  const ck = s.checkin ?? {}
  const side = sideOf(s)
  const active = cam.active_s ? `${Math.floor(cam.active_s / 60)}:${String(Math.round(cam.active_s % 60)).padStart(2, '0')}` : '—'
  const coverage = cam.coverage_pct ?? Math.round((100 * (cam.verified ?? 0)) / Math.max(1, cam.reps_total ?? 1))
  const dl = () => {
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `praxis-session-${s.id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  const compared = told.compared
    ? `Felt ${told.compared === 'same' ? 'about the same as' : told.compared === 'first' ? 'like a first time —' : `${String(told.compared)} than`} last time.`
    : 'Comparison not recorded.'
  const reachS = cam.reach_ms?.map((v) => Math.round(v / 100) / 10)
  const context = s.summary.mode === 'nhpt' ? 'assessment' : side ? `${side} side` : 'practice'
  const latency = (s.summary as { latency?: LatencyBlock }).latency ?? null

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <h1 className="text-4xl">Your practice report</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-muted">
            <span>{s.date} · {s.title} · {context}</span>
            <Chip tone={s.status === 'complete' ? 'mint' : 'amber'}>{s.status === 'complete' ? 'Complete' : 'Ended early'}</Chip>
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-3">
          <Button variant="secondary" icon={<Download />} onClick={dl}>Download JSON</Button>
          <Button variant="secondary" icon={<Share2 />} onClick={() => setSharing(true)}>Sharing</Button>
          <Button onClick={() => nav('/')}>Done — back to Home</Button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-[3fr_2fr] gap-5">
        <div className="space-y-5">
          <Card title="What the camera measured">
            <div className="grid grid-cols-5 gap-4">
              <Stat value={active} label="active · rest excluded" />
              <Stat value={String(cam.verified ?? 0)} label="verified movements" />
              <Stat value={String(cam.unverified ?? 0)} label="unverified · hand hid the object or markers lost" tone="amber" />
              <Stat value={String(coverage)} unit="%" label="tracking coverage" />
              <Stat value={String(cam.posture_cues ?? cam.corrections ?? 0)} label="posture cues" />
            </div>
            {cam.nhpt_total_s != null && (
              <p className="mt-4 text-xl">
                Nine-Hole Peg Test: <b>{cam.nhpt_total_s.toFixed(1)} s</b> · insertion-only · timing aid, not a clinical instrument
              </p>
            )}
            {(reachS || cam.peak_deg || cam.splits_s) && (
              <div className="mt-5 grid grid-cols-2 gap-6">
                {reachS && <Bars title="Waiter – cup · reach time per reach" unit="s" values={reachS} verified={cam.reach_verified} labels={reachS.map((_, i) => String(i + 1))} />}
                {cam.peak_deg && <Bars title="Arm to the front · peak angle per lift" unit="°" values={cam.peak_deg.map((v) => Math.round(v))} verified={cam.peak_verified} labels={cam.peak_deg.map((_, i) => String(i + 1))} target={90} />}
                {cam.splits_s && <Bars title="Nine-Hole Peg Test · per-peg split" unit="s" values={cam.splits_s.map((v) => Math.round(v * 10) / 10)} labels={cam.splits_s.map((_, i) => `Peg ${i + 1}`)} />}
              </div>
            )}
            <p className="mt-3 text-base text-muted">Verified and unverified are counted separately; nothing is combined into a score.</p>
            {latency && latency.frames > 0 && <p className="mt-2 text-base tabular-nums text-muted">{latencyText(latency)}</p>}
          </Card>

          <Card title={`Coach notes for ${clinician}`} action={<Chip tone="neutral">{s.summary.coach.label}</Chip>}>
            <ul className="divide-y divide-line">
              {s.summary.coach.notes.length === 0 && <li className="py-3 text-lg text-muted">No coach notes: nothing needed correcting or changing.</li>}
              {s.summary.coach.notes.map((n, i) => (
                <li key={i} className="flex items-start justify-between gap-4 py-3">
                  <span className="text-lg">{n.text}</span>
                  <Chip tone={conf[n.confidence] ?? 'neutral'}>{cap(n.confidence)}</Chip>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-base text-muted">Confidence reflects how much camera evidence backs each note.</p>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="What you told us">
            <div className="grid grid-cols-2 gap-4">
              <Stat value={`${String(ck.pain_before ?? '—')} → ${String(told.pain_after ?? '—')}`} label="pain before → after" />
              <Stat value={told.effort != null ? String(told.effort) : '—'} unit={told.effort != null ? '/ 10' : undefined} label={told.effort != null ? 'effort' : 'effort · not recorded'} />
            </div>
            <p className="mt-3 text-lg">{compared}</p>
            {typeof told.detail === 'string' && told.detail && <p className="mt-2 text-lg text-muted">Your note: “{told.detail}”</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-base text-muted">
              <span>Exertion</span>
              <Chip tone={s.summary.exertion.level === 'high' ? 'red' : s.summary.exertion.level === 'moderate' ? 'amber' : 'mint'}>{cap(s.summary.exertion.level)}</Chip>
              <span>· behavioural index</span>
            </div>
          </Card>

          <Card title="Next practice" action={<Chip tone="neutral">Proposal</Chip>}>
            <p className="text-lg">{s.next_practice.text}</p>
            <p className="mt-2 text-lg text-muted">Proposed: {s.next_practice.proposal}</p>
          </Card>

          <Card padding="sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-lg">Report to {clinician}</span>
              <Chip tone="amber">{cap(s.delivery)}</Chip>
            </div>
          </Card>

          {s.summary.flags.length > 0 && (
            <Card tone="watch" title="Therapist flags">
              <ul className="space-y-2 text-lg">
                {s.summary.flags.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Flag aria-hidden className="mt-1 h-5 w-5 shrink-0 text-red-ink" />
                    <span>{f.rule}: {f.detail}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <Overlay open={sharing} title="Who sees this report" description="How this report is shared." onClose={() => setSharing(false)} className="w-[min(640px,92vw)]">
        <ul className="mt-4 space-y-3 text-lg">
          <li>It goes to <b>{clinician}'s review queue</b> and nowhere else.</li>
          <li>It contains measurements, events, coach notes and what you told us — <b>never video</b>. Video is processed on this device and not stored.</li>
          <li>
            Status right now: <Chip tone="amber">{cap(s.delivery)}</Chip>
          </li>
          <li>Download JSON gives you the same record to keep or hand over yourself.</li>
        </ul>
        <OverlayActions className="justify-end">
          <Button onClick={() => setSharing(false)}>Close</Button>
        </OverlayActions>
      </Overlay>
    </div>
  )
}

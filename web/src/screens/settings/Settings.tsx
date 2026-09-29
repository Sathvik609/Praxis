import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { applyTheme, getTheme, type Theme } from '../../app/theme'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Checkbox } from '../../design/Checkbox'
import { Chip } from '../../design/Chip'
import { Bot, ListChecks, Play } from '../../design/Icon'
import { Pill } from '../../design/Pill'
import { api, useApi, type Health } from '../../lib/api'
import { processingPlace } from '../../lib/config'
import { exerciseOfSession, isHiddenExercise } from '../../lib/seed'
import { healthLines } from '../../session/agent'
import { readGuidance, writeGuidance, type Guidance } from '../../session/guidance'

/** Every toggle here is read by the code it names (session/guidance.ts). Captions are not a
 *  toggle: they are always on. The old "Helper for setup" toggle was never read and is gone. */
const GUIDANCE_ITEMS: { key: keyof Guidance; label: string; description: string }[] = [
  { key: 'spoken', label: 'Spoken instructions', description: 'Coach cues read aloud by this browser' },
  { key: 'larger', label: 'Larger text', description: 'Everything in the app about an eighth bigger' },
]

/** Settings: theme (light default), guidance (kept in this browser), privacy statement, and
 *  the replay entry (judge fallback: a recorded clip through the identical pipeline, no webcam). */
export function Settings() {
  const nav = useNavigate()
  const [theme, setTheme] = useState<Theme>(getTheme())
  const [guidance, setGuidance] = useState<Guidance>(() => readGuidance())
  const { data: clips, error } = useApi(() => api.replayList())
  const { data: health, error: healthError } = useApi(() => api.health())
  const pick = (t: Theme) => {
    applyTheme(t)
    setTheme(t)
  }
  const setG = (key: keyof Guidance, v: boolean) => {
    const next = { ...guidance, [key]: v }
    setGuidance(next)
    writeGuidance(next)
  }
  return (
    <div className="grid grid-cols-2 gap-6 p-8">
      <div className="space-y-6">
        <Card>
          <h1 className="text-3xl">Settings</h1>
          <h2 className="mt-4 text-2xl">Theme</h2>
          <Pill ariaLabel="Theme" className="mt-2" value={theme} onChange={pick} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
          <p className="mt-2 text-muted">Light is the default. The avatar stage stays dark in both.</p>
        </Card>
        <Card title="Guidance">
          <div className="grid grid-cols-2 gap-x-6">
            {GUIDANCE_ITEMS.map((g) => (
              <Checkbox key={g.key} label={g.label} description={g.description} checked={guidance[g.key]} onChange={(v) => setG(g.key, v)} />
            ))}
          </div>
          <p className="mt-2 text-lg text-muted">Captions are always on: every spoken cue is also shown as text.</p>
        </Card>
        <Card title="Privacy">
          <p className="text-lg">Video is {processingPlace()}. Only events, measurements and logs are kept. Feeling is what you tell us, never read from your face. Clips are recorded only with your explicit consent and deleted after 30 days.</p>
        </Card>
      </div>
      <div className="space-y-6">
        <Card title="Replay a recorded session" action={<Chip tone="amber">Replay</Chip>}>
          <p className="-mt-2 text-muted">No webcam needed. The recording runs through the identical OpenCV pipeline and coach; the session shows a Replay badge instead of Live.</p>
          <div className="mt-4 space-y-3">
            {/* The service never lists a hidden exercise's clip (28 Sep); filtered here too. */}
            {(clips ?? []).filter((c) => !isHiddenExercise((c as { exercise?: string }).exercise ?? c.mode)).map((c) => {
              // Named from the one exercise registry (a clip may carry its arm exercise id).
              const ex = exerciseOfSession({ mode: c.mode, exercise: (c as { exercise?: string }).exercise })
              const name = ex?.name ?? c.mode
              return (
              <Card key={c.id} as="div" padding="sm" className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-bold">{name}</span>
                  <span className="block text-base text-muted">Left side · {c.synthetic ? 'rendered test clip' : 'recorded with consent'}</span>
                </span>
                {c.synthetic && <Chip tone="neutral">Synthetic render</Chip>}
                <Button variant="secondary" icon={<Play />} aria-label={`Replay ${name}`} onClick={() => nav(`/session?exercise=${ex?.id ?? c.mode}&${c.mode === 'nhpt' ? 'hand' : 'side'}=left&replay=${c.id}`)}>Replay</Button>
              </Card>
              )
            })}
            {!clips && !error && <p className="text-muted" role="status">Loading recordings…</p>}
            {error && <p className="text-red-ink" role="alert">Could not list recordings — the session service is not reachable.</p>}
            {clips && clips.length === 0 && <p className="text-muted">No recordings available yet.</p>}
          </div>
        </Card>
        <CoachStatus health={health} error={healthError} />
        <Card title="Cloud">
          <p className="-mt-2 text-muted">Cloud mode (AWS) is off in this build. Video is {processingPlace()}.</p>
        </Card>
      </div>
    </div>
  )
}

/** Settings > Coach: which coach runs, from the service's `/health` (agent spec §7). The rule
 *  coach always runs between agent checkpoints and whenever the agent is off or not ready. */
function CoachStatus({ health, error }: { health: Health | null; error: string | null }) {
  const lines = health ? healthLines(health.agent) : null
  const agentOn = !!health?.agent && health.agent.mode !== 'off'
  const running = agentOn && !!health?.agent?.ready
  return (
    <Card title="Coach">
      {lines && (
        <>
          <p className="-mt-2 flex items-center gap-2 text-lg font-bold">
            {agentOn ? <Bot aria-hidden className="h-5 w-5 shrink-0" /> : <ListChecks aria-hidden className="h-5 w-5 shrink-0" />}
            <span>{lines.title}</span>
          </p>
          {lines.details.map((d) => (
            <p key={d} className="mt-1 text-lg text-muted">{d}</p>
          ))}
          <p className="mt-2 text-muted">{running ? 'The agent runs at checkpoints (set or arc done, setup trouble, session end); the rule-based coach gives the cues in between. Stop rules run before both.' : 'Deterministic cues from the camera events. Stop rules run first.'}</p>
        </>
      )}
      {!health && !error && <p className="-mt-2 text-muted" role="status">Checking the coach…</p>}
      {!health && error && <p className="-mt-2 text-muted">Coach status unavailable — the session service is not reachable.</p>}
    </Card>
  )
}

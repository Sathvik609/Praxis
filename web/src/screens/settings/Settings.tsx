import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { applyTheme, getTheme, type Theme } from '../../app/theme'
import { arrowSelect } from '../../design/arrowKeys'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Overlay, OverlayActions } from '../../design/Overlay'
import { Switch } from '../../design/Switch'
import { api, useApi, type Health, type Patient } from '../../lib/api'
import { deploymentLabel, processingPlace } from '../../lib/config'
import { readDay, readSide, resetTodayCheckin, setupUrl, todayKey, type Day } from '../../lib/day'
import { readPrefs, writePrefs, type Prefs } from '../../lib/prefs'
import { exerciseOfSession, isHiddenExercise } from '../../lib/seed'
import { healthLines } from '../../session/agent'
import { readGuidance, writeGuidance, type Guidance } from '../../session/guidance'
import { resetSpeech } from '../../session/useCoach'
import { SettingsRow } from './SettingsRow'
import { readTester, writeTester } from '../../lib/tester'

const THEMES: [Theme, string][] = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['auto', 'Auto'],
]

/** Settings (the designers' `.st` three-column layout, live J64234–64318), wired to real data:
 *  the profile from `GET /api/patients/me` (no seeded name), display and guidance preferences
 *  that the app reads (`lib/prefs.ts`, `session/guidance.ts`, `app/theme.ts`), the replay entry
 *  (judge fallback: a recorded clip through the identical pipeline), the coach in use from
 *  `/health`, and a reset of today's check-in that never lifts a stop. The artifact's
 *  decorative toggles and invented facts (reminders, push to talk, setup helper, clip consent,
 *  delete account, clinician hours, support address) have no feature behind them and are not
 *  shown. */
export function Settings() {
  const nav = useNavigate()
  const [theme, setTheme] = useState<Theme>(getTheme())
  const [guidance, setGuidance] = useState<Guidance>(() => readGuidance())
  const [prefs, setPrefs] = useState<Prefs>(() => readPrefs())
  const [day, setDay] = useState<Day>(() => readDay())
  const [replayOpen, setReplayOpen] = useState(false)
  const [note, setNote] = useState('')
  const { data: me, error: meError } = useApi(() => api.me())
  const { data: clips, error: clipsError } = useApi(() => api.replayList())
  const { data: health, error: healthError } = useApi(() => api.health())

  const side = readSide() ?? (me?.side === 'right' ? 'right' : 'left')
  const pick = (t: Theme) => {
    applyTheme(t)
    setTheme(t)
  }
  const setG = (key: keyof Guidance, v: boolean) => {
    const next = { ...guidance, [key]: v }
    setGuidance(next)
    writeGuidance(next)
  }
  const setP = (key: keyof Prefs, v: boolean) => {
    const next = { ...prefs, [key]: v }
    setPrefs(next)
    writePrefs(next)
  }
  const resetToday = () => {
    if (resetTodayCheckin().ok) setNote("Today's check-in was cleared on this device.")
    setDay(readDay())
  }
  const place = processingPlace().replace(/^processed /, '')

  return (
    <div className="st">
      <div className="st-head">
        <h1 className="text-4xl">Settings</h1>
        {note && (
          <p className="st-note" role="status">
            {note}
          </p>
        )}
      </div>
      <div className="st-grid">
        <div className="st-col">
          <Card title="Profile and plan">
            <ul className="st-list">
              <ProfileRows me={me} error={meError} side={side} onOpen={() => nav(`/details/checkin?side=${side}`)} />
            </ul>
          </Card>
          <Card title="Appearance">
            <ul className="st-list">
              <SettingsRow
                title="Theme"
                sub={theme === 'auto' ? 'Follows your device' : theme === 'dark' ? 'Low-glare navy for evenings' : 'Light is the default'}
                control={
                  <div role="radiogroup" aria-label="Theme" className="st-seg" onKeyDown={arrowSelect}>
                    {THEMES.map(([v, l]) => (
                      <button key={v} type="button" role="radio" aria-checked={theme === v} onClick={() => pick(v)}>
                        {l}
                      </button>
                    ))}
                  </div>
                }
              />
              <SettingsRow title="Larger text" sub="Everything about an eighth bigger" control={<Switch label="Larger text" checked={guidance.larger} onChange={(v) => setG('larger', v)} />} />
              <SettingsRow title="High contrast" sub="Stronger borders and text" control={<Switch label="High contrast" checked={prefs.contrast} onChange={(v) => setP('contrast', v)} />} />
              <SettingsRow title="Reduced motion" sub="No animated cues; the figure shows key frames" control={<Switch label="Reduced motion" checked={prefs.motion} onChange={(v) => setP('motion', v)} />} />
            </ul>
          </Card>
        </div>

        <div className="st-col">
          <Card title="Guidance">
            <ul className="st-list">
              <SettingsRow title="Audio" sub="Coach cues read aloud by this browser; captions are always shown too" control={<Switch label="Audio" checked={prefs.audio} onChange={(v) => { setP('audio', v); if (!v) resetSpeech() }} />} />
              <SettingsRow title="Language" sub="English (US)" control={<span className="st-val">Only option</span>} />
            </ul>
          </Card>
          <Card title="Demo and judging">
            <ul className="st-list">
              <SettingsRow title="Show technical details" sub="OpenCV status, decision trace, telemetry" control={<Switch label="Show technical details" checked={prefs.judge} onChange={(v) => setP('judge', v)} />} />
              <SettingsRow title="Replay a recorded session" sub="Same OpenCV pipeline, no webcam needed" onClick={() => setReplayOpen(true)} />
              <SettingsRow
                title="Reset today's check-in"
                sub={day.stopped ? "Today is stopped, so it can't be reset" : day.checkin ? `Checked in today · pain ${day.checkin.pain}` : 'No check-in yet today'}
                onClick={resetToday}
                disabled={!!day.stopped || !day.checkin}
              />
              {health?.team_test && (
                <>
                  <SettingsRow
                    title="Tester name"
                    sub={readTester() ? `Sessions are saved as “${readTester()}” · tap to change` : 'Not set · tap to enter one'}
                    onClick={() => {
                      writeTester('')
                      location.reload() // the name box opens again on load
                    }}
                  />
                  <SettingsRow title="Team test report" sub="Where sessions went wrong, per exercise and tester" onClick={() => window.open('/api/review?format=md', '_blank', 'noopener')} />
                </>
              )}
              <CoachRow health={health} error={healthError} />
              <SettingsRow {...deploymentLabel(health)} />
            </ul>
          </Card>
        </div>

        <div className="st-col">
          <Card title="Privacy and data">
            <ul className="st-list">
              <SettingsRow title="Video processing" sub={place.replace(/^./, (c) => c.toUpperCase())} control={<span className="st-tag st-tag-ok">Default</span>} />
              <SettingsRow title="Who receives reports" sub={me ? cap(me.program.clinician) : meError ? 'Unavailable — the session service is not reachable' : 'Loading…'} />
              <SettingsRow title="Export my data" sub="Sessions, reports and check-ins (JSON)" onClick={() => void exportData()} />
            </ul>
          </Card>
          <Card title="Help">
            <ul className="st-list">
              <SettingsRow title="Camera and microphone setup" sub="Laptop camera only · step-by-step with pictures" to={setupUrl('abduction', side)} />
              <SettingsRow title="Equipment and substitutes" sub="What to use if something is missing" to="/details/choose" />
            </ul>
          </Card>
        </div>
      </div>

      <Overlay open={replayOpen} title="Replay a recorded session" description="Recorded clips run through the same pipeline." onClose={() => setReplayOpen(false)} className="w-[min(620px,92vw)]">
        <p className="mt-2 text-muted">No webcam needed. The recording runs through the identical OpenCV pipeline and coach; the session shows a Replay badge instead of Live.</p>
        <ul className="st-list mt-4">
          {/* The service never lists a hidden exercise's clip (28 Sep); filtered here too. */}
          {(clips ?? [])
            .filter((c) => !isHiddenExercise((c as { exercise?: string }).exercise ?? c.mode))
            .map((c) => {
              // Named from the one exercise registry (a clip may carry its arm exercise id).
              const ex = exerciseOfSession({ mode: c.mode, exercise: (c as { exercise?: string }).exercise })
              const name = ex?.name ?? c.mode
              return (
                <SettingsRow
                  key={c.id}
                  title={name}
                  sub={`Left side · ${c.synthetic ? 'rendered test clip' : 'recorded with consent'}`}
                  control={c.synthetic ? <span className="st-tag">Synthetic render</span> : undefined}
                  ariaLabel={`Replay ${name}`}
                  to={`/session?exercise=${ex?.id ?? c.mode}&${c.mode === 'nhpt' ? 'hand' : 'side'}=left&replay=${c.id}`}
                />
              )
            })}
          {!clips && !clipsError && <li className="text-muted">Loading recordings…</li>}
          {clipsError && <li className="text-red-ink">Could not list recordings — the session service is not reachable.</li>}
          {clips && clips.length === 0 && <li className="text-muted">No recordings available yet.</li>}
        </ul>
        <OverlayActions className="justify-end">
          <Button variant="secondary" onClick={() => setReplayOpen(false)}>
            Close
          </Button>
        </OverlayActions>
      </Overlay>
    </div>
  )
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

/** Name, side and goal (row → today's check-in), the assigned program and the clinician, all
 *  from the service. Nothing is filled in from the seed when the service is not reachable. */
function ProfileRows({ me, error, side, onOpen }: { me: Patient | null; error: string | null; side: 'left' | 'right'; onOpen: () => void }) {
  if (!me) {
    const sub = error ? 'Profile unavailable — the session service is not reachable.' : 'Loading…'
    return <SettingsRow title="Your profile" sub={sub} />
  }
  const goal = me.goal.replace(/\.$/, '').toLowerCase()
  return (
    <>
      <SettingsRow title={me.name} sub={`Practising side: ${side === 'right' ? 'Right' : 'Left'}${goal ? ` · goal: ${goal}` : ''}`} onClick={onOpen} />
      <SettingsRow title="Assigned program" sub={me.program.short} control={<span className="st-tag">Read-only</span>} />
    </>
  )
}

/** Which coach runs, from the service's `/health` (agent spec §7). The rule coach always runs
 *  between agent checkpoints and whenever the agent is off or not ready. */
function CoachRow({ health, error }: { health: Health | null; error: string | null }) {
  if (!health) return <SettingsRow title="Coach" sub={error ? 'Coach status unavailable — the session service is not reachable.' : 'Checking the coach…'} />
  const lines = healthLines(health.agent)
  const running = !!health.agent && health.agent.mode !== 'off' && !!health.agent.ready
  const how = running
    ? 'The agent runs at checkpoints; the rule-based coach gives the cues in between. Stop rules run before both.'
    : 'Fixed rules turn what the camera sees into cues. Safety stops always run first.'
  return (
    <SettingsRow
      title={lines.title}
      sub={
        <>
          {lines.details.map((d) => (
            <span key={d} className="block">
              {d}
            </span>
          ))}
          <span className="block">{how}</span>
        </>
      }
    />
  )
}

/** Export my data: what the service holds about the patient (profile, prescription, sessions
 *  with their reports, progress) plus what this browser keeps (`praxis.*`: today's check-in,
 *  preferences). A part the service cannot give is recorded as unavailable, never invented. */
async function exportData() {
  const parts = await Promise.allSettled([api.me(), api.prescription(), api.sessions(), api.progress()])
  const [profile, prescription, sessions, progress] = parts.map((p) => (p.status === 'fulfilled' ? p.value : { unavailable: String(p.reason) }))
  const device: Record<string, unknown> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k?.startsWith('praxis.')) continue
      const v = localStorage.getItem(k)
      try {
        device[k] = JSON.parse(v ?? 'null')
      } catch {
        device[k] = v
      }
    }
  } catch {
    /* private mode: nothing on this device */
  }
  const out = { exported_at: new Date().toISOString(), service: { profile, prescription, sessions, progress }, this_device: device }
  const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `praxis-my-data-${todayKey()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

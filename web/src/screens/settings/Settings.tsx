import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { applyTheme, getTheme, type Theme } from '../../app/theme'
import { Button } from '../../design/Button'
import { Chip } from '../../design/Chip'
import { api, useApi } from '../../lib/api'

const MODE_NAME: Record<string, string> = { nhpt: 'Nine-Hole Peg Test', cup: 'Waiter – cup', arm: 'Arm to the front' }

/** Settings: theme (light default), guidance, privacy statement, and the replay entry
 *  (judge fallback: a recorded clip through the identical pipeline, no webcam). */
export function Settings() {
  const nav = useNavigate()
  const [theme, setTheme] = useState<Theme>(getTheme())
  const { data: clips } = useApi(() => api.replayList())
  const pick = (t: Theme) => {
    applyTheme(t)
    setTheme(t)
  }
  return (
    <div className="grid grid-cols-2 gap-6 p-8">
      <section className="rounded-2xl border border-line bg-surface p-6">
        <h1 className="text-3xl">Settings</h1>
        <h2 className="mt-4 text-2xl">Theme</h2>
        <div className="mt-2 flex gap-3">
          {(['light', 'dark'] as const).map((t) => <button key={t} type="button" aria-pressed={theme === t} onClick={() => pick(t)} className={`min-h-14 rounded-full border-2 px-6 text-lg font-bold ${theme === t ? 'border-teal bg-teal text-white' : 'border-line'}`}>{t === 'light' ? 'Light' : 'Dark'}</button>)}
        </div>
        <p className="mt-1 text-muted">Light is the default. The avatar stage stays dark in both.</p>
        <h2 className="mt-6 text-2xl">Guidance</h2>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {['Spoken instructions', 'Captions', 'Larger text', 'Helper for setup'].map((g, i) => <label key={g} className="flex min-h-12 items-center gap-3 text-lg"><input type="checkbox" defaultChecked={i < 2} className="h-7 w-7 accent-teal" />{g}</label>)}
        </div>
        <h2 className="mt-6 text-2xl">Privacy</h2>
        <p className="mt-1 text-lg">Video is processed in memory on this device and never stored. Only events, measurements and logs are kept. Feeling is what you tell us, never read from your face. Clips are recorded only with your explicit consent and deleted after 30 days.</p>
      </section>
      <section className="rounded-2xl border border-line bg-surface p-6">
        <div className="flex items-center gap-3"><h2 className="text-2xl">Replay a recorded session</h2><Chip tone="amber">Replay</Chip></div>
        <p className="text-muted">No webcam needed. The recording runs through the identical OpenCV pipeline and coach; the session shows a Replay badge instead of Live.</p>
        <ul className="mt-3 divide-y divide-line">
          {(clips ?? []).map((c) => (
            <li key={c.id} className="flex items-center gap-4 py-3">
              <span className="flex flex-1 flex-wrap items-center gap-2 text-lg"><b>{MODE_NAME[c.mode] ?? c.mode}</b> · left side{c.synthetic && <Chip tone="neutral">Synthetic render</Chip>}</span>
              <Button variant="secondary" aria-label={`Replay ${MODE_NAME[c.mode] ?? c.mode}`} onClick={() => nav(`/session?exercise=${c.mode}&${c.mode === 'nhpt' ? 'hand' : 'side'}=left&replay=${c.id}`)}>Replay</Button>
            </li>
          ))}
          {clips && clips.length === 0 && <li className="py-3 text-muted">No recordings available yet.</li>}
        </ul>
        <h2 className="mt-6 text-2xl">Cloud</h2>
        <p className="text-muted">Cloud mode is off in this build. Everything runs on this device.</p>
      </section>
    </div>
  )
}

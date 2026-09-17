import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FlowBar } from '../../app/FlowBar'
import { Button } from '../../design/Button'
import { NumberScale } from '../../design/NumberScale'
import { api, useApi } from '../../lib/api'

export type CheckInData = { pain: number; location: string; energy: string; minutes: number; new_symptoms: boolean }

/** Screen 03 · Pre-session check-in. Feeling is self-reported, never read from the face.
 *  Stop rules are shown from the prescription, not inferred. Voice via SpeechRecognition
 *  with a tap fallback for every prompt. */
export function CheckIn() {
  const nav = useNavigate()
  const { data: rx } = useApi(() => api.prescription())
  const [pain, setPain] = useState<number | null>(null)
  const [location, setLocation] = useState('hand')
  const [energy, setEnergy] = useState('comfortable')
  const [minutes, setMinutes] = useState(14)
  const [symptoms, setSymptoms] = useState(false)
  const [heard, setHeard] = useState<string | null>(null)

  const chip = (value: string, current: string, set: (v: string) => void, label: string) => (
    <button key={value} type="button" aria-pressed={current === value} onClick={() => set(value)} className={`min-h-14 rounded-full border-2 px-5 text-lg font-bold ${current === value ? 'border-teal bg-teal text-white' : 'border-line bg-surface'}`}>{label}</button>
  )
  const listen = () => {
    const SR = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition
    if (!SR) {
      setHeard('Voice input is not available in this browser — tap instead.')
      return
    }
    const r = new SR()
    r.lang = 'en-US'
    r.onresult = (ev) => {
      const text = ev.results[0][0].transcript.toLowerCase()
      setHeard(`Heard: “${text}”`)
      const n = text.match(/\b(\d|10)\b/)
      if (n) setPain(Number(n[1]))
      if (/tired/.test(text)) setEnergy(/very/.test(text) ? 'very_tired' : 'tired')
      if (/comfortable|fine|good/.test(text)) setEnergy('comfortable')
      if (/shoulder|arm|hand|nowhere/.test(text)) setLocation((text.match(/shoulder|arm|hand|nowhere/) ?? ['hand'])[0])
    }
    r.onerror = () => setHeard('Did not catch that — tap instead.')
    r.start()
  }
  const go = () => {
    const data: CheckInData = { pain: pain ?? 0, location, energy, minutes, new_symptoms: symptoms }
    try {
      sessionStorage.setItem('praxis.checkin', JSON.stringify(data))
    } catch {
      /* private mode */
    }
    nav('/choose')
  }
  const rules = rx?.stop_rules

  return (
    <div className="flex min-h-full flex-col">
      <div className="grid flex-1 grid-cols-[3fr_2fr] gap-8 p-8">
        <div>
          <h1 className="text-4xl">Before you start</h1>
          <p className="mt-2 text-muted">Answer by tapping or speaking. This sets today's pace inside your assigned limits.</p>
          <div className="mt-6 space-y-6 rounded-2xl border border-line bg-surface p-6">
            <NumberScale label="Pain right now" value={pain} onChange={setPain} leftAnchor="No pain" rightAnchor="Worst imaginable" />
            <div><div className="mb-2 font-bold">Where is it?</div><div className="flex flex-wrap gap-3">{[['shoulder', 'Shoulder'], ['arm', 'Arm'], ['hand', 'Hand'], ['nowhere', 'Nowhere']].map(([v, l]) => chip(v, location, setLocation, l))}</div></div>
            <div><div className="mb-2 font-bold">Energy today</div><div className="flex flex-wrap gap-3">{[['comfortable', 'Comfortable'], ['tired', 'Tired'], ['very_tired', 'Very tired']].map(([v, l]) => chip(v, energy, setEnergy, l))}</div></div>
            <div><div className="mb-2 font-bold">Time you have</div><div className="flex flex-wrap gap-3">
              <button type="button" aria-pressed={minutes === 14} onClick={() => setMinutes(14)} className={`min-h-14 rounded-full border-2 px-5 text-lg font-bold ${minutes === 14 ? 'border-teal bg-teal text-white' : 'border-line bg-surface'}`}>Full session · 14 min</button>
              <button type="button" aria-pressed={minutes === 7} onClick={() => setMinutes(7)} className={`min-h-14 rounded-full border-2 px-5 text-lg font-bold ${minutes === 7 ? 'border-teal bg-teal text-white' : 'border-line bg-surface'}`}>Shorter · one exercise</button>
            </div></div>
            <label className="flex min-h-12 items-center gap-3 text-lg"><input type="checkbox" checked={symptoms} onChange={(e) => setSymptoms(e.target.checked)} className="h-7 w-7 accent-teal" />Something new or worse since last time</label>
          </div>
        </div>
        <div className="flex flex-col gap-5">
          <div className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="text-2xl">How this is used</h2>
            <p className="text-muted">Your answers go into today's report for {rx?.clinician?.split(',')[0] ?? 'your therapist'} and set the coach's pace. Feeling is what you tell us, never read from your face.</p>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-6">
            <h2 className="text-2xl">Stop rules set by your therapist</h2>
            <ul className="mt-2 divide-y divide-line text-lg">
              <li className="py-2">Pain at or above {rules?.pain_max ?? 5} → session ends, therapist flagged</li>
              <li className="py-2">New or worse symptoms → review before practising</li>
              <li className="py-2">Difficulty never goes above Level {rx?.level ?? 2} dose</li>
            </ul>
          </div>
          <div className="flex items-center justify-between rounded-2xl border border-line bg-surface px-6 py-4">
            <span className="text-lg">Microphone</span>
            <Button variant="secondary" className="min-h-14" onClick={listen}>Push to talk</Button>
          </div>
          {heard && <p className="text-muted">{heard}</p>}
        </div>
      </div>
      <FlowBar step={0} label="Check-in" left={<Button variant="secondary" onClick={() => nav('/')}>Back to Home</Button>} right={<Button disabled={pain === null} onClick={go}>Continue to exercises</Button>} />
    </div>
  )
}

type SpeechRecognitionLike = { lang: string; onresult: ((ev: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null; onerror: (() => void) | null; start: () => void }

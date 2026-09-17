import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FlowBar } from '../../app/FlowBar'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Checkbox } from '../../design/Checkbox'
import { Mic } from '../../design/Icon'
import { NumberScale } from '../../design/NumberScale'
import { Pill } from '../../design/Pill'
import { api, useApi } from '../../lib/api'

export type CheckInData = { pain: number; location: string; energy: string; minutes: number; new_symptoms: boolean }

type Location = 'shoulder' | 'arm' | 'hand' | 'nowhere'
type Energy = 'comfortable' | 'tired' | 'very_tired'
type Minutes = '14' | '7'

const LOCATIONS: { value: Location; label: string }[] = [
  { value: 'shoulder', label: 'Shoulder' },
  { value: 'arm', label: 'Arm' },
  { value: 'hand', label: 'Hand' },
  { value: 'nowhere', label: 'Nowhere' },
]
const ENERGY: { value: Energy; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'tired', label: 'Tired' },
  { value: 'very_tired', label: 'Very tired' },
]
const MINUTES: { value: Minutes; label: string }[] = [
  { value: '14', label: 'Full session · 14 min' },
  { value: '7', label: 'Shorter · one exercise' },
]

/** Screen 03 · Pre-session check-in. Feeling is self-reported, never read from the face.
 *  Stop rules are shown from the prescription, not inferred. Voice via SpeechRecognition
 *  with a tap fallback for every prompt. Pain starts unselected; Continue stays disabled
 *  with a visible hint until a number is chosen. */
export function CheckIn() {
  const nav = useNavigate()
  const hintId = useId()
  const { data: rx } = useApi(() => api.prescription())
  const [pain, setPain] = useState<number | null>(null)
  const [location, setLocation] = useState<Location>('hand')
  const [energy, setEnergy] = useState<Energy>('comfortable')
  const [minutes, setMinutes] = useState<Minutes>('14')
  const [symptoms, setSymptoms] = useState(false)
  const [heard, setHeard] = useState<string | null>(null)

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
      const loc = text.match(/shoulder|arm|hand|nowhere/)
      if (loc) setLocation(loc[0] as Location)
    }
    r.onerror = () => setHeard('Did not catch that — tap instead.')
    r.start()
  }
  const go = () => {
    const data: CheckInData = { pain: pain ?? 0, location, energy, minutes: Number(minutes), new_symptoms: symptoms }
    try {
      sessionStorage.setItem('praxis.checkin', JSON.stringify(data))
    } catch {
      /* private mode */
    }
    nav('/details/choose')
  }
  const rules = rx?.stop_rules
  const clinician = rx?.clinician?.split(',')[0] ?? 'your therapist'

  return (
    <div className="flex min-h-full flex-col">
      <div className="grid flex-1 grid-cols-[3fr_2fr] gap-6 p-6">
        <div>
          <h1 className="text-4xl">Before you start</h1>
          <p className="mt-2 text-muted">Answer by tapping or speaking. This sets today's pace inside your assigned limits.</p>
          <Card className="mt-5 space-y-5">
            <NumberScale label="Pain right now" value={pain} onChange={setPain} leftAnchor="No pain" rightAnchor="Worst imaginable" />
            <div>
              <div className="mb-2 font-bold">Where is it?</div>
              <Pill ariaLabel="Where is it?" value={location} options={LOCATIONS} onChange={setLocation} />
            </div>
            <div>
              <div className="mb-2 font-bold">Energy today</div>
              <Pill ariaLabel="Energy today" value={energy} options={ENERGY} onChange={setEnergy} />
            </div>
            <div>
              <div className="mb-2 font-bold">Time you have</div>
              <Pill ariaLabel="Time you have" value={minutes} options={MINUTES} onChange={setMinutes} />
            </div>
            <Checkbox label="Something new or worse since last time" checked={symptoms} onChange={setSymptoms} description="Your therapist reviews this before you practise." />
          </Card>
        </div>
        <div className="flex flex-col gap-5">
          <Card title="How this is used">
            <p className="text-muted">Your answers go into today's report for {clinician} and set the coach's pace. Feeling is what you tell us, never read from your face.</p>
          </Card>
          <Card title="Stop rules set by your therapist">
            <ul className="divide-y divide-line text-lg">
              <li className="py-2">Pain at or above {rules?.pain_max ?? 5} → session ends, therapist flagged</li>
              <li className="py-2">New or worse symptoms → review before practising</li>
              <li className="py-2">Difficulty never goes above Level {rx?.level ?? 2} dose</li>
            </ul>
          </Card>
          <Card padding="sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-lg">Microphone</span>
              <Button variant="secondary" icon={<Mic />} onClick={listen}>Push to talk</Button>
            </div>
            {heard && <p role="status" className="mt-2 text-lg text-muted">{heard}</p>}
          </Card>
        </div>
      </div>
      <FlowBar
        step={0}
        label="Check-in"
        left={<Button variant="secondary" onClick={() => nav('/details')}>Back to Home</Button>}
        right={
          <div className="flex flex-col items-end">
            <Button disabled={pain === null} aria-describedby={pain === null ? hintId : undefined} onClick={go}>
              Continue to exercises
            </Button>
            {pain === null && (
              <span id={hintId} className="text-lg leading-tight text-muted">
                Choose a pain number to continue
              </span>
            )}
          </div>
        }
      />
    </div>
  )
}

type SpeechRecognitionLike = { lang: string; onresult: ((ev: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null; onerror: (() => void) | null; start: () => void }

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Checkbox } from '../../design/Checkbox'
import { Field } from '../../design/Field'
import { Pill } from '../../design/Pill'
import { PROGRAM } from '../../lib/seed'

type Side = 'left' | 'right' | 'both'
type Mode = 'signin' | 'create'
const GUIDANCE = [
  ['spoken', 'Spoken instructions'],
  ['captions', 'Captions'],
  ['larger', 'Larger text'],
  ['helper', 'Helper for setup'],
] as const

/** Screen 01 · Sign in and first-run profile. Rendered outside the patient Shell with its own
 *  minimal header. Local accounts for the edge build: signing in stores the profile for this
 *  browser session (`praxis.profile`) and opens Home. Camera, microphone and cloud consent are
 *  asked at the point of use, never here. */
export function SignIn() {
  const nav = useNavigate()
  const [mode, setMode] = useState<Mode>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [side, setSide] = useState<Side>('left')
  const [code, setCode] = useState('GR-4471-L2')
  const [goal, setGoal] = useState('Use a cup on my own')
  const [g, setG] = useState({ spoken: true, captions: true, larger: false, helper: false })

  const save = () => {
    try {
      sessionStorage.setItem('praxis.profile', JSON.stringify({ side, code, goal, guidance: g, name: name || undefined, email: email || undefined }))
    } catch {
      /* private mode: the profile lives for this page only */
    }
    nav('/')
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <header className="flex h-16 items-center gap-3 border-b border-line bg-surface px-6">
        <span className="font-heading text-2xl font-semibold text-teal-ink">Praxis</span>
        <span className="text-muted">· Your practice, supported</span>
      </header>
      <div className="mx-auto grid w-full max-w-[1200px] flex-1 grid-cols-[minmax(340px,2fr)_3fr] gap-8 p-8">
        <div>
          <h1 className="text-4xl">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="mt-2 text-muted">{mode === 'signin' ? 'Sign in to reach the practice your therapist assigned.' : 'Your therapist gives you a program code; everything else stays on this device.'}</p>
          <Card className="mt-6">
            <Pill ariaLabel="Sign in or create account" value={mode} onChange={setMode} className="mb-5" options={[{ value: 'signin', label: 'Sign in' }, { value: 'create', label: 'Create account' }]} />
            {mode === 'create' && <Field label="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="mb-4" />}
            <Field label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <div className="mt-4 flex items-end gap-2">
              <Field label="Password" type={showPw ? 'text' : 'password'} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} className="flex-1" />
              <Button type="button" variant="link" className="min-h-14 shrink-0" aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw} onClick={() => setShowPw((s) => !s)}>{showPw ? 'Hide' : 'Show'}</Button>
            </div>
            <Button full className="mt-5" onClick={save}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Button>
            <p className="mt-3 text-base text-muted">Forgot password · Privacy · Terms</p>
          </Card>
        </div>
        <Card>
          <h2 className="text-4xl">First-time setup</h2>
          <p className="text-muted">Shown once after sign in. Clinical limits come from your program and are read-only.</p>
          <div className="mt-5 font-bold">Practising side</div>
          <Pill ariaLabel="Practising side" value={side} onChange={setSide} className="mt-2" options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }, { value: 'both', label: 'Both' }]} />
          <Field label="Program code from your therapist" value={code} onChange={(e) => setCode(e.target.value)} className="mt-5" hint={`Connected: ${PROGRAM.label} · ${PROGRAM.clinician} · 3 exercises + 1 assessment assigned`} />
          <Field label="Everyday goal" value={goal} onChange={(e) => setGoal(e.target.value)} className="mt-5" />
          <div className="mt-5 font-bold">Guidance</div>
          <div className="mt-1 grid grid-cols-2 gap-x-6">
            {GUIDANCE.map(([k, label]) => (
              <Checkbox key={k} label={label} checked={g[k]} onChange={(v) => setG({ ...g, [k]: v })} />
            ))}
          </div>
          <div className="mt-8 flex items-center justify-between gap-6">
            <p className="text-muted">Camera, microphone and any cloud processing are asked for later, when needed.</p>
            <Button variant="secondary" className="shrink-0" onClick={save}>Save and open Home</Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

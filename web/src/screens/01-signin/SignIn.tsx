import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../design/Button'

/** Screen 01 · Sign in and first-run profile (local accounts until Cognito, W6). Camera,
 *  microphone and cloud consent are asked at the point of use, never here. */
export function SignIn() {
  const nav = useNavigate()
  const [side, setSide] = useState<'left' | 'right' | 'both'>('left')
  const [code, setCode] = useState('GR-4471-L2')
  const [goal, setGoal] = useState('Use a cup on my own')
  const [g, setG] = useState({ spoken: true, captions: true, larger: false, helper: false })

  const save = () => {
    try {
      sessionStorage.setItem('praxis.profile', JSON.stringify({ side, code, goal, guidance: g }))
    } catch {
      /* private mode */
    }
    nav('/')
  }
  const pill = (v: typeof side, label: string) => (
    <button key={v} type="button" aria-pressed={side === v} onClick={() => setSide(v)} className={`min-h-14 rounded-full border-2 px-6 text-lg font-bold ${side === v ? 'border-teal bg-teal text-white' : 'border-line bg-surface'}`}>{label}</button>
  )
  return (
    <div className="grid min-h-[calc(100vh-5rem)] grid-cols-[1fr_1fr] gap-8 p-8">
      <div>
        <h1 className="text-4xl">Welcome back</h1>
        <p className="mt-2 text-muted">Sign in to reach the practice your therapist assigned.</p>
        <div className="mt-6 rounded-2xl border border-line bg-surface p-6">
          <div className="mb-4 flex gap-2"><span className="rounded-full bg-teal px-5 py-2 font-bold text-white">Sign in</span><span className="rounded-full border-2 border-line px-5 py-2">Create account</span></div>
          <label className="block font-bold">Email<input className="mt-1 w-full rounded-xl border border-line p-3 text-lg" defaultValue="alex.m@example.com" /></label>
          <label className="mt-4 block font-bold">Password<input type="password" className="mt-1 w-full rounded-xl border border-line p-3 text-lg" defaultValue="••••••••••" /></label>
          <p className="mt-2 text-base text-muted">Local sign-in for the edge build; Cognito arrives with cloud mode.</p>
          <Button full className="mt-5">Sign in</Button>
          <p className="mt-3 text-muted">Forgot password · Privacy · Terms</p>
        </div>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-4xl">First-time setup</h2>
        <p className="text-muted">Shown once after sign in. Clinical limits come from your program and are read-only.</p>
        <div className="mt-5 font-bold">Practising side</div>
        <div className="mt-2 flex gap-3">{pill('left', 'Left')}{pill('right', 'Right')}{pill('both', 'Both')}</div>
        <label className="mt-5 block font-bold">Program code from your therapist<input value={code} onChange={(e) => setCode(e.target.value)} className="mt-1 w-full rounded-xl border border-line p-3 text-lg" /></label>
        <p className="text-muted">Connected: Hospital GRASP, Level 2 · Dr. Anita Rao, OT · 3 exercises + 1 assessment assigned</p>
        <label className="mt-5 block font-bold">Everyday goal<input value={goal} onChange={(e) => setGoal(e.target.value)} className="mt-1 w-full rounded-xl border border-line p-3 text-lg" /></label>
        <div className="mt-5 font-bold">Guidance</div>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {([['spoken', 'Spoken instructions'], ['captions', 'Captions'], ['larger', 'Larger text'], ['helper', 'Helper for setup']] as const).map(([k, label]) => (
            <label key={k} className="flex min-h-12 items-center gap-3 text-lg"><input type="checkbox" checked={g[k]} onChange={(e) => setG({ ...g, [k]: e.target.checked })} className="h-7 w-7 accent-teal" />{label}</label>
          ))}
        </div>
        <div className="mt-8 flex items-center justify-between gap-6">
          <p className="text-muted">Camera, microphone and any cloud processing are asked for later, when needed.</p>
          <Button onClick={save}>Save and open Home</Button>
        </div>
      </div>
    </div>
  )
}

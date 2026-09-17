import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Field } from '../../design/Field'
import { login } from '../../lib/auth'

/** Screen 01 · Sign in. Username and password only; the service holds the accounts (three
 *  named users for now, a database later). Rendered outside the patient Shell. Camera,
 *  microphone and cloud consent are asked at the point of use, never here. */
export function SignIn() {
  const nav = useNavigate()
  const loc = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const from = (loc.state as { from?: string } | null)?.from ?? '/'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const r = await login(username, password)
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    try {
      sessionStorage.setItem('praxis.profile', JSON.stringify({ side: 'left', name: r.user.name }))
    } catch {
      /* private mode */
    }
    nav(from, { replace: true })
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <header className="flex h-16 items-center gap-3 border-b border-line bg-surface px-6">
        <span className="font-heading text-2xl font-semibold text-teal-ink">Praxis</span>
        <span className="text-muted">· Your practice, supported</span>
      </header>
      <div className="mx-auto flex w-full max-w-[520px] flex-1 flex-col justify-center p-8">
        <h1 className="text-4xl">Welcome back</h1>
        <p className="mt-2 text-muted">Sign in to reach the practice your therapist assigned.</p>
        <Card className="mt-6">
          <form onSubmit={submit} noValidate>
            <Field label="Username" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
            <div className="mt-4 flex items-end gap-2">
              <Field label="Password" type={showPw ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="flex-1" />
              <Button type="button" variant="link" className="min-h-14 shrink-0" aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw} onClick={() => setShowPw((s) => !s)}>{showPw ? 'Hide' : 'Show'}</Button>
            </div>
            {error && <p role="alert" className="mt-4 rounded-[var(--r-control)] bg-tint-red px-4 py-3 text-red-ink">{error}</p>}
            <Button type="submit" full className="mt-6" disabled={busy || !username || !password}>{busy ? 'Signing in…' : 'Sign in'}</Button>
          </form>
        </Card>
        <p className="mt-4 text-base text-muted">Accounts are set up by the Praxis team for now. Camera, microphone and any cloud processing are asked for later, when needed.</p>
      </div>
    </div>
  )
}

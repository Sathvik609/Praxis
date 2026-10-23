import { useId, useRef, useState } from 'react'
import { useModalFocus } from '../design/useModalFocus'
import { api, useApi } from '../lib/api'
import { readTester, writeTester } from '../lib/tester'

/** Team test (12 Oct): on the hosted review build (`/health` → `team_test`), asks once per
 *  browser who is testing, so each session is saved under that name for `/api/review`. Never
 *  shown on a build without the flag (the judge build). A name, no password: nothing private
 *  is behind it. Settings › Demo and judging changes it. */
export function TesterGate() {
  const { data: health } = useApi(() => api.health())
  const [name, setName] = useState<string | null>(() => readTester())
  const [draft, setDraft] = useState('')
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const open = !!health?.team_test && !name
  useModalFocus(ref, open)
  if (!open) return null
  const save = () => setName(writeTester(draft))
  return (
    <div className="sx-scrim">
      <div ref={ref} className="sx-modal" role="dialog" aria-modal aria-labelledby={`${id}-t`}>
        <h2 id={`${id}-t`}>Who's testing?</h2>
        <p className="sx-modal-sub">Team test build. Your sessions are saved under this name so we can see where Praxis needs work. Only the session events are kept, never video.</p>
        <form
          className="lc-input"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <input aria-label="Your name" placeholder="Your first name" value={draft} maxLength={24} onChange={(e) => setDraft(e.target.value)} data-autofocus />
          <button type="submit" className="sx-btn sx-btn-primary" disabled={!draft.trim()}>
            Start
          </button>
          {/* 23 Oct: a name is optional; skipped, sessions are still saved, as "guest". */}
          <button type="button" className="sx-btn sx-btn-secondary" onClick={() => setName(writeTester('guest'))}>
            Skip
          </button>
        </form>
      </div>
    </div>
  )
}

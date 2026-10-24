import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { demoUrl, readSide } from '../../lib/day'
import { readPrefs, writePrefs } from '../../lib/prefs'

const KEY = 'praxis.startHere'

/** True until "Hide start guide" is pressed on this browser. */
export function readStartHere(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'hidden'
  } catch {
    return true
  }
}

/** Settings › Demo and judging › Show the start guide. */
export function showStartHere() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* private mode: the guide shows on every load anyway */
  }
}

function hideStartHere() {
  try {
    localStorage.setItem(KEY, 'hidden')
  } catch {
    /* private mode: hidden for this page only */
  }
}

/** Home · "Start here" (24 Oct 2026, no frame in the PDF; built from the Card pattern). Tells a
 *  first-time visitor, a judge above all, what to try and in which order: the one exercise that
 *  needs only a webcam, then the sheet tasks in Replay (the replay entry itself stays in
 *  Settings, ruling R2), then the trace behind technical details. */
export function StartHere() {
  const nav = useNavigate()
  const [open, setOpen] = useState(readStartHere)
  const [judge, setJudge] = useState(() => readPrefs().judge)
  if (!open) return null
  const hide = () => {
    hideStartHere()
    setOpen(false)
  }
  const turnOnJudge = () => {
    writePrefs({ ...readPrefs(), judge: true })
    setJudge(true)
  }
  const steps = [
    {
      title: 'Try a live exercise',
      body: 'Arm out to the side needs only your webcam. Stand back so your head, shoulders and hips are in view.',
      action: <Button full onClick={() => nav(demoUrl('abduction', readSide() ?? 'left'))}>Start Arm out to the side</Button>,
    },
    {
      title: 'Watch the sheet tasks',
      body: 'Nine-Hole Peg Test and Waiter – cup need a printed sheet. Replay runs a recorded session through the same OpenCV pipeline.',
      action: <Button full variant="secondary" onClick={() => nav('/details/settings?open=replay')}>Open Replay</Button>,
    },
    {
      title: 'See what the camera decided',
      body: 'Turn on technical details to show the trace: what OpenCV saw, the decision, then the coach’s action.',
      action: judge ? (
        <Button full variant="secondary" disabled>Technical details on</Button>
      ) : (
        <Button full variant="secondary" onClick={turnOnJudge}>Turn on technical details</Button>
      ),
    },
  ]
  return (
    <Card
      as="section"
      aria-label="Start here"
      title="Start here"
      className="mx-5 mt-5 shrink-0"
      action={<Button variant="link" onClick={hide}>Hide start guide</Button>}
    >
      <p className="-mt-1 text-muted">New to Praxis? Three things to try, in this order.</p>
      <ol className="mt-4 grid grid-cols-3 gap-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex min-w-0 flex-col gap-2 rounded-[var(--r-card)] border border-line p-4">
            <div className="flex items-center gap-3">
              <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-teal-fill text-base font-bold text-white">{i + 1}</span>
              <h3 className="text-lg font-bold">
                <span className="sr-only">Step {i + 1}: </span>
                {s.title}
              </h3>
            </div>
            <p className="flex-1 text-muted">{s.body}</p>
            {s.action}
          </li>
        ))}
      </ol>
    </Card>
  )
}
